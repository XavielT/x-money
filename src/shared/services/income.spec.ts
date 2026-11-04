// Prompt 03 (v2.9.0) on the real services: income sources, confirmation of expected income
// (never automatic), bulk classification, bruto/neto, commercial sales, recurring rules, and
// rule 4 (benefits are not money).
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, vi } from 'vitest';
import { MemoryStorage, boot } from '../testing/memory-storage';
import { cashSnapshot } from '../testing/non-cash-guard';
import { account, recurring, transaction } from '../testing/builders';
import { TxResult } from '../domain/validation';
import { detectRecurringIncomes } from '../domain/income-patterns';
import { isSyncedKey } from '../data-layer/registry';
import { parseBackup } from '../data-layer/backup';
import { AuditLogService } from './audit-log.service';
import { BenefitService } from './benefit.service';
import { IncomeSourceService, NewIncomeSource } from './income-source.service';
import { IncomeService } from './income.service';
import { SuggestionsService } from './suggestions.service';
import { TransactionService } from './transaction.service';

const bank = account({ id: 'bank', name: 'Bank', type: 'bank', initialBalance: 1000 });
const cash = account({ id: 'cash', name: 'Cash', type: 'cash', initialBalance: 0 });

const payroll = (o: Partial<NewIncomeSource> = {}): NewIncomeSource => ({
  name: 'Payroll',
  kind: 'payroll',
  icon: '💼',
  color: '#42a5f5',
  active: true,
  stability: 'recurring',
  schedule: { mode: 'month-days', days: [15, 30] },
  method: 'transfer',
  defaultAccountId: 'bank',
  verifiability: 'documented',
  expectedGross: 25000,
  expectedNet: 20000,
  ...o,
});

function session(extra: Record<string, unknown> = {}) {
  const s = boot(new MemoryStorage().seed({ accounts: [bank, cash], ...extra }));
  return {
    ...s,
    sources: TestBed.inject(IncomeSourceService),
    income: TestBed.inject(IncomeService),
    benefits: TestBed.inject(BenefitService),
    suggestions: TestBed.inject(SuggestionsService),
    audit: TestBed.inject(AuditLogService),
  };
}
type S = ReturnType<typeof session>;
const id = (r: TxResult | { ok: boolean; id?: string; error?: string }) => {
  if (!r.ok) throw new Error(`rejected: ${(r as { error: string }).error}`);
  return (r as { id: string }).id;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-20T12:00:00'));
});
afterEach(() => vi.useRealTimers());

describe('income sources', () => {
  it('are a synced collection and travel in backups', () => {
    expect(isSyncedKey('incomeSources')).toBe(true);
    expect(isSyncedKey('benefits')).toBe(true);
    const parsed = parseBackup(JSON.stringify({ app: 'x-money', schemaVersion: 2, incomeSources: [{ id: 's', name: 'P', kind: 'payroll' }], benefits: [{ id: 'b', name: 'Fuel', monthlyValue: 1, uses: [] }] }));
    expect(parsed.ok).toBe(true);
    expect(parseBackup(JSON.stringify({ app: 'x-money', schemaVersion: 2, benefits: [{ id: 'b', name: 'Fuel', monthlyValue: 1 }] }))).toMatchObject({ ok: false, error: { key: 'benefits', field: 'uses' } });
  });

  it('are created, edited, audited and persisted', () => {
    const s = session();
    const sid = id(s.sources.add(payroll()));
    expect(s.sources.byId(sid)).toMatchObject({ name: 'Payroll', stability: 'recurring', verifiability: 'documented' });
    expect(s.storage.get<unknown[]>('incomeSources', [])).toHaveLength(1);
    id(s.sources.update({ ...s.sources.byId(sid)!, name: 'Main job', expectedNet: 21000 }));
    expect(s.sources.byId(sid)).toMatchObject({ name: 'Main job', expectedNet: 21000 });
    expect(s.audit.events().filter((e) => e.type === 'income-source')).toHaveLength(2);
  });

  it('are validated: name, custom type name, schedule, amounts, account', () => {
    const s = session();
    expect(s.sources.add(payroll({ name: '  ' }))).toEqual({ ok: false, error: 'name' });
    expect(s.sources.add(payroll({ kind: 'custom' }))).toEqual({ ok: false, error: 'name' });
    expect(s.sources.add(payroll({ kind: 'custom', customKind: 'Rent' })).ok).toBe(true);
    expect(s.sources.add(payroll({ schedule: { mode: 'month-days', days: [40] } }))).toEqual({ ok: false, error: 'schedule' });
    expect(s.sources.add(payroll({ expectedNet: -5 }))).toEqual({ ok: false, error: 'amount' });
    expect(s.sources.add(payroll({ expectedGross: 100, expectedNet: 200 }))).toEqual({ ok: false, error: 'amount' });
    expect(s.sources.add(payroll({ defaultAccountId: 'ghost' }))).toEqual({ ok: false, error: 'account' });
  });

  it('a source with income cannot be deleted (deactivate it), an empty one can', () => {
    const s = session();
    const sid = id(s.sources.add(payroll()));
    s.transactions.add({ type: 'income', amount: 100, accountId: 'bank', date: '2026-11-15', categoryId: 'cat-salary', incomeSourceId: sid });
    expect(s.sources.remove(sid)).toEqual({ ok: false, error: 'in-use' });
    s.sources.setActive(sid, false);
    expect(s.sources.byId(sid)?.active).toBe(false);
    const empty = id(s.sources.add(payroll({ name: 'Empty' })));
    expect(s.sources.remove(empty).ok).toBe(true);
  });
});

