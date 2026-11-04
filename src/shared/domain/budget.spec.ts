// Prompt 04 (v2.10.0): categories with nature and subcategories (rule 8), irregular spending
// (rule 10), fixed obligations, blocks, moves, risk of exceeding, projection, recommendations,
// trends and where to reduce. All pure.
import { BudgetBucketModel, BudgetMoveModel } from '../models/budget.model';
import { CategoryModel, IrregularPattern } from '../models/category.model';
import { RecurringModel } from '../models/recurring.model';
import { category, recurring, transaction } from '../testing/builders';
import { addDays } from './dates';
import {
  DEFAULT_NATURE,
  categoryTree,
  childrenOf,
  natureOfCategory,
  natureOfTransaction,
  treeIds,
  validPattern,
  validateParent,
} from './categories';
import { irregularProjection, timesPerWeek } from './irregular';
import { advanceDate, fixedSummary, monthlyEquivalent, occurrencesUntil } from './fixed';
import {
  adjustedLimit,
  baseIncome,
  bucketKindOf,
  bucketLimit,
  bucketSpent,
  budgetRisk,
  categorySeries,
  median,
  monthEndProjection,
  monthTotals,
  recommend,
  reduceCandidates,
  trend,
  validateMove,
  variableRemaining,
} from './budget';
import { BANK_FEES_CATEGORY, spentInCategory } from './stats';
import { smallBreakdown } from './small-purchases';

const exp = (amount: number, date: string, extra = {}) => transaction({ type: 'expense', amount, accountId: 'a', date, categoryId: 'cat-food', ...extra });

describe('rule 8: nature belongs to the category, never inferred from repetition', () => {
  const cats: CategoryModel[] = [
    category({ id: 'cat-rent', type: 'expense' }),
    category({ id: 'cat-occasional', type: 'expense' }),
    category({ id: 'sub-fixed', type: 'expense', parentId: 'cat-occasional', nature: 'fixed' }),
    category({ id: 'sub-plain', type: 'expense', parentId: 'cat-rent' }),
    category({ id: 'custom-x', type: 'expense' }),
  ];
  const byId = (id: string) => cats.find((c) => c.id === id);

  it('built-in fixed categories by id, everything else variable (the conservative default)', () => {
    expect(Object.keys(DEFAULT_NATURE).sort()).toEqual(['cat-bills', 'cat-electricity', 'cat-internet', 'cat-obligations', 'cat-rent', 'cat-subscriptions', 'cat-utilities']);
    expect(natureOfCategory(byId('cat-rent'))).toBe('fixed');
    expect(natureOfCategory(byId('custom-x'))).toBe('variable');
    expect(natureOfCategory(undefined)).toBe('variable');
    expect(natureOfCategory({ id: 'cat-rent', nature: 'variable' })).toBe('variable'); // the user can change it
  });

  it('an occasional expense that repeats every week stays variable', () => {
    const repeats = Array.from({ length: 12 }, (_, i) => transaction({ type: 'expense', categoryId: 'cat-occasional', date: addDays('2026-08-01', i * 7), amount: 500 }));
    for (const t of repeats) expect(natureOfTransaction(t, byId)).toBe('variable');
  });

  it('a movement can override it; a subcategory uses its own, else its parent, else the category', () => {
    expect(natureOfTransaction({ nature: 'fixed', categoryId: 'cat-occasional' }, byId)).toBe('fixed');
    expect(natureOfTransaction({ categoryId: 'cat-occasional', subcategoryId: 'sub-fixed' }, byId)).toBe('fixed');
    expect(natureOfTransaction({ categoryId: 'cat-rent', subcategoryId: 'sub-plain' }, byId)).toBe('fixed'); // follows its parent
    expect(natureOfTransaction({ categoryId: 'ghost' }, byId)).toBe('variable');
  });

  it('two levels at most, same type, no self parent', () => {
    const tree: CategoryModel[] = [category({ id: 'p', type: 'expense' }), category({ id: 'c', type: 'expense', parentId: 'p' }), category({ id: 'inc', type: 'income' })];
    expect(validateParent(tree, undefined, 'p', 'expense')).toBeNull();
    expect(validateParent(tree, undefined, undefined, 'expense')).toBeNull();
    expect(validateParent(tree, undefined, 'c', 'expense')).toBe('parent-is-child');
    expect(validateParent(tree, undefined, 'ghost', 'expense')).toBe('parent-missing');
    expect(validateParent(tree, undefined, 'inc', 'expense')).toBe('type-mismatch');
    expect(validateParent(tree, 'p', 'p', 'expense')).toBe('self');
    expect(validateParent(tree, 'p', 'inc', 'income')).toBe('has-children');
    expect(childrenOf(tree, 'p').map((c) => c.id)).toEqual(['c']);
    expect(treeIds(tree, 'p')).toEqual(['p', 'c']);
    expect(categoryTree(tree, 'expense').map((n) => [n.category.id, n.children.map((c) => c.id)])).toEqual([['p', ['c']]]);
  });

  it('irregular patterns: amounts above zero, min <= max, times may be zero', () => {
    const p: IrregularPattern = { amountMin: 250, amountMax: 400, timesMin: 0, timesMax: 4, per: 'week' };
    expect(validPattern(p)).toBe(true);
    expect(validPattern(undefined)).toBe(true);
    expect(validPattern({ ...p, amountMin: 0 })).toBe(false);
    expect(validPattern({ ...p, amountMax: 100 })).toBe(false);
    expect(validPattern({ ...p, timesMin: 5 })).toBe(false);
    expect(validPattern({ ...p, timesMin: -1 })).toBe(false);
    expect(validPattern({ ...p, per: 'year' as never })).toBe(false);
  });
});

