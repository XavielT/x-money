// Prompt 05 (v2.11.0): the dashboard composes the services of the earlier prompts. One full
// scenario (biweekly payroll, variable freelance income, a card purchase and its payment, a
// transfer between own accounts, a reversed expense, irregular spending) checks the ten
// indicators and what must NOT be in them (rules 1, 3, 4, 5, 6, 10).
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, vi } from 'vitest';
import { MemoryStorage, boot } from '../testing/memory-storage';
import { cashSnapshot } from '../testing/non-cash-guard';
import { account, recurring, transaction } from '../testing/builders';
import { BenefitService } from './benefit.service';
import { BudgetService } from './budget.service';
import { CreditCardService } from './credit-card.service';
import { DashboardService } from './dashboard.service';
import { IncomeSourceService } from './income-source.service';
import { TxResult } from '../domain/validation';

const bank = account({ id: 'bank', name: 'Bank', type: 'bank', initialBalance: 100000 });
const cash = account({ id: 'cash', name: 'Cash', type: 'cash', initialBalance: 0 });
const savings = account({ id: 'sav', name: 'Savings', type: 'savings', initialBalance: 20000 });
const visa = account({
  id: 'visa',
  name: 'Visa',
  type: 'card',
  cardKind: 'credit',
  initialBalance: 0,
  liquid: false,
  card: { creditLimit: 50000, cutDay: 15, dueMode: 'days-after', dueDays: 20, minPercent: 5, minFloor: 500 },
});

const payrollSource = { id: 'pay', name: 'Payroll', kind: 'payroll', icon: '💼', color: '#42a5f5', active: true, stability: 'recurring', schedule: { mode: 'month-days', days: [15, 30] }, method: 'transfer', defaultAccountId: 'bank', verifiability: 'documented', expectedNet: 20000, createdAt: '2026-01-01T00:00:00Z' };
const freelanceSource = { id: 'free', name: 'Gigs', kind: 'freelance', icon: '💻', color: '#00bfa5', active: true, stability: 'variable', method: 'transfer', defaultAccountId: 'bank', verifiability: 'declared', createdAt: '2026-01-01T00:00:00Z' };

const tx = (o: Record<string, unknown>) => transaction({ accountId: 'bank', ...o } as never);
const income = (amount: number, date: string, sourceId: string) => tx({ type: 'income', amount, date, categoryId: 'cat-salary', incomeSourceId: sourceId });

const history = [
  income(20000, '2026-09-15', 'pay'),
  income(20000, '2026-09-30', 'pay'),
  income(20000, '2026-10-15', 'pay'),
  income(20000, '2026-10-30', 'pay'),
  income(20000, '2026-11-15', 'pay'),
  income(3000, '2026-10-20', 'free'),
  income(5000, '2026-11-05', 'free'),
  tx({ id: 'purchase', type: 'expense', amount: 5000, accountId: 'visa', date: '2026-11-03', categoryId: 'cat-shopping' }),
  tx({ id: 'to-savings', type: 'transfer', amount: 3000, toAccountId: 'sav', date: '2026-11-10', origin: 'transfer' }),
  tx({ id: 'groceries', type: 'expense', amount: 1500, date: '2026-11-12', categoryId: 'cat-groceries' }),
  tx({ id: 'lunch', type: 'expense', amount: 400, date: '2026-11-13', categoryId: 'cat-restaurants' }),
];

function session() {
  const s = boot(new MemoryStorage().seed({
    accounts: [bank, cash, savings, visa],
    incomeSources: [payrollSource, freelanceSource],
    transactions: history,
    recurring: [recurring({ id: 'rent', type: 'expense', categoryId: 'cat-rent', accountId: 'bank', amount: 15000, frequency: 'monthly', startDate: '2026-11-25', nextDate: '2026-11-25' })],
    budgets: [{ id: 'b1', categoryId: 'cat-groceries', monthlyLimit: 10000 }],
  }));
  const cards = TestBed.inject(CreditCardService);
  // the 2.8.0 flow: the payment of the card is a transfer, not an expense
  const paid = cards.pay({ cardId: 'visa', fromAccountId: 'bank', amount: 2000, date: '2026-11-18', currency: 'DOP' });
  if (!paid.ok) throw new Error('pay');
  // a reversed expense
  const added = s.transactions.add({ type: 'expense', amount: 700, accountId: 'bank', date: '2026-11-08', categoryId: 'cat-food' });
  if (!added.ok) throw new Error('add');
  const reversed: TxResult = s.transactions.reverse(added.id);
  if (!reversed.ok) throw new Error('reverse');
  cards.ensureStatements();
  return { ...s, cards, dashboard: TestBed.inject(DashboardService), budget: TestBed.inject(BudgetService), sources: TestBed.inject(IncomeSourceService) };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-20T12:00:00'));
});
afterEach(() => vi.useRealTimers());

