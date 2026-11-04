import { Recommendation } from '../budget';
import { IncomeSourceModel } from '../../models/income-source.model';
import { DEFAULT_LOAN_SETTINGS } from '../../models/loan.model';
import { TransactionModel } from '../../models/transaction.model';
import { transaction } from '../../testing/builders';
import {
  detectBudgetAdjustments,
  detectCommitments,
  detectDeclaredVsReceived,
  detectDuplicates,
  detectLowSavings,
  detectReservable,
  detectSmallExpenses,
  detectUnusualIncrease,
  detectVariableDependence,
  findDuplicateCandidates,
  newDebtSustainability,
  noteSimilarity,
  reservableEstimate,
} from './detectors';
import { RULES, ruleSetting } from './engine';
import { RuleId } from './types';

const today = '2026-11-20';
const T = (id: RuleId): Record<string, number> => ruleSetting({ rules: {} }, id).thresholds;
const exp = (date: string, amount: number, o: Partial<TransactionModel> = {}) => transaction({ type: 'expense', amount, accountId: 'bank', date, categoryId: 'cat-food', ...o });
const inc = (date: string, amount: number, o: Partial<TransactionModel> = {}) => transaction({ type: 'income', amount, accountId: 'bank', date, categoryId: 'cat-salary', ...o });
const accounts = [
  { id: 'bank', name: 'Bank', type: 'bank' },
  { id: 'card', name: 'Visa', type: 'card' },
];
const categories = [
  { id: 'cat-food', name: 'Food' },
  { id: 'cat-transport', name: 'Transport' },
];
const source = (o: Partial<IncomeSourceModel> = {}): IncomeSourceModel => ({
  id: 'pay',
  name: 'Payroll',
  kind: 'payroll',
  icon: 'x',
  color: '#000',
  active: true,
  stability: 'recurring',
  schedule: { mode: 'month-days', days: [15, 30] },
  method: 'transfer',
  verifiability: 'documented',
  expectedNet: 30000,
  createdAt: '2026-01-01',
  ...o,
});

describe('a) small expenses that add up', () => {
  const smalls = (n: number, accountId = 'bank') => Array.from({ length: n }, (_, i) => exp(`2026-11-${String(1 + (i % 18)).padStart(2, '0')}`, 150, { accountId, note: 'coffee' }));

  it('fires by category, account and card when many small purchases pile up', () => {
    const txs = [exp('2026-10-26', 3000, { note: 'groceries' }), ...smalls(20), ...smalls(15, 'card')];
    const r = detectSmallExpenses({ today, txs, categories, accounts, ceiling: 300 }, T('small-expenses'));
    expect(r.status).toBe('ok');
    const ids = r.insights.map((i) => i.id);
    expect(ids).toContain('small-expenses:category:cat-food');
    expect(ids).toContain('small-expenses:account:bank');
    expect(ids).toContain('small-expenses:card:card');
    const cat = r.insights.find((i) => i.id === 'small-expenses:category:cat-food')!;
    expect(cat.dataState).toBe('confirmed');
    expect(cat.evidence[0].source?.txIds?.length).toBeGreaterThan(0);
    expect(cat.params['count']).toBe('35');
  });

  it('does not fire with a few purchases', () => {
    const r = detectSmallExpenses({ today, txs: [exp('2026-10-26', 3000), ...smalls(3)], categories, accounts, ceiling: 300 }, T('small-expenses'));
    expect(r.status).toBe('ok');
    expect(r.insights).toEqual([]);
  });

  it('says it needs 14 days of history and how many it has', () => {
    const r = detectSmallExpenses({ today, txs: [exp('2026-11-15', 100)], categories, accounts }, T('small-expenses'));
    expect(r.status).toBe('insufficient-history');
    expect(r.history).toEqual({ needed: 14, have: 6, unit: 'days' });
    expect(r.insights).toEqual([]);
  });
});