describe('irregular spending: work lunches, RD$250-400, 0 to 4 times a week (an estimate)', () => {
  const pattern: IrregularPattern = { amountMin: 250, amountMax: 400, timesMin: 0, timesMax: 4, per: 'week' };
  const today = '2026-11-15'; // a Sunday: 15 days of the month still to come
  const lunch = (date: string, amount = 300) => exp(amount, date, { categoryId: 'cat-lunch' });
  // `perWeek` lunches in each of `weeks` weeks ending today
  const weeks = (n: number, perWeek: number, amount = 300) => {
    const out = [];
    for (let w = 0; w < n; w++) for (let k = 0; k < perWeek; k++) out.push(lunch(addDays(today, -(7 * w + k * 2 + 1)), amount));
    return out;
  };

  it('no history: the declared midpoint (2 a week x RD$325), said so, with the declared range', () => {
    const p = irregularProjection([], pattern, today, 2026, 11);
    expect(p).toMatchObject({ occurrences: 0, averagePerTransaction: null, spent: 0, basis: 'declared', historyWeeks: 0, estimate: true });
    expect(p.projected).toBe(1392.86); // 2 x 325 x 15/7
    expect(p.low).toBe(0); // zero times a week is allowed
    expect(p.high).toBe(3428.57); // 4 x 400 x 15/7
    expect(p.assumptions).toEqual({ perWeek: 2, averageAmount: 325, remainingWeeks: 2.14 });
  });

  it('only two weeks of history is not enough: it still uses the declared midpoint', () => {
    const p = irregularProjection(weeks(2, 2), pattern, today, 2026, 11);
    expect(p.basis).toBe('declared');
    expect(p.spent).toBe(1200);
    expect(p.occurrences).toBe(4);
    expect(p.projected).toBe(2592.86);
  });

  it('with history it uses what really happened: occurrences per week x average x weeks left, plus what was spent', () => {
    // 7 weeks, 2 a week (the oldest week falls outside the 6-week window)
    const p = irregularProjection(weeks(7, 2), pattern, today, 2026, 11);
    expect(p.basis).toBe('history');
    expect(p.historyWeeks).toBe(6);
    expect(p.occurrences).toBe(4);
    expect(p.averagePerTransaction).toBe(300);
    expect(p.projected).toBe(2485.71); // 1,200 + 2 x 300 x 15/7
    expect(p.low).toBe(1200);
    expect(p.high).toBe(4628.57);
  });

  it('a week with four lunches, eight weeks of history', () => {
    const txs = [];
    for (let w = 0; w < 8; w++) for (let k = 0; k < 4; k++) txs.push(lunch(addDays(today, -(7 * w + k)), 400));
    const p = irregularProjection(txs, pattern, today, 2026, 11);
    expect(p.basis).toBe('history');
    expect(p.assumptions.perWeek).toBe(4);
    expect(p.projected - p.spent).toBeCloseTo(3428.57, 1);
  });

  it('weeks with zero spending pull the weekly rate down', () => {
    // 6 weeks of history but only the last 3 had lunches (3 a week)
    const txs = [...weeks(3, 3), lunch(addDays(today, -45))];
    const p = irregularProjection(txs, pattern, today, 2026, 11);
    expect(p.assumptions.perWeek).toBe(1.5); // 9 lunches in the 6-week window / 6
  });

  it('a month that starts mid-week: the whole month is still ahead', () => {
    const p = irregularProjection([], pattern, '2026-12-01', 2026, 12);
    expect(p.assumptions.remainingWeeks).toBe(4.29); // 30 days left, not a whole number of weeks
    expect(p.projected).toBe(2785.71); // 2 x 325 x 30/7
  });

  it('a past month is just what was spent; the range collapses onto it', () => {
    const p = irregularProjection([lunch('2026-10-12'), lunch('2026-10-20', 350)], pattern, today, 2026, 10);
    expect(p).toMatchObject({ spent: 650, projected: 650, low: 650, high: 650, occurrences: 2, averagePerTransaction: 325 });
  });

  it('per-month patterns convert to a weekly rate', () => {
    expect(timesPerWeek(2, 'week')).toBe(2);
    expect(timesPerWeek(13, 'month')).toBeCloseTo(3, 5);
  });

  it('behavior outside the declared range widens the range instead of contradicting the estimate', () => {
    const txs = weeks(8, 6, 500);
    const p = irregularProjection(txs, pattern, today, 2026, 11);
    expect(p.high).toBeGreaterThanOrEqual(p.projected);
    expect(p.low).toBeLessThanOrEqual(p.projected);
  });
});