describe('gross, deductions and net', () => {
  it('only the net reaches the account; the gross and deductions are kept as declared', () => {
    const s = session();
    const t = id(s.transactions.add({ type: 'income', amount: 20000, grossAmount: 25000, deductions: [{ name: 'Pension', amount: 3000 }, { name: 'Health', amount: 2000 }], accountId: 'bank', date: '2026-11-15', categoryId: 'cat-salary' }));
    expect(s.transactions.byId(t)).toMatchObject({ amount: 20000, grossAmount: 25000 });
    expect(s.transactions.accountBalance('bank')).toBe(21000);
    expect(s.transactions.monthSummary(2026, 11).income).toBe(20000); // not 25,000
  });

  it('rejects a gross below the net, bad deductions and negative cost or expenses', () => {
    const s = session();
    const base = { type: 'income' as const, amount: 100, accountId: 'bank', date: '2026-11-15', categoryId: 'cat-salary' };
    expect(s.transactions.add({ ...base, grossAmount: 90 })).toEqual({ ok: false, error: 'gross' });
    expect(s.transactions.add({ ...base, grossAmount: NaN })).toEqual({ ok: false, error: 'gross' });
    expect(s.transactions.add({ ...base, deductions: [{ name: '', amount: 1 }] })).toEqual({ ok: false, error: 'deductions' });
    expect(s.transactions.add({ ...base, deductions: [{ name: 'Tax', amount: -1 }] })).toEqual({ ok: false, error: 'deductions' });
    expect(s.transactions.add({ ...base, costBasis: -1 })).toEqual({ ok: false, error: 'cost-basis' });
    expect(s.transactions.add({ ...base, saleExpenses: -1 })).toEqual({ ok: false, error: 'cost-basis' });
    expect(s.transactions.transactions()).toHaveLength(0);
  });

  it('income in cash and by transfer are different accounts, and both are income', () => {
    const s = session();
    s.transactions.add({ type: 'income', amount: 500, accountId: 'cash', date: '2026-11-15', categoryId: 'cat-freelance' });
    s.transactions.add({ type: 'income', amount: 700, accountId: 'bank', date: '2026-11-15', categoryId: 'cat-freelance' });
    expect(s.transactions.accountBalance('cash')).toBe(500);
    expect(s.transactions.monthSummary(2026, 11).income).toBe(1200);
  });
});

describe('rule 5: commercial sales', () => {
  it('the sale is revenue; the benefit is shown apart and the price is never presented as profit', () => {
    const s = session();
    const shop = id(s.sources.add(payroll({ name: 'Cars', kind: 'vehicle-trade', stability: 'variable', verifiability: 'declared', schedule: undefined, expectedNet: undefined, expectedGross: undefined })));
    s.transactions.add({ type: 'income', amount: 800000, accountId: 'bank', date: '2026-11-10', categoryId: 'cat-business', incomeSourceId: shop, costBasis: 700000, saleExpenses: 15000 });
    const b = s.income.monthBreakdown(2026, 11);
    expect(b).toMatchObject({ commercialGross: 800000, commercialNetBenefit: 85000, personalNet: 0, available: 85000 });
    expect(s.transactions.accountBalance('bank')).toBe(801000); // the cash really arrived
  });
});