describe('b) unusual increases against the median and range of 6 months', () => {
  const months = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
  const base = [5000, 5200, 4800, 5100, 4900, 5000];
  const history = (oct: number) => [...months.map((m, i) => exp(`${m}-10`, base[i])), exp('2026-10-10', oct)];

  it('flags a category and the total far above Q3 + 1.5 IQR and the minimum rise', () => {
    const r = detectUnusualIncrease({ today, txs: history(9000), categories }, T('unusual-increase'));
    expect(r.status).toBe('ok');
    expect(r.insights.map((i) => i.id).sort()).toEqual(['unusual-increase:cat:cat-food', 'unusual-increase:total']);
    const i = r.insights[0];
    expect(i.evidence.find((e) => e.label === 'Median of the previous months')!.value).toBe(5000);
    expect(i.dataState).toBe('confirmed');
  });

  it('does not flag a normal month', () => {
    expect(detectUnusualIncrease({ today, txs: history(5500), categories }, T('unusual-increase')).insights).toEqual([]);
  });

  it('needs 5 months with data', () => {
    const r = detectUnusualIncrease({ today, txs: [exp('2026-09-10', 5000), exp('2026-10-10', 9000)], categories }, T('unusual-increase'));
    expect(r.status).toBe('insufficient-history');
    expect(r.history).toMatchObject({ needed: 5, have: 2 });
  });
});

describe('c) months with lower saving capacity', () => {
  const monthKeys = (n: number) => Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2025, 10 + i, 1)); // 2025-11 onward
    return d.toISOString().slice(0, 7);
  });
  const series = (n: number, lastExpense = 30000, dec = 30000) =>
    monthKeys(n).map((month, i) => ({ month, available: 50000, expense: i === n - 1 ? lastExpense : month === '2025-12' ? dec : 30000 }));

  it('flags a month far below the median', () => {
    const r = detectLowSavings({ today, months: series(12, 48000) }, T('low-savings'));
    expect(r.insights.map((i) => i.id)).toContain('low-savings:last');
    expect(r.insights.find((i) => i.id === 'low-savings:last')!.params['saving']).toBe('RD$2,000.00');
  });

  it('with 12 months it marks a seasonal pattern for the coming month (December)', () => {
    const r = detectLowSavings({ today, months: series(12, 48000, 48000) }, T('low-savings'));
    const seasonal = r.insights.find((i) => i.id === 'low-savings:seasonal:12')!;
    expect(seasonal).toBeTruthy();
    expect(seasonal.dataState).toBe('estimate');
  });

  it('does not fire when saving is steady, and needs 6 months', () => {
    expect(detectLowSavings({ today, months: series(12) }, T('low-savings')).insights).toEqual([]);
    const few = detectLowSavings({ today, months: series(4) }, T('low-savings'));
    expect(few.status).toBe('insufficient-history');
    expect(few.history).toEqual({ needed: 6, have: 4, unit: 'months' });
    expect(detectLowSavings({ today, months: series(8, 48000) }, T('low-savings')).insights.some((i) => i.id.startsWith('low-savings:seasonal'))).toBe(false); // seasonal needs 12 months
  });
});

describe('d) recommended budget adjustments', () => {
  const rec = (over: Partial<Recommendation> = {}): Recommendation => ({
    sufficient: true,
    monthsUsed: 4,
    base: 100000,
    obligations: 20000,
    variablesMedian: 30000,
    freeMedian: 5000,
    debtMinimums: 0,
    shortfall: false,
    buckets: [{ kind: 'food', months: [8000, 8000, 8000, 8000], median: 8000, suggested: 8000, manual: false }],
    estimate: true,
    ...over,
  });

  it('turns a gap between the limit and the suggestion into an insight with its evidence', () => {
    const r = detectBudgetAdjustments({ rec: rec(), limits: { food: 12000 } }, T('budget-adjust'));
    expect(r.insights).toHaveLength(1);
    expect(r.insights[0]).toMatchObject({ id: 'budget-adjust:food', dataState: 'estimate' });
    expect(r.insights[0].translateParams).toEqual(['block']);
  });

  it('stays quiet when the limit is close, and says when there is not enough history', () => {
    expect(detectBudgetAdjustments({ rec: rec(), limits: { food: 8500 } }, T('budget-adjust')).insights).toEqual([]);
    const r = detectBudgetAdjustments({ rec: rec({ sufficient: false, monthsUsed: 1 }), limits: { food: 12000 } }, T('budget-adjust'));
    expect(r.status).toBe('insufficient-history');
    expect(r.history).toMatchObject({ needed: 3, have: 1 });
  });

  it('raises an alert when the base does not cover the obligations', () => {
    const r = detectBudgetAdjustments({ rec: rec({ shortfall: true, base: 10000 }), limits: {} }, T('budget-adjust'));
    expect(r.insights[0]).toMatchObject({ id: 'budget-adjust:shortfall', severity: 'alert' });
  });
});

