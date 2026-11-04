// Prompt 03 (v2.9.0): income sources, expected dates, averages, stability, guaranteed vs
// variable (rule 7), commercial sales (rule 5) and non-monetary benefits (rule 4).
import { IncomeSchedule, IncomeSourceModel } from '../models/income-source.model';
import { BenefitModel } from '../models/benefit.model';
import { transaction } from '../testing/builders';
import { addDays } from './dates';
import {
  averages,
  expectations,
  expectedDates,
  incomeCapacity,
  monthBreakdown,
  occurrencesPerMonth,
  pendingConfirmations,
  saleBenefit,
  sourceWeights,
  stability,
  upcomingExpectations,
  validSchedule,
} from './income';
import { inForce, inForceInMonth, monthUsage, monthlySaving, totalMonthlySaving, usedInMonth, validBenefit, yearToDateSaving } from './benefits';

const source = (o: Partial<IncomeSourceModel> = {}): IncomeSourceModel => ({
  id: 's1',
  name: 'Payroll',
  kind: 'payroll',
  icon: '💼',
  color: '#42a5f5',
  active: true,
  stability: 'recurring',
  method: 'transfer',
  verifiability: 'documented',
  createdAt: '2026-01-01T00:00:00Z',
  ...o,
});
const inc = (amount: number, date: string, sourceId: string | null = 's1', extra = {}) =>
  transaction({ type: 'income', amount, accountId: 'bank', date, categoryId: 'cat-salary', incomeSourceId: sourceId ?? undefined, ...extra });

