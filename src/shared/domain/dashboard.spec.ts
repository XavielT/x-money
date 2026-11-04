// Prompt 05 (v2.11.0): dashboard building blocks. Expense breakdown, monthly flow, savings
// history from the ledger, month comparison, available money, the 30/60/90-day cash flow
// projection (an estimate) and unusual expenses.
import { account, transaction } from '../testing/builders';
import {
  availableMoney,
  cashflowProjection,
  compareMonths,
  expenseBreakdown,
  monthlyFlow,
  quantile,
  savingsHistory,
  unusualExpenses,
} from './dashboard';
import { summarize } from './stats';

const exp = (amount: number, date: string, extra = {}) => transaction({ type: 'expense', amount, accountId: 'a', date, categoryId: 'cat-food', ...extra });
const inc = (amount: number, date: string, extra = {}) => transaction({ type: 'income', amount, accountId: 'a', date, categoryId: 'cat-salary', ...extra });

describe('expense breakdown (fixed / variable)', () => {
  const rentIsFixed = (t: { categoryId?: string }) => (t.categoryId === 'cat-rent' ? 'fixed' : 'variable');

  it('adds up to the very same total as the statistics, split by nature', () => {
    const txs = [exp(20000, '2026-11-01', { categoryId: 'cat-rent' }), exp(700, '2026-11-02'), exp(100, '2026-11-03', { fee: 5 })];
    const b = expenseBreakdown(txs, rentIsFixed);
    expect(b).toEqual({ total: 20805, fixed: 20000, variable: 805 }); // the fee is a (variable) expense
    expect(b.total).toBe(summarize(txs).expense);
  });

  it('leaves out reversed pairs, adjustments, transfers, income and US$; a reversed original keeps its fee', () => {
    const txs = [
      exp(500, '2026-11-01', { status: 'reversed', reversedBy: 'r', fee: 4 }),
      exp(500, '2026-11-02', { status: 'reversed', reversalOf: 'x', origin: 'reversal' }),
      exp(50, '2026-11-03', { origin: 'adjustment' }),
      transaction({ type: 'transfer', amount: 9999, accountId: 'a', toAccountId: 'b', date: '2026-11-04' }),
      inc(5000, '2026-11-05'),
      exp(80, '2026-11-06', { currency: 'USD' }),
    ];
    expect(expenseBreakdown(txs, rentIsFixed)).toEqual({ total: 4, fixed: 0, variable: 4 });
    expect(expenseBreakdown(txs, rentIsFixed).total).toBe(summarize(txs).expense);
    expect(expenseBreakdown([], rentIsFixed)).toEqual({ total: 0, fixed: 0, variable: 0 });
  });
});