describe('expected income is an expectation, never money', () => {
  it('nothing is posted by itself, however long it has been expected', () => {
    const s = session();
    const sid = id(s.sources.add(payroll()));
    const before = s.transactions.transactions().length;
    expect(s.income.pending().map((e) => e.date)).toEqual(['2026-11-15']);
    expect(s.income.upcoming().map((e) => e.date)).toEqual([]); // the 30th is 10 days away
    boot(s.storage); // a new session (the app was reopened)
    expect(TestBed.inject(TransactionService).transactions().length).toBe(before);
    expect(s.sources.byId(sid)).toBeDefined();
    expect(s.transactions.accountBalance('bank')).toBe(1000);
  });

  it('"Did it arrive?" -> yes creates ONE preloaded movement linked to the source; the question goes away', () => {
    const s = session();
    const sid = id(s.sources.add(payroll()));
    const tx = id(s.income.confirm(sid, '2026-11-15'));
    expect(s.transactions.byId(tx)).toMatchObject({ type: 'income', amount: 20000, grossAmount: 25000, accountId: 'bank', incomeSourceId: sid, categoryId: 'cat-salary', date: '2026-11-15' });
    expect(s.transactions.accountBalance('bank')).toBe(21000);
    expect(s.income.pending()).toEqual([]);
  });

  it('a different amount can be confirmed; without an expected net there is nothing to preload', () => {
    const s = session();
    const sid = id(s.sources.add(payroll()));
    const tx = id(s.income.confirm(sid, '2026-11-15', 18500));
    expect(s.transactions.byId(tx)).toMatchObject({ amount: 18500 });
    expect(s.transactions.byId(tx)?.grossAmount).toBeUndefined();
    const free = id(s.sources.add(payroll({ name: 'Free', expectedNet: undefined, expectedGross: undefined })));
    expect(s.income.confirm(free, '2026-11-15')).toEqual({ ok: false, error: 'amount' });
  });

  it('cash sources use the cash account when no default is set', () => {
    const s = session();
    const sid = id(s.sources.add(payroll({ method: 'cash', defaultAccountId: undefined })));
    const tx = id(s.income.confirm(sid, '2026-11-15'));
    expect(s.transactions.byId(tx)?.accountId).toBe('cash');
  });

  it('"it did not happen" stops asking and creates nothing', () => {
    const s = session();
    const sid = id(s.sources.add(payroll()));
    s.income.skip(sid, '2026-11-15');
    expect(s.income.pending()).toEqual([]);
    expect(s.transactions.transactions()).toHaveLength(0);
  });
});

describe('classifying existing income', () => {
  it('old income has no source ("unclassified") and is assigned in bulk, keeping amounts and dates', () => {
    const old = [
      transaction({ id: 'i1', type: 'income', amount: 5000, accountId: 'bank', date: '2026-10-10', categoryId: 'cat-salary' }),
      transaction({ id: 'i2', type: 'income', amount: 6000, accountId: 'bank', date: '2026-10-25', categoryId: 'cat-salary', reconciled: true }),
      transaction({ id: 'e1', type: 'expense', amount: 10, accountId: 'bank', date: '2026-10-25' }),
    ];
    const s = session({ transactions: old });
    expect(s.income.unclassified().map((t) => t.id).sort()).toEqual(['i1', 'i2']);
    expect(s.income.monthBreakdown(2026, 10)).toMatchObject({ unclassified: 11000, personalNet: 0, available: 0 });
    const sid = id(s.sources.add(payroll()));
    expect(s.income.assign(['i1', 'i2', 'e1'], sid)).toBe(2); // the expense is never touched
    expect(s.income.unclassified()).toEqual([]);
    expect(s.transactions.byId('i2')).toMatchObject({ amount: 6000, date: '2026-10-25', reconciled: true, incomeSourceId: sid });
    expect(s.transactions.byId('e1')?.incomeSourceId).toBeUndefined();
    expect(s.income.monthBreakdown(2026, 10)).toMatchObject({ personalNet: 11000, available: 11000, unclassified: 0 });
    expect(s.audit.events().some((e) => e.type === 'income-classify')).toBe(true);
    expect(s.income.assign(['i1'], undefined)).toBe(1); // and it can go back
  });

  it('a recurring-income suggestion becomes a declared (not documented) source with one tap', () => {
    const txs = ['2026-08-15', '2026-09-15', '2026-10-15'].map((date, i) => transaction({ id: `p${i}`, type: 'income', amount: 15000, accountId: 'bank', date, categoryId: 'cat-salary' }));
    const s = session({ transactions: txs });
    const [suggestion] = detectRecurringIncomes(s.transactions.transactions(), s.accounts.accounts());
    expect(suggestion).toBeDefined();
    const sid = id(s.income.createFromPattern(suggestion));
    expect(s.sources.byId(sid)).toMatchObject({ kind: 'payroll', stability: 'recurring', verifiability: 'declared', expectedNet: 15000, defaultAccountId: 'bank', schedule: { mode: 'month-days', days: [15] } });
    expect(txs.every((t) => s.transactions.byId(t.id)?.incomeSourceId === sid)).toBe(true);
    // declared, so it does NOT count as guaranteed income (rule 7)
    expect(s.income.capacity().guaranteedMonthly).toBe(0);
  });
});