describe('expected dates', () => {
  it('weekly: every Friday', () => {
    expect(expectedDates({ mode: 'weekly', weekday: 5 }, '2026-11-01', '2026-11-30')).toEqual(['2026-11-06', '2026-11-13', '2026-11-20', '2026-11-27']);
    expect(expectedDates({ mode: 'weekly', weekday: 5 }, '2026-11-06', '2026-11-06')).toEqual(['2026-11-06']); // from itself
  });

  it('days of the month (15 and 30): short months use their last day, leap year included', () => {
    const s: IncomeSchedule = { mode: 'month-days', days: [15, 30] };
    expect(expectedDates(s, '2027-02-01', '2027-03-31')).toEqual(['2027-02-15', '2027-02-28', '2027-03-15', '2027-03-30']);
    expect(expectedDates(s, '2028-02-01', '2028-02-29')).toEqual(['2028-02-15', '2028-02-29']);
    expect(expectedDates({ mode: 'month-days', days: [31] }, '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('a day that collapses onto another in a short month is listed once', () => {
    expect(expectedDates({ mode: 'month-days', days: [29, 30, 31] }, '2027-02-01', '2027-02-28')).toEqual(['2027-02-28']);
  });

  it('crosses a year end', () => {
    expect(expectedDates({ mode: 'month-days', days: [15] }, '2026-12-01', '2027-01-31')).toEqual(['2026-12-15', '2027-01-15']);
  });

  it('every N weeks / months from an anchor', () => {
    expect(expectedDates({ mode: 'every', n: 2, unit: 'weeks', anchor: '2026-11-06' }, '2026-11-01', '2026-12-31')).toEqual(['2026-11-06', '2026-11-20', '2026-12-04', '2026-12-18']);
    expect(expectedDates({ mode: 'every', n: 3, unit: 'months', anchor: '2026-01-31' }, '2026-01-01', '2026-12-31')).toEqual(['2026-01-31', '2026-04-30', '2026-07-31', '2026-10-31']);
  });

  it('every N days from a far anchor matches a plain walk', () => {
    const got = expectedDates({ mode: 'every', n: 10, unit: 'days', anchor: '2020-01-01' }, '2026-11-01', '2026-11-30');
    const walk: string[] = [];
    for (let d = '2020-01-01'; d <= '2026-11-30'; d = addDays(d, 10)) if (d >= '2026-11-01') walk.push(d);
    expect(got).toEqual(walk);
    expect(got).toHaveLength(3);
  });

  it('nothing for a missing or invalid schedule, or a reversed range', () => {
    expect(expectedDates(undefined, '2026-01-01', '2026-12-31')).toEqual([]);
    expect(expectedDates({ mode: 'month-days', days: [] }, '2026-01-01', '2026-12-31')).toEqual([]);
    expect(expectedDates({ mode: 'month-days', days: [32] }, '2026-01-01', '2026-12-31')).toEqual([]);
    expect(expectedDates({ mode: 'weekly', weekday: 5 }, '2026-12-01', '2026-11-01')).toEqual([]);
    expect(validSchedule({ mode: 'every', n: 0, unit: 'days', anchor: '2026-01-01' })).toBe(false);
    expect(validSchedule(undefined)).toBe(true);
  });

  it('payments per month, as an estimate', () => {
    expect(occurrencesPerMonth({ mode: 'month-days', days: [15, 30] })).toBe(2);
    expect(occurrencesPerMonth({ mode: 'weekly', weekday: 5 })).toBeCloseTo(4.333, 3);
    expect(occurrencesPerMonth({ mode: 'every', n: 3, unit: 'months', anchor: '2026-01-31' })).toBeCloseTo(0.333, 3);
    expect(occurrencesPerMonth(undefined)).toBe(0);
  });
});

describe('expected vs received: an unconfirmed income is an expectation, not money', () => {
  const s = source({ schedule: { mode: 'month-days', days: [15, 30] } });

  it('received (also a little early or late), pending, upcoming and skipped', () => {
    const txs = [inc(20000, '2026-11-14'), inc(20000, '2026-11-27')]; // early for the 15th, a few days early for the 30th
    const e = expectations(s, txs, '2026-11-01', '2026-12-15', '2026-11-20');
    expect(e.map((x) => [x.date, x.status])).toEqual([['2026-11-15', 'received'], ['2026-11-30', 'received'], ['2026-12-15', 'upcoming']]);
    const pending = expectations(s, [], '2026-11-01', '2026-11-30', '2026-11-20');
    expect(pending.map((x) => x.status)).toEqual(['pending', 'upcoming']);
    const skipped = expectations({ ...s, skippedDates: ['2026-11-15'] }, [], '2026-11-01', '2026-11-30', '2026-11-20');
    expect(skipped[0].status).toBe('skipped');
  });

  it('a movement satisfies only one date, and only of its own source', () => {
    const e = expectations(s, [inc(20000, '2026-11-15'), inc(5, '2026-11-15', 'other')], '2026-11-15', '2026-11-16', '2026-11-20');
    expect(e).toHaveLength(1);
    expect(e[0].status).toBe('received');
    const twoDates = expectations(source({ schedule: { mode: 'month-days', days: [15, 16] } }), [inc(1, '2026-11-15')], '2026-11-15', '2026-11-16', '2026-11-20');
    expect(twoDates.map((x) => x.status)).toEqual(['received', 'pending']);
  });

  it('a reversed or adjustment movement does not count as received', () => {
    const reversed = inc(20000, '2026-11-15', 's1', { status: 'reversed' });
    expect(expectations(s, [reversed], '2026-11-15', '2026-11-15', '2026-11-20')[0].status).toBe('pending');
  });

  it('inactive sources and sources without schedule expect nothing', () => {
    expect(expectations({ ...s, active: false }, [], '2026-11-01', '2026-11-30', '2026-11-20')).toEqual([]);
    expect(expectations(source(), [], '2026-11-01', '2026-11-30', '2026-11-20')).toEqual([]);
  });

  it('"did it arrive?" lists what passed unconfirmed in the last two weeks; upcoming lists the next week', () => {
    expect(pendingConfirmations([s], [], '2026-11-20').map((x) => x.date)).toEqual(['2026-11-15']);
    expect(pendingConfirmations([s], [inc(1, '2026-11-15')], '2026-11-20')).toEqual([]);
    expect(pendingConfirmations([s], [], '2026-12-20', 14).map((x) => x.date)).toEqual(['2026-12-15']); // old pending ones age out
    expect(upcomingExpectations([s], [], '2026-11-25', 7).map((x) => x.date)).toEqual(['2026-11-30']);
  });
});

describe('averages (an estimate, with its assumptions)', () => {
  const today = '2026-11-15';

  it('counts empty months as zero from the first income on, and leaves the running month out', () => {
    const a = averages([inc(1000, '2026-08-10'), inc(3000, '2026-10-10'), inc(500, '2026-11-05')], today);
    expect(a).toEqual({ months: 3, monthly: 1333.33, quarterly: 3999.99, annual: 15999.96, currentMonthSoFar: 500, estimate: true });
  });

  it('is based on the last 6 complete months at most', () => {
    const txs = Array.from({ length: 12 }, (_, i) => inc(100, `${i < 2 ? 2025 : 2026}-${String(((i + 10) % 12) + 1).padStart(2, '0')}-10`));
    expect(averages(txs, today).months).toBe(6);
  });

  it('no history, only the running month, or other currencies: zeros', () => {
    expect(averages([], today)).toMatchObject({ months: 0, monthly: 0 });
    expect(averages([inc(500, '2026-11-05')], today)).toMatchObject({ months: 0, monthly: 0, currentMonthSoFar: 500 });
    expect(averages([inc(900, '2026-09-05', 's1', { currency: 'USD' })], today).months).toBe(0);
  });
});

describe('stability: calculated next to declared', () => {
  const today = '2026-11-15';
  const months = (values: number[]) => values.map((v, i) => inc(v, `2026-${String(6 + i).padStart(2, '0')}-10`)).filter((t) => t.amount > 0);

  it('with fewer than 3 months it says there is not enough history', () => {
    expect(stability([inc(1000, '2026-09-10'), inc(1000, '2026-10-10')], 'recurring', today)).toMatchObject({ calculated: 'insufficient', cv: null, mismatch: false, months: 2 });
    expect(stability([], 'recurring', today).calculated).toBe('insufficient');
  });

  it('constant income reads stable', () => {
    expect(stability(months([1000, 1000, 1000, 1000, 1000]), 'recurring', today)).toMatchObject({ calculated: 'stable', cv: 0, mismatch: false });
  });

  it('declared recurring but it varied: flags the mismatch with how much', () => {
    const r = stability([inc(1000, '2026-08-10'), inc(3000, '2026-10-10')], 'recurring', today);
    expect(r).toMatchObject({ calculated: 'variable', mismatch: true, variationPercent: 94, months: 3 });
    expect(stability([inc(1000, '2026-08-10'), inc(3000, '2026-10-10')], 'variable', today).mismatch).toBe(false);
  });

  it('declared variable but it never moved: flags it too', () => {
    expect(stability(months([1000, 1000, 1000, 1000, 1000]), 'variable', today).mismatch).toBe(true);
    expect(stability(months([1000, 1000, 1000, 1000, 1000]), 'occasional', today).mismatch).toBe(false);
  });
});

describe('rule 7: guaranteed = recurring AND documented; variable apart', () => {
  const today = '2026-11-15';
  const sources = [
    source({ id: 'pay', stability: 'recurring', verifiability: 'documented', expectedNet: 20000, schedule: { mode: 'month-days', days: [15, 30] } }),
    source({ id: 'weekly', kind: 'bonus-commission', stability: 'recurring', verifiability: 'documented', expectedNet: 1000, schedule: { mode: 'weekly', weekday: 5 } }),
    source({ id: 'declared', stability: 'recurring', verifiability: 'declared', expectedNet: 9999, schedule: { mode: 'month-days', days: [1] } }),
    source({ id: 'free', kind: 'freelance', stability: 'variable', verifiability: 'documented' }),
    source({ id: 'shop', kind: 'commercial-sales', stability: 'recurring', verifiability: 'documented', expectedNet: 50000, schedule: { mode: 'month-days', days: [1] } }),
    source({ id: 'nofigure', stability: 'recurring', verifiability: 'documented' }),
    source({ id: 'off', active: false, stability: 'recurring', verifiability: 'documented', expectedNet: 5000, schedule: { mode: 'month-days', days: [1] } }),
  ];
  const txs = [inc(3000, '2026-09-10', 'free'), inc(1000, '2026-10-10', 'free'), inc(2000, '2026-10-12', 'declared')];

  it('only recurring + documented personal sources are guaranteed, with their expected net', () => {
    const c = incomeCapacity(sources, txs, today);
    expect(c.guaranteedMonthly).toBe(44333.33); // 40,000 + 1,000 x 52/12
    expect(c.guaranteedSources).toEqual(['pay', 'weekly']);
    expect(c.estimate).toBe(true);
  });

  it('declared, variable, commercial, inactive and figure-less sources add nothing to the guaranteed amount', () => {
    const c = incomeCapacity(sources, txs, today);
    expect(c.guaranteedSources).not.toContain('declared');
    expect(c.guaranteedSources).not.toContain('free');
    expect(c.guaranteedSources).not.toContain('shop');
    expect(c.guaranteedSources).not.toContain('off');
    expect(c.missingExpected).toEqual(['nofigure']);
  });

  it('the variable contribution is an average shown apart, and never enters the guaranteed', () => {
    const c = incomeCapacity(sources, txs, today);
    // free: Sep 3,000 + Oct 1,000 over 2 months = 2,000; declared: Oct 2,000 over 1 month = 2,000
    expect(c.variableAverage).toBe(4000);
    expect(c.variableSources.sort()).toEqual(['declared', 'free']);
    const more = incomeCapacity(sources, [...txs, inc(99999, '2026-10-20', 'free')], today);
    expect(more.guaranteedMonthly).toBe(c.guaranteedMonthly);
  });
});

describe('rule 5: a sale is revenue, the benefit is price - cost - expenses', () => {
  it('benefit of a sale; unknown without a cost', () => {
    expect(saleBenefit({ amount: 50000, costBasis: 42000, saleExpenses: 1000 })).toBe(7000);
    expect(saleBenefit({ amount: 50000, costBasis: 42000 })).toBe(8000);
    expect(saleBenefit({ amount: 40000, costBasis: 42000 })).toBe(-2000); // a loss is a loss
    expect(saleBenefit({ amount: 50000 })).toBeUndefined();
  });

  const sources = [source({ id: 'p' }), source({ id: 'f', kind: 'freelance' }), source({ id: 'c', kind: 'commercial-sales', stability: 'variable' }), source({ id: 'x', kind: 'custom', customKind: 'Rent' })];
  const txs = [
    inc(20000, '2026-11-02', 'p'),
    inc(3000, '2026-11-05', 'f'),
    inc(500, '2026-11-06', 'x'),
    inc(50000, '2026-11-07', 'c', { costBasis: 42000, saleExpenses: 1000 }),
    inc(10000, '2026-11-08', 'c'), // no cost declared
    inc(700, '2026-11-09', null),
    inc(111, '2026-11-09', 'p', { currency: 'USD' }),
    inc(222, '2026-11-09', 'p', { status: 'reversed' }),
    transaction({ type: 'transfer', amount: 9999, accountId: 'bank', toAccountId: 'other', date: '2026-11-10' }),
    inc(8888, '2026-10-30', 'p'),
  ];

  it('splits personal income, commercial revenue and benefit, and unclassified; none of it mixes', () => {
    const b = monthBreakdown(txs, sources, 2026, 11, '2026-11-20');
    expect(b.personalNet).toBe(23500);
    expect(b.personalByKind).toEqual({ payroll: 20000, freelance: 3000, custom: 500 });
    expect(b.commercialGross).toBe(60000);
    expect(b.commercialNetBenefit).toBe(7000);
    expect(b.commercialWithoutCost).toBe(1);
    expect(b.unclassified).toBe(700);
  });

  it('available income = personal net + commercial net benefit (revenue and unclassified stay out)', () => {
    const b = monthBreakdown(txs, sources, 2026, 11, '2026-11-20');
    expect(b.available).toBe(30500);
    expect(b.available).not.toBe(b.personalNet + b.commercialGross);
  });

  it('a sale without a cost contributes revenue but no benefit (it is not zero, it is unknown)', () => {
    const b = monthBreakdown([inc(10000, '2026-11-08', 'c')], sources, 2026, 11, '2026-11-20');
    expect(b).toMatchObject({ commercialGross: 10000, commercialNetBenefit: 0, commercialWithoutCost: 1, available: 0 });
  });

  it('an empty month, and income of a deleted source (unclassified)', () => {
    expect(monthBreakdown([], sources, 2026, 11, '2026-11-20')).toMatchObject({ personalNet: 0, available: 0, unclassified: 0 });
    expect(monthBreakdown([inc(100, '2026-11-08', 'gone')], sources, 2026, 11, '2026-11-20').unclassified).toBe(100);
  });

  it('weights of each source in a period', () => {
    const w = sourceWeights(txs, '2026-11-01', '2026-11-30');
    expect(w[0]).toMatchObject({ sourceId: 'c', total: 60000 });
    expect(w.reduce((s, x) => s + x.percent, 0)).toBeCloseTo(100, 0);
    expect(w.find((x) => x.sourceId === null)?.total).toBe(700);
    expect(sourceWeights([], '2026-11-01', '2026-11-30')).toEqual([]);
  });
});

describe('rule 4: benefits are estimates, never money', () => {
  const fuel: BenefitModel = { id: 'b1', name: 'Fuel card', kind: 'fuel-card', monthlyValue: 8000, monthlyLimit: 10000, active: true, uses: [] };

  it('usage and limit of the month', () => {
    const b = { ...fuel, uses: [{ id: 'u1', date: '2026-11-03', amount: 2500.5 }, { id: 'u2', date: '2026-11-20', amount: 1000 }, { id: 'u3', date: '2026-10-30', amount: 777 }] };
    expect(usedInMonth(b, 2026, 11)).toBe(3500.5);
    expect(monthUsage(b, 2026, 11)).toEqual({ used: 3500.5, limit: 10000, percentOfLimit: 35, remaining: 6499.5, overLimit: false });
    expect(monthUsage({ ...b, uses: [{ id: 'x', date: '2026-11-01', amount: 12000 }] }, 2026, 11)).toMatchObject({ remaining: 0, overLimit: true, percentOfLimit: 120 });
    expect(monthUsage({ ...fuel, monthlyLimit: undefined }, 2026, 11)).toMatchObject({ percentOfLimit: null, remaining: undefined, overLimit: false });
  });

  it('estimated saving: what was really used, else the estimated monthly value', () => {
    expect(monthlySaving(fuel, 2026, 11)).toBe(8000);
    expect(monthlySaving({ ...fuel, uses: [{ id: 'u', date: '2026-11-03', amount: 3000 }] }, 2026, 11)).toBe(3000);
  });

  it('validity dates and the active flag', () => {
    const b = { ...fuel, validFrom: '2026-03-01', validTo: '2026-09-15' };
    expect(inForce(b, '2026-03-01')).toBe(true);
    expect(inForce(b, '2026-09-16')).toBe(false);
    expect(inForceInMonth(b, 2026, 9)).toBe(true);
    expect(inForceInMonth(b, 2026, 10)).toBe(false);
    expect(monthlySaving(b, 2026, 10)).toBe(0);
    expect(monthlySaving({ ...fuel, active: false }, 2026, 11)).toBe(0);
  });

  it('month and year-to-date totals', () => {
    const health: BenefitModel = { id: 'b2', name: 'Health insurance', kind: 'health-insurance', monthlyValue: 3000, active: true, validFrom: '2026-02-01', uses: [] };
    expect(totalMonthlySaving([fuel, health], 2026, 11)).toBe(11000);
    expect(yearToDateSaving([fuel, health], 2026, 3)).toBe(8000 * 3 + 3000 * 2);
    expect(totalMonthlySaving([], 2026, 11)).toBe(0);
  });

  it('validation of a benefit', () => {
    expect(validBenefit(fuel)).toBe(true);
    expect(validBenefit({ ...fuel, name: '  ' })).toBe(false);
    expect(validBenefit({ ...fuel, monthlyValue: -1 })).toBe(false);
    expect(validBenefit({ ...fuel, validFrom: '2026-05-01', validTo: '2026-04-01' })).toBe(false);
    expect(validBenefit({ ...fuel, monthlyLimit: NaN })).toBe(false);
  });
});