const by = (s: ReturnType<typeof session>, id: string) => s.dashboard.byId(id as never)!;
const comp2 = (i: { components: { label: string }[] }, label: string) => i.components.find((c) => c.label === label);
const comp = (s: ReturnType<typeof session>, id: string, label: string) => by(s, id).components.find((c) => c.label === label);

describe('the ten indicators on a full scenario', () => {
  it('1. income: personal net received; commercial revenue and unclassified apart; guaranteed as an estimate', () => {
    const s = session();
    const i = by(s, 'income');
    expect(i.value).toBe(25000); // 20,000 payroll + 5,000 freelance
    expect(comp(s, 'income', 'Guaranteed per month')).toMatchObject({ amount: 40000, kind: 'estimate' });
    expect(comp(s, 'income', 'Commercial sales (gross revenue), shown apart')).toMatchObject({ amount: 0, kind: 'excluded' });
    expect(i.estimate).toBe(false);
  });

  it('2. expenses: no transfer, no card payment, no reversed one; split fixed / variable', () => {
    const s = session();
    const e = by(s, 'expenses');
    expect(e.value).toBe(6900); // 5,000 card purchase (once) + 1,500 + 400
    expect(comp(s, 'expenses', 'Fixed')?.amount).toBe(0);
    expect(comp(s, 'expenses', 'Variable (includes bank fees)')?.amount).toBe(6900);
    expect(comp(s, 'expenses', 'Transfers between your accounts')).toMatchObject({ amount: 3000, kind: 'excluded' });
    expect(comp(s, 'expenses', 'Credit card payments')).toMatchObject({ amount: 2000, kind: 'excluded' });
    // the reversed 700 and the card payment are not in the total
    expect(e.value).not.toBe(6900 + 700);
    expect(e.value).not.toBe(6900 + 2000);
  });

  it('3 and 4. commercial profit and business capital are hidden, not zero, until their modules exist', () => {
    const s = session();
    expect(by(s, 'commercial-profit').available).toBe(false);
    expect(by(s, 'business-capital').available).toBe(false);
    expect(s.dashboard.visible().map((i) => i.id)).not.toContain('business-capital');
  });

  it('5. available money: liquid - card payments due in 30 days - fixed still to pay; both numbers shown', () => {
    const s = session();
    const a = by(s, 'available');
    expect(comp(s, 'available', 'Money in your accounts')?.amount).toBe(224100); // bank 201,100 + savings 23,000; the card is not liquid
    expect(comp(s, 'available', 'Card payments due in 30 days')?.amount).toBe(-3000); // statement of 5,000 minus the 2,000 paid
    expect(comp(s, 'available', 'Fixed obligations still to pay this month')?.amount).toBe(-15000);
    expect(a.value).toBe(206100);
    expect(a.estimate).toBe(false);
  });

  it('6. savings: the savings account, which includes the transfer, counted once', () => {
    const s = session();
    expect(by(s, 'savings').value).toBe(23000);
  });

  it('7. debts and 8. utilization: the card debt after paying part of it', () => {
    const s = session();
    expect(by(s, 'debts').value).toBe(3000);
    expect(by(s, 'card-utilization')).toMatchObject({ value: 6, display: 'percent' });
    expect(by(s, 'card-utilization').components[0]).toMatchObject({ label: 'Visa', amount: 6, display: 'percent' });
  });

  it('9. budget left, with what was spent only in those categories', () => {
    const s = session();
    expect(by(s, 'budget-left').value).toBe(8500);
  });

  it('10. net worth after card debt', () => {
    const s = session();
    expect(by(s, 'net-worth').value).toBe(221100);
  });
});