describe('fixed obligations', () => {
  const rule = (o: Partial<RecurringModel>): RecurringModel => recurring({ type: 'expense', frequency: 'monthly', nextDate: '2026-11-20', startDate: '2026-01-20', amount: 1000, ...o });

  it('monthly equivalent, with the factors the subscription insight always used', () => {
    expect(monthlyEquivalent({ amount: 100, frequency: 'weekly' })).toBe(435);
    expect(monthlyEquivalent({ amount: 1200, frequency: 'yearly' })).toBe(100);
    expect(monthlyEquivalent({ amount: 10, frequency: 'daily' })).toBe(304.4);
  });

  it('what is still to pay this month, projected per year as an estimate', () => {
    const s = fixedSummary([rule({}), rule({ id: 'w', frequency: 'weekly', nextDate: '2026-11-16', amount: 100 })], '2026-11-30');
    expect(s.pendingThisMonth).toBe(1300); // 1,000 on the 20th + 100 on the 16th, 23rd and 30th
    expect(s.pending.map((p) => p.date)).toEqual(['2026-11-16', '2026-11-20', '2026-11-23', '2026-11-30']);
    expect(s.monthly).toBe(1435);
    expect(s.yearly).toBe(17220);
    expect(s.estimate).toBe(true);
  });

  it('nothing pending when the next date is next month; empty list is zero', () => {
    expect(fixedSummary([rule({ nextDate: '2026-12-01' })], '2026-11-30').pendingThisMonth).toBe(0);
    expect(fixedSummary([], '2026-11-30')).toMatchObject({ monthly: 0, yearly: 0, pendingThisMonth: 0, pending: [] });
  });

  it('date stepping clamps short months and returns to the anchor day', () => {
    expect(advanceDate('2026-01-31', 'monthly', 31)).toBe('2026-02-28');
    expect(advanceDate('2026-02-28', 'monthly', 31)).toBe('2026-03-31');
    expect(advanceDate('2028-01-31', 'monthly', 31)).toBe('2028-02-29');
    expect(occurrencesUntil(rule({ nextDate: '2026-12-31' }), '2026-12-30')).toEqual([]);
  });
});

