// Prompt 04 (v2.10.0) on the real services: categories and subcategories, fixed obligations
// (rule 8), budgets, blocks, moves with undo, alerts, the end-of-month projection (rule 10),
// recommendations and the small-purchases extension.
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, vi } from 'vitest';
import { MemoryStorage, boot } from '../testing/memory-storage';
import { cashSnapshot } from '../testing/non-cash-guard';
import { account, category, recurring, transaction } from '../testing/builders';
import { DEFAULT_CATEGORIES_MOCK } from '../data/default-categories';
import { migrateSnapshot } from '../data-layer/migrations';
import { AuditLogService } from './audit-log.service';
import { BenefitService } from './benefit.service';
import { BudgetService } from './budget.service';
import { FixedExpenseService } from './fixed-expense.service';
import { IncomeSourceService } from './income-source.service';
import { InsightsService } from './insights.service';
import { TxResult } from '../domain/validation';

const bank = account({ id: 'bank', name: 'Bank', type: 'bank', initialBalance: 100000 });

function session(extra: Record<string, unknown> = {}, accounts = [bank]) {
  const s = boot(new MemoryStorage().seed({ accounts, ...extra }));
  return {
    ...s,
    budget: TestBed.inject(BudgetService),
    fixed: TestBed.inject(FixedExpenseService),
    insights: TestBed.inject(InsightsService),
    sources: TestBed.inject(IncomeSourceService),
    audit: TestBed.inject(AuditLogService),
  };
}
type S = ReturnType<typeof session>;
const ok = (r: TxResult) => {
  if (!r.ok) throw new Error(`rejected: ${r.error}`);
  return r.id;
};
const spend = (s: S, amount: number, date: string, categoryId = 'cat-food', extra = {}) =>
  ok(s.transactions.add({ type: 'expense', amount, accountId: 'bank', date, categoryId, ...extra }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-15T12:00:00'));
});
afterEach(() => vi.useRealTimers());