describe('exclusions', () => {
  it('a transfer between own accounts and the payment of the card change no income or expense (rules 1 and 3)', () => {
    const s = session();
    const before = [by(s, 'income').value, by(s, 'expenses').value];
    s.transactions.add({ type: 'transfer', amount: 10000, accountId: 'bank', toAccountId: 'cash', date: '2026-11-19' });
    s.cards.pay({ cardId: 'visa', fromAccountId: 'bank', amount: 500, date: '2026-11-19', currency: 'DOP' });
    expect([by(s, 'income').value, by(s, 'expenses').value]).toEqual(before);
  });

  it('non-monetary benefits change nothing: not available money, not net worth, not income (rule 4)', () => {
    const s = session();
    const before = JSON.stringify(s.dashboard.indicators());
    const cashBefore = cashSnapshot(2026, 11);
    TestBed.inject(BenefitService).add({ name: 'Fuel card', kind: 'fuel-card', monthlyValue: 8000, active: true });
    expect(JSON.stringify(s.dashboard.indicators())).toBe(before);
    expect(cashSnapshot(2026, 11)).toEqual(cashBefore);
    expect(comp(s, 'available', 'Non-monetary benefits')).toMatchObject({ amount: null, kind: 'excluded' });
  });

  it('a commercial sale shows its revenue and its benefit apart; the price is never profit (rule 5)', () => {
    const s = session();
    s.sources.add({ name: 'Cars', kind: 'vehicle-trade', icon: '🚗', color: '#000', active: true, stability: 'variable', method: 'transfer', verifiability: 'declared' });
    const carSource = s.sources.sources().find((x) => x.name === 'Cars')!;
    s.transactions.add({ type: 'income', amount: 800000, accountId: 'bank', date: '2026-11-19', categoryId: 'cat-business', incomeSourceId: carSource.id, costBasis: 700000, saleExpenses: 15000 });
    expect(by(s, 'commercial-profit')).toMatchObject({ available: true, value: 85000 });
    expect(by(s, 'income').value).toBe(25000); // the sale is not personal income
    expect(comp(s, 'income', 'Commercial sales (gross revenue), shown apart')?.amount).toBe(800000);
  });

  it('commercial capital is kept apart from net worth (rule 6) once the business module provides it', () => {
    const s = session();
    const before = by(s, 'net-worth').value;
    s.dashboard.provide({ businessCapital: { value: 120000 }, commercialWorkingCapital: { value: 120000 } });
    expect(by(s, 'business-capital')).toMatchObject({ available: true, value: 120000 });
    expect(by(s, 'net-worth').value).toBe(before);
    expect(comp(s, 'net-worth', 'Commercial capital (apart, not added)')).toMatchObject({ amount: 120000, kind: 'excluded' });
  });

  it('what the savings and loans modules provide plugs into the contract without double counting', () => {
    const s = session();
    s.dashboard.provide({ goalsReserved: { value: 10000 }, goalsSaved: { value: 4000 }, loanBalance: { value: 90000 } });
    expect(by(s, 'available').value).toBe(196100); // 10,000 set aside comes out
    expect(by(s, 'savings').value).toBe(27000);
    expect(by(s, 'debts').value).toBe(93000);
  });
});

describe('empty states: what is missing, never a false zero', () => {
  it('a new install has indicators without value and says what to do', () => {
    const s = boot(new MemoryStorage().seed({ accounts: [bank] }));
    const d = TestBed.inject(DashboardService);
    const income = d.byId('income')!;
    expect(income.value).toBeNull();
    expect(income.missing).toBeTruthy();
    expect(d.byId('expenses')!.value).toBeNull();
    expect(d.byId('budget-left')!.value).toBeNull();
    expect(d.byId('budget-left')!.missing).toMatch(/budget/i);
    expect(d.byId('card-utilization')!.available).toBe(false);
    expect(d.byId('debts')!.available).toBe(false);
    expect(d.byId('savings')!.available).toBe(false);
    expect(s.transactions.transactions()).toEqual([]);
  });

  it('income with no source yet is not shown as a zero: it says it must be classified', () => {
    boot(new MemoryStorage().seed({ accounts: [bank], transactions: [tx({ type: 'income', amount: 5000, date: '2026-11-10', categoryId: 'cat-salary' })] }));
    const i = TestBed.inject(DashboardService).byId('income')!;
    expect(i.value).toBeNull();
    expect(i.missing).toMatch(/source/i);
    expect(comp2(i, 'Unclassified income')).toMatchObject({ amount: 5000, kind: 'excluded' });
  });

  it('a card without a limit shows the utilization as missing data', () => {
    boot(new MemoryStorage().seed({ accounts: [bank, { ...visa, card: undefined }] }));
    const i = TestBed.inject(DashboardService).byId('card-utilization')!;
    expect(i).toMatchObject({ available: true, value: null });
    expect(i.missing).toMatch(/limit/i);
  });
});