describe('spending per category and subcategory (RD$ only)', () => {
  it('a subcategory budget sees its own movements; the parent sees all of them', () => {
    const txs = [exp(100, '2026-11-02', { categoryId: 'cat-food', subcategoryId: 'sub-lunch' }), exp(50, '2026-11-03', { categoryId: 'cat-food' })];
    expect(spentInCategory(txs, 'cat-food')).toBe(150);
    expect(spentInCategory(txs, 'sub-lunch')).toBe(100);
  });

  it('a budget on Bank fees sees the fees (fixed: it used to be a known gap)', () => {
    const txs = [transaction({ type: 'transfer', amount: 5000, fee: 90, accountId: 'a', toAccountId: 'b', date: '2026-11-02' }), exp(10, '2026-11-03', { categoryId: BANK_FEES_CATEGORY, fee: 5 })];
    expect(spentInCategory(txs, BANK_FEES_CATEGORY)).toBe(105);
  });

  it('a reversed movement keeps the fee the bank already charged, and its amount is out', () => {
    const txs = [exp(100, '2026-11-02', { status: 'reversed', reversedBy: 'r', fee: 4 }), exp(100, '2026-11-02', { status: 'reversed', reversalOf: 'x', origin: 'reversal' })];
    expect(spentInCategory(txs, 'cat-food')).toBe(0);
    expect(spentInCategory(txs, BANK_FEES_CATEGORY)).toBe(4);
  });

  it('US$ movements never count in a RD$ budget (fixed: it used to be a known gap)', () => {
    expect(spentInCategory([exp(100, '2026-11-02'), exp(80, '2026-11-02', { currency: 'USD' })], 'cat-food')).toBe(100);
  });

  it('sums are rounded', () => {
    expect(spentInCategory([exp(0.1, '2026-11-02'), exp(0.2, '2026-11-02')], 'cat-food')).toBe(0.3);
  });

  it('monthly totals per category and the series over the last complete months', () => {
    const txs = [exp(100, '2026-08-02'), exp(300, '2026-10-30'), exp(50, '2026-11-02'), exp(70, '2026-10-01', { categoryId: 'cat-home' })];
    expect(monthTotals(txs, '2026-10').get('cat-food')).toBe(300);
    const series = categorySeries(txs, '2026-11-15', 4);
    expect(series.get('cat-food')).toEqual([0, 100, 0, 300]); // Jul, Aug, Sep, Oct; the running month is out
    expect(series.get('cat-home')).toEqual([0, 0, 0, 70]);
  });
});

describe('blocks, base income and moves', () => {
  const b = (kind: BudgetBucketModel['kind'], over: Partial<BudgetBucketModel> = {}): BudgetBucketModel => ({ id: `bucket-${kind}`, kind, categoryIds: [], mode: 'amount', value: 0, ...over });
  const buckets = [b('food', { categoryIds: ['cat-food', 'cat-groceries'] }), b('transport', { categoryIds: ['cat-transport'] }), b('free'), b('savings', { categoryIds: ['cat-food'] })];

  it('a category goes to its block, else to "free"; manual blocks never claim categories', () => {
    expect(bucketKindOf('cat-food', buckets)).toBe('food');
    expect(bucketKindOf('custom-unmapped', buckets)).toBe('free');
    expect(bucketKindOf(undefined, buckets)).toBe('free');
  });

  it('limit by percent or by amount; spent from categories or by hand (manual blocks)', () => {
    expect(bucketLimit({ mode: 'percent', value: 25 }, 80000)).toBe(20000);
    expect(bucketLimit({ mode: 'percent', value: 33.333 }, 1000)).toBe(333.33);
    expect(bucketLimit({ mode: 'amount', value: 5000.456 }, 80000)).toBe(5000.46);
    const totals = new Map([['cat-food', 700], ['cat-groceries', 300.5], ['cat-transport', 90], ['custom-x', 10]]);
    expect(bucketSpent(buckets[0], buckets, totals, '2026-11')).toBe(1000.5);
    expect(bucketSpent(buckets[2], buckets, totals, '2026-11')).toBe(10); // free takes the unmapped one
    expect(bucketSpent(b('savings', { manualByMonth: { '2026-11': 2500 } }), buckets, totals, '2026-11')).toBe(2500);
    expect(bucketSpent(b('savings'), buckets, totals, '2026-11')).toBe(0);
  });

  it('base income: guaranteed, average of the last 3 months (default), or the real month; the active one is always reported', () => {
    const input = { guaranteed: 40000, monthsAvailable: [10000, 50000, 60000, 70000], actual: 12345.678 };
    expect(baseIncome('guaranteed', input)).toMatchObject({ amount: 40000, note: 'ok', estimate: true });
    expect(baseIncome('avg3', input)).toMatchObject({ amount: 60000, note: 'ok', estimate: true }); // 50,000 / 60,000 / 70,000
    expect(baseIncome('actual', input)).toMatchObject({ amount: 12345.68, estimate: false });
    expect(baseIncome('avg3', { guaranteed: 0, monthsAvailable: [], actual: 0 })).toMatchObject({ amount: 0, note: 'no-data' });
    expect(baseIncome('avg3', { guaranteed: 0, monthsAvailable: [0, 0, 0], actual: 0 }).note).toBe('no-data');
    expect(baseIncome('avg3', { guaranteed: 0, monthsAvailable: [900, 100], actual: 0 }).amount).toBe(500); // fewer than 3 months: the ones there are
  });

  const move = (o: Partial<BudgetMoveModel>): BudgetMoveModel => ({ id: 'm', month: '2026-11', from: { type: 'bucket', id: 'food' }, to: { type: 'bucket', id: 'free' }, amount: 1000, createdAt: 'x', ...o });

  it('moves change the limits of that month only, and an undone move changes nothing', () => {
    const moves = [move({}), move({ id: 'm2', amount: 250.5 }), move({ id: 'm3', month: '2026-12' }), move({ id: 'm4', undone: true })];
    expect(adjustedLimit(10000, moves, { type: 'bucket', id: 'food' }, '2026-11')).toBe(8749.5);
    expect(adjustedLimit(500, moves, { type: 'bucket', id: 'free' }, '2026-11')).toBe(1750.5);
    expect(adjustedLimit(500, moves, { type: 'bucket', id: 'free' }, '2026-12')).toBe(1500);
    expect(adjustedLimit(500, moves, { type: 'category', id: 'free' }, '2026-11')).toBe(500);
  });

  it('a move needs an amount, two different items of the same kind and enough limit at the origin', () => {
    const from = { type: 'bucket', id: 'food' } as const;
    const to = { type: 'bucket', id: 'free' } as const;
    expect(validateMove(from, to, 100, 500, '2026-11')).toBeNull();
    expect(validateMove(from, to, 0, 500, '2026-11')).toBe('amount');
    expect(validateMove(from, to, NaN, 500, '2026-11')).toBe('amount');
    expect(validateMove(from, from, 100, 500, '2026-11')).toBe('same');
    expect(validateMove(from, { type: 'category', id: 'x' }, 100, 500, '2026-11')).toBe('kind');
    expect(validateMove(from, to, 600, 500, '2026-11')).toBe('insufficient');
    expect(validateMove(from, to, 500, 500, '2026-11')).toBeNull();
    expect(validateMove(from, to, 1, 500, 'nov')).toBe('month');
  });
});