describe('e) how much can be set aside each month (an Estimate with a range)', () => {
  const input = { guaranteed: 60000, fixed: 20000, variableMedian: 15000, variableHigh: 18000, debt: 5000, variableMonths: 4 };

  it('guaranteed − fixed − variable median − debt − safety margin, with a conservative figure', () => {
    const e = reservableEstimate(input, 10);
    expect(e).toMatchObject({ value: 18500, low: 15200, high: 18500, isEstimate: true });
    expect(e.assumptions.length).toBeGreaterThan(0);
    const r = detectReservable(input, T('reservable'));
    expect(r.insights[0]).toMatchObject({ id: 'reservable:month', severity: 'info', dataState: 'estimate' });
  });

  it('warns when nothing is left, and the margin is configurable', () => {
    const r = detectReservable({ ...input, guaranteed: 30000 }, T('reservable'));
    expect(r.insights[0].severity).toBe('attention');
    expect(reservableEstimate(input, 0).value).toBe(20000);
  });

  it('needs a guaranteed source and 3 months of variable history', () => {
    expect(detectReservable({ ...input, guaranteed: 0 }, T('reservable')).status).toBe('insufficient-history');
    const r = detectReservable({ ...input, variableMonths: 2 }, T('reservable'));
    expect(r.status).toBe('insufficient-history');
    expect(r.history).toEqual({ needed: 3, have: 2, unit: 'months' });
  });
});

describe('f) dependence on variable income', () => {
  const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
  const incomeMonths = (available = 50000) => months.map((month) => ({ month, available, unclassified: 0 }));
  const pay = (amount: number) => months.map((m) => inc(`${m}-15`, amount, { incomeSourceId: 'pay' }));

  it('alerts when the share of variable income passes the threshold, with the variation between months', () => {
    const r = detectVariableDependence({ txs: pay(20000), sources: [source()], months: incomeMonths() }, T('variable-dependence'));
    const i = r.insights[0];
    expect(i).toMatchObject({ id: 'variable-dependence:income', severity: 'attention', dataState: 'confirmed' });
    expect(i.evidence.find((e) => e.label === 'Share of variable income')!.value).toBe(60);
    expect(i.evidence.find((e) => e.label.startsWith('Variation'))).toBeTruthy();
  });

  it('is quiet when income is mostly guaranteed, and needs 3 months of income', () => {
    expect(detectVariableDependence({ txs: pay(45000), sources: [source()], months: incomeMonths() }, T('variable-dependence')).insights).toEqual([]);
    const r = detectVariableDependence({ txs: [], sources: [source()], months: incomeMonths().slice(0, 2) }, T('variable-dependence'));
    expect(r.status).toBe('insufficient-history');
    expect(r.history).toMatchObject({ needed: 3, have: 2 });
  });

  it('income without a source counts as variable', () => {
    const r = detectVariableDependence({ txs: pay(20000), sources: [source()], months: months.map((month) => ({ month, available: 20000, unclassified: 30000 })) }, T('variable-dependence'));
    expect(r.insights[0].evidence.find((e) => e.label === 'Share of variable income')!.value).toBe(60);
  });
});