describe('monthly flow', () => {
  it('income and expense of the last months, the running one marked partial, empty months as zero', () => {
    const txs = [inc(1000, '2026-09-10'), exp(300, '2026-09-11'), inc(500, '2026-11-02'), exp(50, '2026-11-03'), inc(777, '2025-01-01')];
    const f = monthlyFlow(txs, '2026-11-15', 3);
    expect(f.map((m) => m.month)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(f.map((m) => [m.income, m.expense, m.partial])).toEqual([[1000, 300, false], [0, 0, false], [500, 50, true]]);
  });

  it('twelve months across a year end, and a leap-year February', () => {
    const f = monthlyFlow([exp(1, '2028-02-29')], '2028-03-10', 12);
    expect(f).toHaveLength(12);
    expect(f[0].month).toBe('2027-04');
    expect(f.find((m) => m.month === '2028-02')?.expense).toBe(1);
  });

  it('a transfer is neither income nor expense; US$ stays out', () => {
    const f = monthlyFlow([transaction({ type: 'transfer', amount: 100, accountId: 'a', toAccountId: 'b', date: '2026-11-02' }), inc(50, '2026-11-02', { currency: 'USD' })], '2026-11-15', 1);
    expect(f[0]).toMatchObject({ income: 0, expense: 0 });
  });
});

describe('savings history rebuilt from movements', () => {
  const bank = account({ id: 'bank', type: 'bank', initialBalance: 1000 });
  const sav = account({ id: 'sav', type: 'savings', initialBalance: 500 });
  const txs = [
    transaction({ type: 'transfer', amount: 200, accountId: 'bank', toAccountId: 'sav', date: '2026-09-15' }),
    transaction({ type: 'transfer', amount: 50, accountId: 'sav', toAccountId: 'bank', date: '2026-11-02' }),
    inc(30, '2026-10-31', { accountId: 'sav' }),
  ];

  it('the balance of the savings accounts at each month end, today for the running month', () => {
    const h = savingsHistory([bank, sav], txs, '2026-11-15', 4);
    expect(h.map((p) => [p.month, p.total])).toEqual([['2026-08', 500], ['2026-09', 700], ['2026-10', 730], ['2026-11', 680]]);
    expect(h[3].date).toBe('2026-11-15');
    expect(h[0].date).toBe('2026-08-31');
  });

  it('nothing without a savings account (hidden, not a zero); archived ones do not count', () => {
    expect(savingsHistory([bank], txs, '2026-11-15', 4)).toEqual([]);
    expect(savingsHistory([bank, { ...sav, archived: true }], txs, '2026-11-15', 4)).toEqual([]);
  });
});

describe('comparison of two months', () => {
  const snap = (o = {}) => ({ personalNet: 0, commercialGross: 0, commercialBenefit: 0, expense: 0, fixedExpense: 0, variableExpense: 0, netFlow: 0, liquidEnd: 0, ...o });

  it('absolute and percentage difference, no percentage when the base is zero, negatives handled', () => {
    const rows = compareMonths(snap({ personalNet: 40000, expense: 30000, netFlow: -2000, commercialGross: 0 }), snap({ personalNet: 50000, expense: 27000, netFlow: 1000, commercialGross: 8000 }));
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by['personalNet']).toMatchObject({ a: 40000, b: 50000, diff: 10000, percent: 25 });
    expect(by['expense']).toMatchObject({ diff: -3000, percent: -10 });
    expect(by['netFlow']).toMatchObject({ diff: 3000, percent: 150 }); // against the size of the previous (negative) figure
    expect(by['commercialGross']).toMatchObject({ diff: 8000, percent: null });
    expect(rows).toHaveLength(8);
  });

  it('rounds the difference to cents', () => {
    expect(compareMonths(snap({ expense: 0.1 }), snap({ expense: 0.3 })).find((r) => r.id === 'expense')?.diff).toBe(0.2);
  });
});

describe('available money', () => {
  it('liquid - commitments - reserved, rounded; both numbers stay visible to the caller', () => {
    expect(availableMoney(100000, [25000.5, 8000], 0)).toBe(66999.5);
    expect(availableMoney(100000, [], 12000)).toBe(88000);
    expect(availableMoney(1000, [5000], 0)).toBe(-4000); // negative is shown, not hidden
    expect(availableMoney(0.3, [0.1, 0.1], 0)).toBe(0.1);
  });
});

describe('cash flow projection (an estimate)', () => {
  const base = {
    startLiquid: 50000,
    today: '2026-11-15',
    income: [{ date: '2026-11-30', amount: 30000 }],
    variableIncomeMonthly: 9000,
    includeVariableIncome: false,
    fixed: [{ date: '2026-11-20', amount: 20000 }],
    cards: [{ date: '2026-12-05', amount: 15000 }],
    rates: { mid: 500, low: 300, high: 800 },
    cushion: 0,
  };

  it('starts from today and moves with each dated event and the daily variable rate', () => {
    const c = cashflowProjection(base);
    expect(c.points).toHaveLength(91);
    expect(c.points[0]).toMatchObject({ day: 0, date: '2026-11-15', mid: 50000, low: 50000, high: 50000 });
    expect(c.points[5].mid).toBe(27500); // 50,000 - 20,000 (day 5) - 5 x 500
    const d15 = c.points[15]; // 2026-11-30: income arrives
    expect(d15.mid).toBe(50000 - 20000 + 30000 - 15 * 500);
    expect(c.estimate).toBe(true);
  });

  it('the band: worst case uses the highest rate and no variable income, best case the lowest rate', () => {
    const c = cashflowProjection({ ...base, includeVariableIncome: true });
    const p = c.points[30];
    expect(p.low).toBeLessThan(p.mid);
    expect(p.high).toBeGreaterThan(p.mid);
    expect(c.summaries.map((s) => s.days)).toEqual([30, 60, 90]);
    expect(c.summaries[0].mid).toBe(p.mid);
  });

  it('variable income only enters with the switch', () => {
    const off = cashflowProjection(base).summaries[0];
    const on = cashflowProjection({ ...base, includeVariableIncome: true }).summaries[0];
    expect(on.mid - off.mid).toBeCloseTo((9000 / 30.44) * 30, 1);
    expect(on.low).toBe(off.low); // the worst case never counts it
    expect(cashflowProjection(base).assumptions).toContain('Variable income is NOT included.');
    expect(cashflowProjection({ ...base, includeVariableIncome: true }).assumptions).toContain('Includes the average of variable income (switched on by you).');
  });

  it('flags the day the balance falls below zero, in the expected and the worst case', () => {
    const c = cashflowProjection({ ...base, startLiquid: 10000, income: [], rates: { mid: 200, low: 0, high: 600 } });
    // fixed 20,000 on day 5 sinks it in every case
    expect(c.firstBelowZero.mid).toBe('2026-11-20');
    expect(c.firstBelowZero.worst).toBe('2026-11-20');
    const fine = cashflowProjection({ ...base, rates: { mid: 100, low: 0, high: 2000 } });
    expect(fine.firstBelowZero.mid).toBeNull();
    expect(fine.firstBelowZero.worst).not.toBeNull(); // only the worst case gets there
  });

  it('a configurable cushion', () => {
    const c = cashflowProjection({ ...base, cushion: 40000 });
    expect(c.firstBelowCushion.mid).not.toBeNull();
    expect(cashflowProjection({ ...base, cushion: 0 }).firstBelowCushion).toEqual({ mid: null, worst: null });
  });

  it('a past due date counts today; events beyond 90 days are ignored; empty inputs are a straight line', () => {
    const c = cashflowProjection({ ...base, income: [], fixed: [], cards: [{ date: '2026-11-01', amount: 1000 }, { date: '2027-06-01', amount: 99999 }], rates: { mid: 0, low: 0, high: 0 } });
    expect(c.points[0].mid).toBe(49000);
    expect(c.points[90].mid).toBe(49000);
  });

  it('with no history rate (zeros) the band collapses', () => {
    const c = cashflowProjection({ ...base, rates: { mid: 0, low: 0, high: 0 } });
    expect(c.points[40]).toMatchObject({ low: c.points[40].mid, high: c.points[40].mid });
  });
});