describe('old recurring income rules keep working', () => {
  it('post as before without a source, and carry the source once linked', () => {
    const rule = recurring({ id: 'r1', type: 'income', amount: 1000, categoryId: 'cat-salary', accountId: 'bank', startDate: '2026-11-01', nextDate: '2026-11-01', frequency: 'monthly' });
    const s = session({ recurring: [rule] });
    const first = s.transactions.transactions().find((t) => t.id === 'rec-r1-2026-11-01')!;
    expect(first.incomeSourceId).toBeUndefined();
    const sid = id(s.sources.add(payroll()));
    s.income.linkRule('r1', sid);
    expect(s.recurring.recurring()[0].incomeSourceId).toBe(sid);
    expect(s.income.incomeRules()).toHaveLength(1);
    expect(s.transactions.transactions()).toHaveLength(1); // linking posts and duplicates nothing
  });
});

describe('rule 4: benefits are not money', () => {
  const fuel = { name: 'Fuel card', kind: 'fuel-card' as const, provider: 'Employer', monthlyValue: 8000, monthlyLimit: 10000, active: true };

  it('adding, using, editing and deleting benefits changes no balance, income, net worth or capacity', () => {
    const txs = [transaction({ type: 'income', amount: 20000, accountId: 'bank', date: '2026-11-15', categoryId: 'cat-salary' })];
    const s = session({ transactions: txs });
    const sid = id(s.sources.add(payroll()));
    id(sid ? { ok: true, id: sid } : { ok: false, error: 'x' });
    const before = cashSnapshot(2026, 11);

    const b = id(s.benefits.add(fuel));
    id(s.benefits.addUse(b, { date: '2026-11-03', amount: 2500, note: 'Gas' }));
    id(s.benefits.update({ ...s.benefits.byId(b)!, monthlyValue: 9000, notes: 'x' }));
    expect(cashSnapshot(2026, 11)).toEqual(before);

    s.benefits.removeUse(b, s.benefits.byId(b)!.uses[0].id);
    s.benefits.remove(b);
    expect(cashSnapshot(2026, 11)).toEqual(before);
    expect(s.transactions.transactions()).toHaveLength(1);
  });

  it('a use is a note: no movement, no account touched; limit and saving follow what was used', () => {
    const s = session();
    const b = id(s.benefits.add(fuel));
    id(s.benefits.addUse(b, { date: '2026-11-03', amount: 2500.5 }));
    id(s.benefits.addUse(b, { date: '2026-11-18', amount: 1000 }));
    expect(s.transactions.transactions()).toEqual([]);
    expect(s.transactions.accountBalance('bank')).toBe(1000);
    const item = s.benefits.byId(b)!;
    expect(s.benefits.usageOf(item, 2026, 11)).toMatchObject({ used: 3500.5, percentOfLimit: 35, remaining: 6499.5 });
    expect(s.benefits.savingOf(item, 2026, 11)).toBe(3500.5);
    expect(s.benefits.savingOf(item, 2026, 10)).toBe(8000); // no records that month: the estimated value
    expect(s.benefits.monthlySaving(2026, 11)).toBe(3500.5);
    expect(s.benefits.yearSaving(2026, 11)).toBe(3500.5 + 8000 * 10); // Jan-Oct estimated + Nov used
  });

  it('is validated and persisted', () => {
    const s = session();
    expect(s.benefits.add({ ...fuel, name: ' ' })).toEqual({ ok: false, error: 'invalid' });
    expect(s.benefits.add({ ...fuel, monthlyValue: -1 })).toEqual({ ok: false, error: 'invalid' });
    const b = id(s.benefits.add(fuel));
    expect(s.benefits.addUse(b, { date: '2026-11-03', amount: 0 })).toEqual({ ok: false, error: 'amount' });
    expect(s.benefits.addUse(b, { date: 'nope', amount: 5 })).toEqual({ ok: false, error: 'date' });
    expect(s.benefits.addUse('ghost', { date: '2026-11-03', amount: 5 })).toEqual({ ok: false, error: 'not-found' });
    expect(s.storage.get<unknown[]>('benefits', [])).toHaveLength(1);
  });

  it('BenefitService has no dependency on accounts, movements, income or net worth', () => {
    // its constructor takes storage and the audit log only: no path to cash exists
    expect(BenefitService.length).toBe(2);
  });
});