describe('g) sustainability of a new debt with a stress test', () => {
  const obligations = { fixed: 20000, variable: 15000, debts: 0, variableBasis: 'history' as const };
  const base = { settings: DEFAULT_LOAN_SETTINGS, obligations, liquid: 50000 };

  it('a comfortable installment with reserve is information', () => {
    const r = newDebtSustainability({ ...base, tiers: { salary: 120000, bonuses: 0, commercial: 30000, declared: 0 }, installmentMonthly: 10000 });
    expect(r.insight).toMatchObject({ severity: 'info', dataState: 'estimate' });
    expect(r.monthsOfReserve).toBe(5);
  });

  it('a heavy installment is an alert, and the stress test lowers only the variable levels', () => {
    const tiers = { salary: 60000, bonuses: 0, commercial: 30000, declared: 0 };
    const heavy = newDebtSustainability({ ...base, tiers, installmentMonthly: 40000 });
    expect(heavy.insight!.severity).toBe('alert');
    const r = newDebtSustainability({ ...base, tiers, installmentMonthly: 10000 });
    expect(r.stressed!.rows[2].income).toBeLessThan(r.base!.rows[2].income); // with-business reading falls
    expect(r.stressed!.rows[0].income).toBe(r.base!.rows[0].income); // salary does not
  });

  it('less than 3 months of reserve is at least an attention, and without income there is no result', () => {
    const r = newDebtSustainability({ ...base, liquid: 15000, tiers: { salary: 120000, bonuses: 0, commercial: 0, declared: 0 }, installmentMonthly: 10000 });
    expect(r.insight!.severity).toBe('attention');
    const none = newDebtSustainability({ ...base, tiers: { salary: 0, bonuses: 0, commercial: 0, declared: 0 }, installmentMonthly: 10000 });
    expect(none).toMatchObject({ status: 'insufficient-history', insight: null });
  });
});

describe('h) declared versus recorded income (a difference, not an accusation)', () => {
  const win = ['2026-08', '2026-09', '2026-10'];
  const received = (total: number) => win.map((m) => inc(`${m}-15`, total / 3, { incomeSourceId: 'pay' }));

  it('shows the gap in amount and percent per source', () => {
    const r = detectDeclaredVsReceived({ today, txs: received(120000), sources: [source()] }, T('declared-vs-received'));
    const i = r.insights.find((x) => x.id === 'declared-vs-received:pay')!;
    expect(i.severity).toBe('info');
    expect(i.evidence.find((e) => e.label === 'Difference')!.value).toBe(-60000);
    expect(i.evidence.find((e) => e.label === 'Difference (%)')!.value).toBe(-33.33);
    expect(i.formula).toContain('not an accusation');
  });

  it('reports deposits that are not linked to any source', () => {
    const txs = [...received(180000), inc('2026-09-03', 5000), inc('2026-10-03', 5000)];
    const r = detectDeclaredVsReceived({ today, txs, sources: [source()] }, T('declared-vs-received'));
    expect(r.insights.map((x) => x.id)).toEqual(['declared-vs-received:unlinked']);
    expect(r.insights[0].evidence[0].source?.txIds).toHaveLength(2);
  });

  it('is quiet when what was received matches, and needs a source with a declared amount', () => {
    expect(detectDeclaredVsReceived({ today, txs: received(180000), sources: [source()] }, T('declared-vs-received')).insights).toEqual([]);
    const none = detectDeclaredVsReceived({ today, txs: [], sources: [source({ expectedNet: undefined }), source({ id: 'new', createdAt: '2026-10-01' })] }, T('declared-vs-received'));
    expect(none.status).toBe('insufficient-history');
    expect(none.history).toEqual({ needed: 1, have: 0, unit: 'sources' });
  });
});