describe('the analyses', () => {
  it('twelve months of income and expense, the running month partial', () => {
    const s = session();
    const f = s.dashboard.flow12();
    expect(f).toHaveLength(12);
    expect(f[11]).toMatchObject({ month: '2026-11', income: 25000, expense: 6900, partial: true });
    expect(f[10]).toMatchObject({ month: '2026-10', income: 43000 });
  });

  it('income sources ranked by weight, with their stability', () => {
    const s = session();
    const top = s.dashboard.topSources();
    expect(top.map((t) => t.source.id)).toEqual(['pay', 'free']);
    expect(top[0].percent).toBeGreaterThan(top[1].percent);
    expect(top[0].stability.calculated).toBe('insufficient'); // 2 complete months only
  });

  it('savings history rebuilt from the ledger', () => {
    const s = session();
    const h = s.dashboard.savings12();
    expect(h[11].total).toBe(23000);
    expect(h[10].total).toBe(20000); // end of October: before the November transfer
  });

  it('comparison of two months, with absolute and percentage differences', () => {
    const s = session();
    const rows = Object.fromEntries(s.dashboard.compare('2026-10', '2026-11').map((r) => [r.id, r]));
    expect(rows['personalNet']).toMatchObject({ a: 43000, b: 25000, diff: -18000, percent: -41.9 });
    expect(rows['expense'].b).toBe(6900);
    expect(rows['liquidEnd'].a).toBeLessThan(rows['liquidEnd'].b);
  });

  it('category distribution of a month', () => {
    const s = session();
    const share = s.dashboard.categoryShare('2026-11');
    expect(share[0]).toMatchObject({ categoryId: 'cat-shopping', total: 5000 });
    expect(share.reduce((n, x) => n + x.total, 0)).toBe(6900);
  });

  it('unusual expenses: not enough history yet', () => {
    expect(session().dashboard.unusual()).toMatchObject({ sufficient: false, flags: [] });
  });
});

describe('cash flow projection from the real data (an estimate)', () => {
  it('starts from the liquid balance, brings guaranteed income and fixed / card due dates, and has a band', () => {
    const s = session();
    const c = s.dashboard.cashflow();
    expect(c.estimate).toBe(true);
    expect(c.points[0].mid).toBe(224100);
    // day 5 (2026-11-25): the rent leaves; day 10 (11-30): payroll arrives
    const p30 = c.summaries[0];
    expect(p30.low).toBeLessThan(p30.mid);
    expect(p30.high).toBeGreaterThan(p30.mid);
    expect(p30.mid).toBeCloseTo(238707.14, 0); // 224,100 + 40,000 payroll - 15,000 rent - 3,000 card - 30 days x 246.43
    expect(c.assumptions).toContain('Variable income is NOT included.');
  });

  it('variable income only with the explicit switch, and never in the worst case', () => {
    const s = session();
    const off = s.dashboard.cashflow().summaries[2];
    s.settings.setDashboard({ includeVariableIncome: true });
    const on = s.dashboard.cashflow().summaries[2];
    expect(on.mid).toBeGreaterThan(off.mid);
    expect(on.low).toBe(off.low);
  });

  it('the cushion is configurable and flags the day the balance goes below it', () => {
    const s = session();
    expect(s.dashboard.cashflow().firstBelowCushion).toEqual({ mid: null, worst: null });
    s.settings.setDashboard({ cushion: 1000000 });
    expect(s.dashboard.cashflow().firstBelowCushion.mid).toBe('2026-11-20');
    expect(s.settings.setDashboard({ cushion: -5 })).toBeUndefined();
    expect(s.settings.dashboard().cushion).toBe(1000000); // invalid values are ignored
  });
});