describe('schema v3: category nature', () => {
  const old = [
    { id: 'cat-rent', name: 'Rent', icon: 'x', color: '#111', type: 'expense' },
    { id: 'cat-food', name: 'Food', icon: 'x', color: '#111', type: 'expense' },
    { id: 'custom-1', name: 'Mine', icon: 'x', color: '#111', type: 'expense' },
    { id: 'cat-salary', name: 'Salary', icon: 'x', color: '#111', type: 'income' },
    { id: 'cat-bills', name: 'Bills', icon: 'x', color: '#111', type: 'expense', nature: 'variable' },
  ];

  it('gives every expense category an explicit nature and never overwrites a chosen one', () => {
    const out = (migrateSnapshot({ categories: old }, 2) as { categories: any[] }).categories;
    expect(out.map((c) => c.nature)).toEqual(['fixed', 'variable', 'variable', undefined, 'variable']);
    expect(out.find((c) => c.id === 'cat-salary')).not.toHaveProperty('nature');
    expect(migrateSnapshot({ categories: out }, 2)).toEqual({ categories: out }); // idempotent
  });

  it('movements keep categoryId and every total still adds up (old shape, no subcategory)', () => {
    const txs = [transaction({ type: 'expense', amount: 300, accountId: 'bank', date: '2026-11-02', categoryId: 'cat-food' })];
    const s = session({ transactions: txs, categories: old });
    expect(s.transactions.categoryTotals(2026, 11, 'expense')).toEqual([{ categoryId: 'cat-food', total: 300 }]);
    expect(s.budget.categoryRows(2026, 11)).toEqual([]);
    expect(s.categories.byId('cat-food')?.name).toBe('Food');
  });

  it('an install with the 2.9.0 categories picks up the new built-in ones once, with their nature', () => {
    const s = session({ categories: DEFAULT_CATEGORIES_MOCK.filter((c) => !['cat-rent', 'cat-delivery'].includes(c.id)) });
    const ids = s.categories.categories().map((c) => c.id);
    expect(ids.filter((id) => id === 'cat-rent')).toHaveLength(1);
    expect(s.categories.byId('cat-rent')?.nature).toBe('fixed');
    expect(s.categories.byId('cat-delivery')?.nature).toBe('variable');
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('categories and subcategories', () => {
  it('a subcategory has the type of its parent and at most two levels exist', () => {
    const s = session();
    const sub = s.categories.addSub('cat-food', 'Work lunches', '🥪');
    expect(sub.ok).toBe(true);
    if (!sub.ok) return;
    expect(s.categories.byId(sub.id)).toMatchObject({ parentId: 'cat-food', type: 'expense' });
    expect(s.categories.children('cat-food').map((c) => c.id)).toEqual([sub.id]);
    expect(s.categories.addSub(sub.id, 'Too deep', '?')).toEqual({ ok: false, error: 'parent-is-child' });
    expect(s.categories.update('cat-food', { parentId: 'cat-home' })).toEqual({ ok: false, error: 'has-children' });
    expect(s.categories.addSub('cat-salary', 'x', '?')).toMatchObject({ ok: true }); // income categories can have children too
    // pickers list the top level only
    expect(s.categories.expenseCategories().some((c) => c.id === sub.id)).toBe(false);
  });

  it('built-in categories are editable (name, nature, frequency, pattern) and every change is audited', () => {
    const s = session();
    expect(s.categories.update('cat-restaurants', { name: 'Lunches', nature: 'variable', frequency: 'irregular', irregular: { amountMin: 250, amountMax: 400, timesMin: 0, timesMax: 4, per: 'week' } }).ok).toBe(true);
    expect(s.categories.byId('cat-restaurants')).toMatchObject({ name: 'Lunches', frequency: 'irregular' });
    expect(s.categories.update('cat-restaurants', { irregular: { amountMin: 500, amountMax: 400, timesMin: 0, timesMax: 4, per: 'week' } })).toEqual({ ok: false, error: 'pattern' });
    expect(s.categories.update('cat-restaurants', { name: ' ' })).toEqual({ ok: false, error: 'name' });
    expect(s.categories.update('cat-recon-adjustment', { name: 'x' })).toEqual({ ok: false, error: 'system' });
    expect(s.categories.update('ghost', { name: 'x' })).toEqual({ ok: false, error: 'not-found' });
    expect(s.audit.events().filter((e) => e.type === 'category')).toHaveLength(1);
    expect(s.categories.update('cat-restaurants', { irregular: undefined }).ok).toBe(true);
    expect(s.categories.byId('cat-restaurants')).not.toHaveProperty('irregular');
  });

  it('a category with subcategories cannot be removed; a custom one without can', () => {
    const s = session();
    const parent = s.categories.add('Hobbies', '🎣', '#123456', 'expense');
    const sub = s.categories.addSub(parent.id, 'Fishing', '🎣');
    expect(s.categories.remove(parent.id)).toBe(false);
    if (sub.ok) expect(s.categories.remove(sub.id)).toBe(true);
    expect(s.categories.remove(parent.id)).toBe(true);
    expect(s.categories.remove('cat-food')).toBe(false); // built-in
  });

  it('a movement with a subcategory still counts in its category totals; a budget on the subcategory sees only its own', () => {
    const s = session();
    const sub = s.categories.addSub('cat-food', 'Work lunches', '🥪');
    if (!sub.ok) throw new Error('sub');
    spend(s, 300, '2026-11-02', 'cat-food', { subcategoryId: sub.id });
    spend(s, 200, '2026-11-03', 'cat-food');
    expect(s.transactions.categoryTotals(2026, 11, 'expense')).toEqual([{ categoryId: 'cat-food', total: 500 }]);
    s.budget.upsert('cat-food', 1000);
    s.budget.upsert(sub.id, 400);
    const rows = Object.fromEntries(s.budget.categoryRows(2026, 11).map((r) => [r.budget.categoryId, r.spent]));
    expect(rows).toEqual({ 'cat-food': 500, [sub.id]: 300 });
  });
});

describe('rule 8: fixed obligations and repetition', () => {
  const rule = (o = {}) => recurring({ type: 'expense', accountId: 'bank', amount: 1000, frequency: 'monthly', startDate: '2026-11-20', nextDate: '2026-11-20', ...o });

  it('only rules of a fixed category or flagged fixed are fixed obligations; repetition alone never makes one', () => {
    const s = session({
      recurring: [
        rule({ id: 'rent', categoryId: 'cat-rent', amount: 20000 }),
        rule({ id: 'occasional', categoryId: 'cat-occasional', amount: 500, frequency: 'weekly' }), // repeats every week, still variable
        rule({ id: 'chosen', categoryId: 'cat-occasional', amount: 700, nature: 'fixed' }),
        rule({ id: 'overridden', categoryId: 'cat-rent', amount: 99, nature: 'variable' }),
        rule({ id: 'off', categoryId: 'cat-rent', active: false }),
        rule({ id: 'income', type: 'income', categoryId: 'cat-salary' }),
      ],
    });
    expect(s.fixed.obligations().map((o) => o.rule.id).sort()).toEqual(['chosen', 'rent']);
    expect(s.fixed.summary()).toMatchObject({ monthly: 20700, yearly: 248400, pendingThisMonth: 20700, estimate: true });
  });

  it('a recurring expense posts with the rule nature and subcategory; an old rule without them posts as before', () => {
    const s = session({ recurring: [rule({ id: 'r1', categoryId: 'cat-rent', nature: 'fixed', subcategoryId: 'sub-x', startDate: '2026-11-01', nextDate: '2026-11-01' }), rule({ id: 'r2', categoryId: 'cat-food', startDate: '2026-11-01', nextDate: '2026-11-01' })] });
    expect(s.transactions.byId('rec-r1-2026-11-01')).toMatchObject({ nature: 'fixed', subcategoryId: 'sub-x' });
    expect(s.transactions.byId('rec-r2-2026-11-01')?.nature).toBeUndefined();
  });

  it('what is still to pay shrinks when the obligation is paid (the rule advances)', () => {
    const s = session({ recurring: [rule({ id: 'rent', categoryId: 'cat-rent', amount: 20000, startDate: '2026-11-15', nextDate: '2026-11-15' })] });
    // due today: posted on start, next one is next month
    expect(s.fixed.summary().pendingThisMonth).toBe(0);
    expect(s.transactions.transactions()).toHaveLength(1);
  });
});

describe('budgets: real spending and moves of money', () => {
  it('compares the limit with what was really spent: reversed pairs are out, and the remainder follows', () => {
    const s = session();
    const t = spend(s, 400, '2026-11-02');
    spend(s, 100, '2026-11-03');
    ok(s.transactions.reverse(t));
    s.budget.upsert('cat-food', 1000);
    expect(s.budget.categoryRows(2026, 11)[0]).toMatchObject({ limit: 1000, spent: 100, remaining: 900 });
    expect(s.budget.remainingThisMonth()).toMatchObject({ limit: 1000, spent: 100, remaining: 900 });
  });

  it('moving money between categories changes this month only, is audited, and can be undone', () => {
    const s = session();
    s.budget.upsert('cat-food', 1000);
    s.budget.upsert('cat-transport', 500);
    expect(s.budget.moveMoney({ type: 'category', id: 'cat-food' }, { type: 'category', id: 'cat-transport' }, 250)).toBeNull();
    const rows = () => Object.fromEntries(s.budget.categoryRows(2026, 11).map((r) => [r.budget.categoryId, r.limit]));
    expect(rows()).toEqual({ 'cat-food': 750, 'cat-transport': 750 });
    expect(s.budget.categoryRows(2026, 12).map((r) => r.limit)).toEqual([1000, 500]);
    expect(s.audit.events().some((e) => e.type === 'budget-move')).toBe(true);
    const id = s.budget.moves()[0].id;
    expect(s.budget.undoMove(id)).toBe(true);
    expect(rows()).toEqual({ 'cat-food': 1000, 'cat-transport': 500 });
    expect(s.budget.undoMove(id)).toBe(false);
    expect(s.audit.events().some((e) => e.type === 'budget-move-undo')).toBe(true);
  });

  it('refuses a move with no origin limit, between different kinds, or to a category without a budget', () => {
    const s = session();
    s.budget.upsert('cat-food', 100);
    const food = { type: 'category', id: 'cat-food' } as const;
    expect(s.budget.moveMoney(food, { type: 'category', id: 'cat-home' }, 50)).toBe('kind'); // no budget to receive it
    expect(s.budget.moveMoney(food, { type: 'bucket', id: 'free' }, 50)).toBe('kind');
    expect(s.budget.moveMoney({ type: 'category', id: 'cat-transport' }, food, 50)).toBe('insufficient');
    expect(s.budget.moves()).toEqual([]);
  });

  it('blocks: distribution by percent or amount, base income shown, manual blocks fed by hand', () => {
    const s = session({
      transactions: [transaction({ type: 'income', amount: 60000, accountId: 'bank', date: '2026-10-10', categoryId: 'cat-salary' }), transaction({ type: 'income', amount: 60000, accountId: 'bank', date: '2026-09-10', categoryId: 'cat-salary' }), transaction({ type: 'income', amount: 60000, accountId: 'bank', date: '2026-08-10', categoryId: 'cat-salary' })],
    });
    const src = ok(s.sources.add({ name: 'Pay', kind: 'payroll', icon: 'x', color: '#000', active: true, stability: 'recurring', method: 'transfer', verifiability: 'documented', defaultAccountId: 'bank' }) as never);
    s.transactions.tagIncomeSource(s.transactions.transactions().map((t) => t.id), src);
    // default base: the average of the last 3 months of available income
    expect(s.budget.baseIncome()).toMatchObject({ base: 'avg3', amount: 60000, note: 'ok', estimate: true });
    expect(s.budget.setBucket('food', { mode: 'percent', value: 20 })).toBe(true);
    expect(s.budget.setBucket('food', { mode: 'percent', value: 150 })).toBe(false);
    expect(s.budget.setBucket('transport', { mode: 'amount', value: 4000 })).toBe(true);
    spend(s, 2500, '2026-11-02', 'cat-groceries');
    spend(s, 700, '2026-11-03', 'cat-transport');
    spend(s, 90, '2026-11-04', 'custom-unmapped'); // lands in "free"
    s.budget.setManual('savings', '2026-11', 8000);
    const rows = Object.fromEntries(s.budget.bucketRows(2026, 11).map((r) => [r.bucket.kind, r]));
    expect(rows['food']).toMatchObject({ limit: 12000, spent: 2500, remaining: 9500 });
    expect(rows['transport']).toMatchObject({ limit: 4000, spent: 700 });
    expect(rows['free'].spent).toBe(90);
    expect(rows['savings'].spent).toBe(8000);
    expect(s.budget.setManual('food', '2026-11', 1)).toBe(false); // only manual blocks are fed by hand
    expect(s.budget.percentTotal()).toBe(20);
    // the base can be changed to the real month or the guaranteed income
    s.settings.setBudgetBase('guaranteed');
    expect(s.budget.baseIncome()).toMatchObject({ base: 'guaranteed', amount: 0, note: 'no-data' });
  });

  it('a block move works like a category move', () => {
    const s = session();
    s.budget.setBucket('food', { mode: 'amount', value: 5000 });
    expect(s.budget.moveMoney({ type: 'bucket', id: 'food' }, { type: 'bucket', id: 'free' }, 1500)).toBeNull();
    const limits = Object.fromEntries(s.budget.bucketRows(2026, 11).map((r) => [r.bucket.kind, r.limit]));
    expect(limits['food']).toBe(3500);
    expect(limits['free']).toBe(1500);
  });

  it('blocks and moves are synced collections and survive a backup', () => {
    const s = session();
    s.budget.setBucket('food', { mode: 'amount', value: 5000 });
    s.budget.upsert('cat-food', 100);
    s.budget.moveMoney({ type: 'bucket', id: 'food' }, { type: 'bucket', id: 'free' }, 100);
    const backup = s.settings.exportData();
    s.settings.wipeData();
    expect(boot(s.storage).settings.importData(backup).ok).toBe(true);
    boot(s.storage); // a new session reads what the import wrote
    boot(s.storage); // a new session reads what the import wrote
    const restored = TestBed.inject(BudgetService);
    expect(restored.moves()).toHaveLength(1);
    expect(restored.buckets().find((b) => b.kind === 'food')?.value).toBe(5000);
  });
});

describe('alerts: risk of exceeding', () => {
  it('lists what is over the limit and what, at this pace, will exceed it, with the number and the day', () => {
    const s = session();
    s.budget.upsert('cat-food', 10000);
    s.budget.upsert('cat-transport', 1000);
    spend(s, 8000, '2026-11-10'); // 15 days in: 16,000 projected
    spend(s, 1500, '2026-11-05', 'cat-transport');
    const risks = s.budget.risks();
    const food = risks.find((r) => r.id === 'cat-food')!;
    expect(food.risk).toMatchObject({ status: 'risk', projected: 16000, basis: 'pace', estimate: true });
    expect(food.risk.hitDate).toBe('2026-11-19'); // 10,000 / (8,000 / 15)
    expect(risks.find((r) => r.id === 'cat-transport')?.risk.status).toBe('over');
  });

  it('the threshold is configurable', () => {
    const s = session();
    s.budget.upsert('cat-food', 10000);
    spend(s, 4500, '2026-11-10'); // 9,000 projected
    expect(s.budget.risks()).toEqual([]);
    s.settings.setRiskAt(80);
    expect(s.budget.risks()).toHaveLength(1);
    s.settings.setRiskAt(5);
    expect(s.settings.budget().riskAt).toBe(80); // out of range: ignored
  });

  it('a category with a declared pattern is judged by the pattern', () => {
    const s = session();
    s.categories.update('cat-restaurants', { irregular: { amountMin: 250, amountMax: 400, timesMin: 0, timesMax: 4, per: 'week' } });
    s.budget.upsert('cat-restaurants', 2500);
    spend(s, 1000, '2026-11-05', 'cat-restaurants');
    const risk = s.budget.risks().find((r) => r.id === 'cat-restaurants')!;
    expect(risk.risk).toMatchObject({ basis: 'pattern', status: 'risk' }); // 1,000 + 2 x 325 x 15/7 = 2,392.86 > 90 % of 2,500
  });
});

describe('rule 10: the balance at the end of the month is an estimate, and only counts what is guaranteed', () => {
  const rent = recurring({ id: 'rent', type: 'expense', categoryId: 'cat-rent', accountId: 'bank', amount: 20000, frequency: 'monthly', startDate: '2026-11-20', nextDate: '2026-11-20' });

  it('liquid - fixed pending - variable expected + guaranteed income still expected, with a range', () => {
    const s = session({ recurring: [rent] });
    const pay = s.sources.add({ name: 'Pay', kind: 'payroll', icon: 'x', color: '#000', active: true, stability: 'recurring', schedule: { mode: 'month-days', days: [30] }, method: 'transfer', verifiability: 'documented', expectedNet: 30000, defaultAccountId: 'bank' });
    expect(pay.ok).toBe(true);
    const p = s.budget.endOfMonthProjection();
    expect(p.liquid).toBe(100000);
    expect(p.fixedPending).toBe(20000);
    expect(p.guaranteedExpected).toBe(30000);
    expect(p.projected).toBe(110000); // 100,000 + 30,000 - 20,000, no variable history yet
    expect(p.estimate).toBe(true);
    expect(p.low).toBeLessThanOrEqual(p.projected);
    expect(p.high).toBeGreaterThanOrEqual(p.projected);
  });

  it('variable income and non-monetary benefits never move it', () => {
    const s = session({ recurring: [rent] });
    const before = s.budget.endOfMonthProjection();
    const freelance = ok(s.sources.add({ name: 'Gigs', kind: 'freelance', icon: 'x', color: '#000', active: true, stability: 'variable', schedule: { mode: 'month-days', days: [28] }, method: 'transfer', verifiability: 'declared', expectedNet: 99999, defaultAccountId: 'bank' }) as never);
    void freelance;
    TestBed.inject(BenefitService).add({ name: 'Fuel', kind: 'fuel-card', monthlyValue: 8000, active: true });
    const after = s.budget.endOfMonthProjection();
    expect(after.guaranteedExpected).toBe(before.guaranteedExpected);
    expect(after.projected).toBe(before.projected);
    expect(after.liquid).toBe(before.liquid);
  });

  it('variable spending still expected comes from the recent weekly rate', () => {
    const s = session();
    for (const d of ['2026-11-14', '2026-11-07', '2026-10-31']) spend(s, 700, d);
    const p = s.budget.endOfMonthProjection();
    expect(p.variable).toMatchObject({ basis: 'weekly-history', estimate: true });
    expect(p.variable.projected).toBe(1500); // 700 a week x 15/7
    expect(p.projected).toBe(100000 - 2100 - 1500);
  });
});

describe('recommendations from your history', () => {
  it('needs 3 months; then the median of each block, with where it comes from', () => {
    const s = session();
    expect(s.budget.recommendation().sufficient).toBe(false);
    for (const [m, food] of [['07', 11200], ['08', 9800], ['09', 12100], ['10', 10500]] as const) spend(s, food, `2026-${m}-10`);
    for (const m of ['07', '08', '09', '10']) {
      spend(s, 3000, `2026-${m}-12`, 'cat-transport');
      spend(s, 8000, `2026-${m}-20`, 'cat-rent');
    }
    const r = s.budget.recommendation();
    expect(r.sufficient).toBe(true);
    expect(r.buckets.find((b) => b.kind === 'food')).toMatchObject({ months: expect.any(Array), median: 10850, suggested: 10850 });
    expect(r.buckets.find((b) => b.kind === 'transport')?.median).toBe(3000);
    expect(r.obligations).toBe(8000);
    expect(r.estimate).toBe(true);
  });

  it('a new account with a short past is not penalized with empty months', () => {
    const s = session();
    spend(s, 100, '2026-10-10');
    spend(s, 100, '2026-09-10');
    expect(s.budget.recommendation().monthsUsed).toBe(2);
    expect(s.budget.recommendation().sufficient).toBe(false);
  });

  it('where to reduce and the trend of a category', () => {
    const s = session();
    for (const [i, v] of [1000, 1000, 1100, 900, 1000, 1000].entries()) spend(s, v, `2026-${String(5 + i).padStart(2, '0')}-10`);
    spend(s, 1500, '2026-11-05');
    const [c] = s.budget.reduce();
    expect(c).toMatchObject({ categoryId: 'cat-food', median: 1000, current: 1500, potentialSaving: 500, reason: 'above-median', estimate: true });
    const t = s.budget.trendOf('cat-food', 12);
    expect(t.series).toEqual([1000, 1000, 1100, 900, 1000, 1000]);
    expect(t.trend.monthOverMonth).toBe(0);
  });
});

describe('small purchases: threshold in Settings and breakdown', () => {
  it('the default result is the one it always was; a configured ceiling changes it', () => {
    const s = session();
    for (const d of ['02', '03', '04', '05', '06']) spend(s, 50, `2026-11-${d}`, 'cat-food', { note: 'Coffee' });
    spend(s, 9000, '2026-11-09', 'cat-shopping');
    expect(s.insights.antExpenses(2026, 11)).toMatchObject({ count: 5, total: 250, threshold: 185 });
    s.settings.setAntMax(40);
    expect(s.insights.antExpenses(2026, 11).count).toBe(0);
    s.settings.setAntMax(undefined);
    expect(s.insights.antExpenses(2026, 11).count).toBe(5);
    expect(s.settings.setAntMax(-1)).toBeUndefined();
  });

  it('shows which categories concentrate them and the trend against the month before', () => {
    const s = session();
    spend(s, 40, '2026-10-02');
    for (const d of ['02', '03']) spend(s, 60, `2026-11-${d}`, 'cat-food', { note: 'Coffee' });
    spend(s, 30, '2026-11-04', 'cat-transport');
    spend(s, 9000, '2026-11-09', 'cat-shopping');
    spend(s, 9000, '2026-10-09', 'cat-shopping');
    const b = s.insights.antBreakdown(2026, 11);
    expect(b.summary.total).toBe(150);
    expect(b.byCategory[0]).toMatchObject({ categoryId: 'cat-food', total: 120 });
    expect(b.top[0]).toMatchObject({ label: 'coffee', count: 2, total: 120 });
    expect(b.previous.total).toBe(40);
    expect(b.trendPercent).toBe(275);
  });

  it('non-monetary benefits never reach the budget (rule 4 still holds)', () => {
    const s = session();
    const before = cashSnapshot(2026, 11);
    TestBed.inject(BenefitService).add({ name: 'Fuel', kind: 'fuel-card', monthlyValue: 8000, active: true });
    expect(cashSnapshot(2026, 11)).toEqual(before);
    expect(s.budget.remainingThisMonth().limit).toBe(0);
  });
});