describe('i) possible duplicates', () => {
  const coffee = (date: string, note = 'Uber', o: Partial<TransactionModel> = {}) => exp(date, 480, { note, categoryId: 'cat-transport', ...o });

  it('same amount and account within a day and a similar note: a candidate with a score', () => {
    const a = coffee('2026-11-10');
    const b = coffee('2026-11-11', 'uber trip');
    const c = findDuplicateCandidates([a, b], today);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ aId: a.id, bId: b.id, amount: 480 });
    expect(c[0].score).toBeGreaterThanOrEqual(75);
    const r = detectDuplicates({ today, txs: [a, b], accounts }, T('duplicates'));
    expect(r.insights[0].evidence[0].source?.txIds).toEqual([a.id, b.id]);
    expect(r.insights[0].severity).toBe('info');
  });

  it('does not flag different amounts, different accounts, three days apart, other notes, reversed or linked pairs', () => {
    const a = coffee('2026-11-10');
    expect(findDuplicateCandidates([a, coffee('2026-11-10', 'Uber', { amount: 481 })], today)).toEqual([]);
    expect(findDuplicateCandidates([a, coffee('2026-11-10', 'Uber', { accountId: 'card' })], today)).toEqual([]);
    expect(findDuplicateCandidates([a, coffee('2026-11-13')], today)).toEqual([]);
    expect(findDuplicateCandidates([a, coffee('2026-11-10', 'gasolina super')], today)).toEqual([]);
    expect(findDuplicateCandidates([a, coffee('2026-11-10', 'Uber', { status: 'reversed' })], today)).toEqual([]);
    expect(findDuplicateCandidates([coffee('2026-11-10', 'Uber', { linkedId: 'x' }), coffee('2026-11-10', 'Uber', { linkedId: 'x' })], today)).toEqual([]);
    expect(detectDuplicates({ today, txs: [], accounts }, T('duplicates'))).toMatchObject({ status: 'ok', insights: [] });
  });

  it('note similarity: equal, similar, different, empty', () => {
    expect(noteSimilarity('Uber', 'uber')).toBe(1);
    expect(noteSimilarity('uber trip', 'uber')).toBeGreaterThan(0.5);
    expect(noteSimilarity('cafe', 'gasolina')).toBe(0);
    expect(noteSimilarity('', '')).toBe(0.6);
    expect(noteSimilarity('x', '')).toBe(0.4);
  });

  it('ignores movements older than the window', () => {
    expect(findDuplicateCandidates([coffee('2026-05-10'), coffee('2026-05-10')], today)).toEqual([]);
  });
});

describe('j) upcoming payment commitments', () => {
  const list = [
    { date: '2026-11-25', amount: 8000, kind: 'card' as const, label: 'Visa' },
    { date: '2026-12-05', amount: 3000, kind: 'loan' as const, label: 'Car loan' },
    { date: '2027-02-01', amount: 1000, kind: 'fixed' as const, label: 'Rent' }, // beyond 30 days
  ];

  it('not enough money for the next 30 days: a critical alert with how much is missing', () => {
    const r = detectCommitments({ today, liquid: 5000, commitments: list, cuts: [{ date: '2026-11-28', label: 'Visa cut date' }] }, {});
    const s = r.insights.find((i) => i.id === 'commitments:shortfall')!;
    expect(s).toMatchObject({ severity: 'alert', critical: true });
    expect(s.evidence.find((e) => e.label === 'Missing')!.value).toBe(6000);
    const up = r.insights.find((i) => i.id === 'commitments:upcoming')!;
    expect(up.evidence.find((e) => e.label === 'Commitments in the next 30 days')!.value).toBe(11000);
    expect(up.evidence.some((e) => e.label === 'Visa cut date')).toBe(true);
  });

  it('with enough money only the information remains; overdue payments are critical; no commitments, nothing', () => {
    const fine = detectCommitments({ today, liquid: 50000, commitments: list }, {});
    expect(fine.insights.map((i) => i.id)).toEqual(['commitments:upcoming']);
    const late = detectCommitments({ today, liquid: 50000, commitments: [{ date: '2026-11-10', amount: 900, kind: 'loan', label: 'Car loan' }] }, {});
    expect(late.insights.find((i) => i.id === 'commitments:overdue')).toMatchObject({ severity: 'alert', critical: true });
    expect(detectCommitments({ today, liquid: 0, commitments: [] }, {}).insights).toEqual([]);
  });
});

describe('every rule has a definition with usable thresholds', () => {
  it('thresholds fall back to defaults when saved values are out of range', () => {
    for (const r of RULES) {
      const t = ruleSetting({ rules: { [r.id]: { enabled: true, thresholds: Object.fromEntries(r.thresholds.map((d) => [d.key, d.max + 1])) } } }, r.id).thresholds;
      for (const d of r.thresholds) expect(t[d.key]).toBe(d.default);
    }
  });
});