describe('alerts: risk of exceeding the budget (an estimate)', () => {
  const day = (d: number) => `2026-11-${String(d).padStart(2, '0')}`;

  it('already over', () => {
    expect(budgetRisk(1000, 1200, day(10), 2026, 11)).toMatchObject({ status: 'over', projected: 1200, hitDate: null });
  });

  it('at this pace you reach the limit on a given day (and the number)', () => {
    const r = budgetRisk(10000, 5000, day(10), 2026, 11); // 500 a day
    expect(r).toMatchObject({ status: 'risk', projected: 15000, basis: 'pace', estimate: true });
    expect(r.hitDate).toBe('2026-11-20');
  });

  it('projected above the threshold (90 % by default, configurable), not above the limit itself', () => {
    expect(budgetRisk(10000, 3200, day(10), 2026, 11).status).toBe('risk'); // 9,600 > 9,000
    expect(budgetRisk(10000, 3000, day(10), 2026, 11).status).toBe('ok'); // 9,000 is not above 90 %
    expect(budgetRisk(10000, 3000, day(10), 2026, 11, 80).status).toBe('risk');
    expect(budgetRisk(10000, 2000, day(10), 2026, 11).status).toBe('ok');
  });

  it('too early in the month there is no pace to read; past months are just what was spent', () => {
    expect(budgetRisk(1000, 900, day(3), 2026, 11)).toMatchObject({ status: 'ok', basis: 'spent' });
    expect(budgetRisk(1000, 900, day(10), 2026, 10)).toMatchObject({ status: 'ok', projected: 900 });
    expect(budgetRisk(1000, 1100, day(10), 2026, 10).status).toBe('over');
  });

  it('a declared pattern drives the projection', () => {
    const pattern = { projected: 5000, low: 0, high: 9000, spent: 1000 } as never;
    expect(budgetRisk(5200, 1000, day(10), 2026, 11, 90, pattern)).toMatchObject({ status: 'risk', basis: 'pattern', projected: 5000 });
  });

  it('a zero limit never alerts as "risk" and spending beyond it is "over"', () => {
    expect(budgetRisk(0, 0, day(10), 2026, 11).status).toBe('ok');
    expect(budgetRisk(0, 10, day(10), 2026, 11).status).toBe('over');
  });
});