describe('unusual expenses', () => {
  const today = '2026-11-15';
  // a category with plenty of history: about 300 a time, 2 a month for 6 months
  const history = (amounts: number[], category = 'cat-food') => amounts.map((a, i) => exp(a, `2026-${String(5 + (i % 6)).padStart(2, '0')}-${String(10 + Math.floor(i / 6)).padStart(2, '0')}`, { categoryId: category }));

  it('not enough data (under 3 months with expenses): says so and flags nothing', () => {
    const r = unusualExpenses([exp(300, '2026-10-10'), exp(300, '2026-09-10'), exp(9999, '2026-11-02')], today, 500);
    expect(r).toEqual({ sufficient: false, monthsWithData: 2, flags: [] });
    expect(unusualExpenses([], today, 500).sufficient).toBe(false);
  });

  it('IQR rule with plenty of history: above Q3 + 1.5 x IQR, and above the minimum', () => {
    const txs = [...history([250, 300, 280, 320, 310, 290, 305, 295, 300, 315, 285, 300]), exp(1200, '2026-11-03'), exp(330, '2026-11-04')];
    const r = unusualExpenses(txs, today, 500);
    expect(r.sufficient).toBe(true);
    expect(r.flags.map((f) => f.txId)).toEqual([txs[12].id]);
    expect(r.flags[0]).toMatchObject({ rule: 'iqr', samples: 12, amount: 1200 });
    expect(r.flags[0].threshold).toBeGreaterThan(r.flags[0].reference);
  });

  it('2 x median with few samples; nothing with fewer than 3', () => {
    const few = [...history([300, 300, 320, 280]), exp(900, '2026-11-02')];
    const r = unusualExpenses(few, today, 500);
    expect(r.flags[0]).toMatchObject({ rule: 'median', reference: 300, threshold: 600, samples: 4 });
    const two = [exp(300, '2026-05-10', { categoryId: 'cat-home' }), exp(300, '2026-06-10', { categoryId: 'cat-home' }), ...history([300, 300, 300, 300]), exp(5000, '2026-11-02', { categoryId: 'cat-home' })];
    expect(unusualExpenses(two, today, 500).flags).toEqual([]); // 2 samples in cat-home: no rule
  });

  it('the minimum amount, reversed movements and other categories are respected; the worst ratio goes first', () => {
    const txs = [...history([300, 300, 320, 280]), exp(450, '2026-11-02'), exp(2000, '2026-11-03', { status: 'reversed' }), exp(700, '2026-11-04'), exp(1500, '2026-11-05')];
    const r = unusualExpenses(txs, today, 500);
    expect(r.flags.map((f) => f.amount)).toEqual([1500, 700]); // 450 is below the minimum; the reversed one does not count
  });

  it('quantiles interpolate', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(quantile([], 0.5)).toBe(0);
    expect(quantile([7], 0.9)).toBe(7);
  });
});