describe('projection of the balance at the end of the month (an estimate)', () => {
  it('liquid - fixed pending - variable expected + guaranteed income still expected', () => {
    const variable = { projected: 6000, low: 4000, high: 9000, basis: 'weekly-history', estimate: true } as const;
    expect(monthEndProjection(50000, 8000, variable, 20000)).toMatchObject({ projected: 56000, low: 53000, high: 58000, estimate: true });
  });

  it('weekly rates of the variable categories; fixed categories, US$, reversed and other months stay out', () => {
    const cats = [category({ id: 'cat-food', type: 'expense' }), category({ id: 'cat-rent', type: 'expense' })];
    const txs = [
      exp(700, '2026-11-14'),
      exp(700, '2026-11-07'),
      exp(700, '2026-10-31'),
      exp(700, '2026-10-24'),
      exp(20000, '2026-11-01', { categoryId: 'cat-rent' }),
      exp(5000, '2026-11-10', { currency: 'USD' }),
      exp(5000, '2026-11-11', { status: 'reversed' }),
    ];
    const v = variableRemaining(txs, cats, '2026-11-15');
    expect(v.basis).toBe('weekly-history');
    expect(v.projected).toBe(1500); // 700 a week x 15/7 weeks
    expect(v.low).toBe(1500);
  });

  it('without enough history it falls back to this month pace and says so', () => {
    const v = variableRemaining([exp(300, '2026-11-05')], [category({ id: 'cat-food', type: 'expense' })], '2026-11-15');
    expect(v.basis).toBe('pace');
    expect(v.projected).toBe(300); // 300 in 15 days, 15 days left
  });

  it('a declared pattern replaces its category part of the estimate', () => {
    const cats = [category({ id: 'cat-lunch', type: 'expense' })];
    const patterns = new Map([['cat-lunch', { projected: 2500, spent: 1000 } as never]]);
    expect(variableRemaining([], cats, '2026-11-15', patterns).projected).toBe(1500);
  });
});

describe('recommendations from your history (deterministic, never an imposed rule)', () => {
  const history = new Map<never, number[]>([
    ['essential', [10000, 10500, 9800]],
    ['food', [11200, 9800, 12100]],
    ['transport', [3000, 3200, 2800]],
    ['entertainment', [2000, 2500, 1500]],
    ['family-home', [4000, 4000, 4000]],
    ['free', [3000, 5000, 4000]],
  ] as never);
  const fixed = [8000, 8000, 8200];

  it('median of the real spending of each block, shown with the months it comes from', () => {
    const r = recommend(60000, history, fixed);
    const food = r.buckets.find((x) => x.kind === 'food')!;
    expect(food).toMatchObject({ months: [11200, 9800, 12100], median: 11200, suggested: 11200 });
    expect(r).toMatchObject({ sufficient: true, monthsUsed: 3, obligations: 8000, variablesMedian: 30200, freeMedian: 4000, shortfall: false, estimate: true });
  });

  it('savings = what is left after the blocks and debt minimums, never below zero; free money is your usual free spending', () => {
    const r = recommend(60000, history, fixed);
    expect(r.buckets.find((x) => x.kind === 'savings')!.suggested).toBe(25800);
    expect(r.buckets.find((x) => x.kind === 'free')!.suggested).toBe(4000);
    expect(recommend(60000, history, fixed, 1500).buckets.find((x) => x.kind === 'savings')!.suggested).toBe(24300);
    expect(recommend(30000, history, fixed).buckets.find((x) => x.kind === 'savings')!.suggested).toBeGreaterThanOrEqual(0);
  });

  it('when the income does not cover the obligations it says so and invents no savings', () => {
    const r = recommend(5000, history, fixed);
    expect(r.shortfall).toBe(true);
    expect(r.buckets.find((x) => x.kind === 'savings')!.suggested).toBe(0);
    expect(r.buckets.find((x) => x.kind === 'food')!.suggested).toBe(1637.43); // scaled down so the blocks never promise more than the base
  });

  it('without any income data nothing is scaled to zero and no savings are invented', () => {
    const r = recommend(0, history, fixed);
    expect(r.buckets.find((x) => x.kind === 'food')!.suggested).toBe(11200);
    expect(r.buckets.find((x) => x.kind === 'savings')!.suggested).toBe(0);
  });

  it('manual blocks get no suggestion', () => {
    const r = recommend(60000, history, fixed);
    for (const kind of ['emergency', 'business-capital']) expect(r.buckets.find((x) => x.kind === kind)).toMatchObject({ manual: true, suggested: null });
  });

  it('with fewer than 3 months: "not enough history", no suggestions', () => {
    const short = new Map<never, number[]>([['food', [100, 200]]] as never);
    const r = recommend(60000, short, [100, 100]);
    expect(r.sufficient).toBe(false);
    expect(r.buckets.every((x) => x.suggested === null)).toBe(true);
  });

  it('the median of even and odd lists, and of nothing', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe('trends and where to reduce (estimates)', () => {
  it('slope by simple linear regression and the change against the month before', () => {
    expect(trend([100, 200, 300])).toMatchObject({ slope: 100, monthOverMonth: 50, months: 3, estimate: true });
    expect(trend([300, 200, 100])).toMatchObject({ slope: -100, monthOverMonth: -50 });
    expect(trend([500])).toMatchObject({ slope: 0, monthOverMonth: null });
    expect(trend([0, 0, 0])).toMatchObject({ slope: 0, monthOverMonth: null });
    expect(trend([])).toMatchObject({ months: 0 });
  });

  const cats = [
    category({ id: 'cat-food', type: 'expense' }),
    category({ id: 'cat-rent', type: 'expense' }),
    category({ id: 'cat-entertainment', type: 'expense' }),
    category({ id: 'cat-short', type: 'expense' }),
  ];

  it('a variable category above 120 % of its 6-month median is flagged, with the estimated saving', () => {
    const history = new Map([['cat-food', [1000, 1000, 1100, 900, 1000, 1000]], ['cat-rent', [9000, 9000, 9000, 9000, 9000, 9000]]]);
    const out = reduceCandidates(cats, history, new Map([['cat-food', 1300], ['cat-rent', 99999]]), new Map());
    expect(out).toEqual([{ categoryId: 'cat-food', current: 1300, median: 1000, reason: 'above-median', overBudgetMonths: 0, potentialSaving: 300, estimate: true }]);
    expect(reduceCandidates(cats, history, new Map([['cat-food', 1200]]), new Map())).toEqual([]); // exactly 120 % is not above
  });

  it('exceeding the budget in 3 of the last 6 months is flagged too', () => {
    const history = new Map([['cat-entertainment', [500, 600, 550, 700, 800, 900]]]);
    const out = reduceCandidates(cats, history, new Map([['cat-entertainment', 400]]), new Map([['cat-entertainment', 600]]));
    expect(out).toEqual([{ categoryId: 'cat-entertainment', current: 400, median: 650, reason: 'over-budget', overBudgetMonths: 3, potentialSaving: 0, estimate: true }]);
    expect(reduceCandidates(cats, history, new Map([['cat-entertainment', 400]]), new Map([['cat-entertainment', 850]]))).toEqual([]); // only 1 month over
  });

  it('fixed categories and categories with under 3 months of history are never flagged', () => {
    const history = new Map([['cat-short', [100, 100]], ['cat-rent', [1, 1, 1, 1, 1, 1]]]);
    expect(reduceCandidates(cats, history, new Map([['cat-short', 9999], ['cat-rent', 9999]]), new Map())).toEqual([]);
  });
});

describe('small purchases: where they pile up', () => {
  it('by category, what weighs most, with the same result as before at the default ceiling', () => {
    const items = [
      { amount: 50, categoryId: 'cat-food', note: 'Coffee' },
      { amount: 60, categoryId: 'cat-food', note: 'coffee ' },
      { amount: 80, categoryId: 'cat-transport' },
      { amount: 9000, categoryId: 'cat-shopping' },
    ];
    const r = smallBreakdown(items);
    expect(r.summary).toMatchObject({ count: 3, total: 190, threshold: 183.8 });
    expect(r.byCategory.map((c) => [c.categoryId, c.total, c.percent])).toEqual([['cat-food', 110, 58], ['cat-transport', 80, 42]]);
    expect(r.top[0]).toMatchObject({ label: 'coffee', count: 2, total: 110 });
    expect(smallBreakdown(items, 55).summary).toMatchObject({ count: 1, total: 50 });
    expect(smallBreakdown([])).toMatchObject({ byCategory: [], top: [] });
  });
});
