// The deterministic detectors (2.15.0). Each is a pure function over plain data: it says how much
// history it needs and has, never fabricates a result without it, and returns insights whose
// evidence lets the user see where every figure comes from. Money is RD$ only. Non-monetary
// benefits are not an input of any detector (integrity rule 4).
import { IncomeSourceModel, isCommercialKind } from '../../models/income-source.model';
import { TransactionModel } from '../../models/transaction.model';
import { addMoney, round2, subMoney, sumMoney } from '../../utils/money';
import { CapacityResult, IncomeTiers, Obligations, evaluateCapacity } from '../borrowing';
import { BucketKind } from '../../models/budget.model';
import { BUCKET_LABELS } from '../../data/bucket-labels';
import { Recommendation, median } from '../budget';
import { addDays, daysBetween, lastCompleteMonths, shiftMonthKey } from '../dates';
import { isIncomeTx, occurrencesPerMonth } from '../income';
import { smallPurchases } from '../small-purchases';
import { isCounted } from '../stats';
import { LoanSettings } from '../../models/loan.model';
import { fmtMoney, fmtPct, isDop, makeInsight, mean, quartiles, round, stdev } from './helpers';
import { DetectorResult, Estimate, Insight, estimate, insufficient, ok } from './types';

export type Thresholds = Record<string, number>;
export interface CatLite {
  id: string;
  name: string;
  parentId?: string;
}
export interface AccLite {
  id: string;
  name: string;
  type: string;
}

const monthOf = (iso: string): string => iso.slice(0, 7);
const counted = (t: TransactionModel): boolean => t.type === 'expense' && isCounted(t) && isDop(t);

// ===== a) small expenses that add up (by category, account and card)

export interface SmallInput {
  today: string;
  txs: readonly TransactionModel[];
  categories: readonly CatLite[];
  accounts: readonly AccLite[];
  ceiling?: number;
}

export function detectSmallExpenses(d: SmallInput, t: Thresholds): DetectorResult {
  const from = addDays(d.today, -29);
  let first: string | null = null;
  for (const x of d.txs) if (counted(x) && (first === null || x.date < first)) first = x.date;
  const have = first ? Math.min(30, daysBetween(first, d.today) + 1) : 0;
  const need = { needed: 14, have, unit: 'days' as const };
  if (have < 14) return insufficient('small-expenses', need);

  const items = d.txs.filter((x) => counted(x) && x.date >= from && x.date <= d.today);
  const summary = smallPurchases(
    items.map((i) => i.amount),
    d.ceiling
  );
  if (!summary.count) return ok('small-expenses', need, []);
  const cats = new Map(d.categories.map((c) => [c.id, c.name]));
  const accs = new Map(d.accounts.map((a) => [a.id, a]));
  type G = { name: string; all: number; small: number; count: number; ids: string[] };
  const dims: Record<'category' | 'account' | 'card', Map<string, G>> = { category: new Map(), account: new Map(), card: new Map() };
  const bump = (dim: keyof typeof dims, key: string, name: string, amount: number, id: string) => {
    const g = dims[dim].get(key) ?? { name, all: 0, small: 0, count: 0, ids: [] };
    g.all = addMoney(g.all, amount);
    if (amount <= summary.threshold) {
      g.small = addMoney(g.small, amount);
      g.count++;
      if (g.ids.length < 40) g.ids.push(id);
    }
    dims[dim].set(key, g);
  };
  for (const i of items) {
    if (i.categoryId) bump('category', i.categoryId, cats.get(i.categoryId) ?? '', i.amount, i.id);
    const a = accs.get(i.accountId);
    if (a) bump(a.type === 'card' ? 'card' : 'account', a.id, a.name, i.amount, i.id);
  }
  const out: Insight[] = [];
  for (const dim of ['category', 'account', 'card'] as const) {
    const best = [...dims[dim].entries()]
      .map(([key, g]) => ({ key, g, share: g.all > 0 ? (g.small / g.all) * 100 : 0 }))
      .filter((x) => x.g.count >= t['minCount'] && x.g.small >= t['minTotal'] && x.share >= t['minSharePercent'])
      .sort((a, b) => b.g.small - a.g.small)[0];
    if (!best) continue;
    const period = `${from}..${d.today}`;
    out.push(
      makeInsight({
        id: `small-expenses:${dim}:${best.key}`,
        rule: 'small-expenses',
        module: dim === 'card' ? 'cards' : 'spending',
        severity: best.share >= 30 ? 'attention' : 'info',
        titleKey: 'Small purchases are adding up',
        messageKey: dim === 'category' ? 'In the last 30 days, {count} small purchases in {name} added up to {amount} ({share} of what you spent there).' : dim === 'card' ? 'In the last 30 days, {count} small purchases on the card {name} added up to {amount} ({share} of its spending).' : 'In the last 30 days, {count} small purchases from {name} added up to {amount} ({share} of its spending).',
        params: { count: String(best.g.count), name: best.g.name, amount: fmtMoney(best.g.small), share: fmtPct(best.share) },
        evidence: [
          { label: 'Small purchases', value: best.g.count, kind: 'count', source: { period, txIds: best.g.ids } },
          { label: 'Total of small purchases', value: best.g.small, kind: 'money', source: { period } },
          { label: 'Share of its spending', value: round(best.share), kind: 'percent', source: { period } },
          { label: 'Small purchase ceiling', value: summary.threshold, kind: 'money' },
        ],
        formula: 'Purchases at or below the ceiling, added up over the last 30 days and compared with all the spending of the same category, account or card.',
        dataState: 'confirmed',
        period,
        actions: [{ labelKey: 'See the movements', link: '/transactions' }],
      })
    );
  }
  return ok('small-expenses', need, out);
}

// ===== b) unusual increases in consumption (month against its 6-month median and IQR)

export interface UnusualInput {
  today: string;
  txs: readonly TransactionModel[];
  categories: readonly CatLite[];
}

export function detectUnusualIncrease(d: UnusualInput, t: Thresholds): DetectorResult {
  const months = lastCompleteMonths(d.today, 7); // oldest .. newest
  const compared = months[6];
  const wanted = new Set(months);
  const byMonth = new Map<string, Map<string, number>>(months.map((m) => [m, new Map()]));
  for (const x of d.txs) {
    if (!counted(x)) continue;
    const m = monthOf(x.date);
    if (!wanted.has(m)) continue;
    const cat = byMonth.get(m)!;
    const key = x.categoryId ?? '';
    cat.set(key, addMoney(cat.get(key) ?? 0, x.amount));
  }
  const totalOf = (m: string) => sumMoney([...byMonth.get(m)!.values()]);
  const withData = months.filter((m) => totalOf(m) > 0);
  const firstData = withData[0];
  const baseline = firstData ? months.slice(0, 6).filter((m) => m >= firstData) : [];
  const have = baseline.length + (totalOf(compared) > 0 ? 1 : 0);
  const need = { needed: 5, have, unit: 'months' as const };
  if (baseline.length < 4 || totalOf(compared) <= 0) return insufficient('unusual-increase', need);

  const names = new Map(d.categories.map((c) => [c.id, c.name]));
  const test = (values: number[], value: number) => {
    const q = quartiles(values);
    const threshold = Math.max(q.q3 + 1.5 * q.iqr, q.median * (1 + t['minRisePercent'] / 100));
    return { q, threshold, flagged: value > threshold && value - q.median >= t['minAmount'] };
  };
  const out: Insight[] = [];
  const make = (id: string, name: string | null, value: number, r: ReturnType<typeof test>) =>
    makeInsight({
      id,
      rule: 'unusual-increase',
      module: 'spending',
      severity: value > r.q.median * 2 ? 'alert' : 'attention',
      titleKey: name === null ? 'Your spending rose far above its usual level' : 'Spending rose far above its usual level',
      messageKey: name === null ? 'Last month you spent {amount}, {rise} above your 6-month median of {median}.' : 'In {name} you spent {amount} last month, {rise} above its 6-month median of {median}.',
      params: { name: name ?? '', amount: fmtMoney(value), median: fmtMoney(r.q.median), rise: fmtPct(r.q.median > 0 ? ((value - r.q.median) / r.q.median) * 100 : 100) },
      evidence: [
        { label: 'Spent last month', value, kind: 'money', source: { period: compared } },
        { label: 'Median of the previous months', value: r.q.median, kind: 'money', source: { period: `${baseline[0]}..${baseline[baseline.length - 1]}` } },
        { label: 'Upper quartile (Q3)', value: r.q.q3, kind: 'money' },
        { label: 'Interquartile range', value: r.q.iqr, kind: 'money' },
        { label: 'Months compared', value: baseline.length, kind: 'count' },
      ],
      formula: 'Last month compared with the median and the interquartile range of the previous months: it is flagged above Q3 + 1.5 × the range and above the minimum rise.',
      dataState: 'confirmed',
      period: compared,
      actions: [{ labelKey: 'Open the analysis', link: '/analysis' }],
    });

  const totals = test(baseline.map(totalOf), totalOf(compared));
  if (totals.flagged) out.push(make('unusual-increase:total', null, totalOf(compared), totals));
  const cats = [...byMonth.get(compared)!.keys()]
    .map((id) => {
      const values = baseline.map((m) => byMonth.get(m)!.get(id) ?? 0);
      const value = byMonth.get(compared)!.get(id) ?? 0;
      return { id, value, r: test(values, value) };
    })
    .filter((x) => x.r.flagged)
    .sort((a, b) => b.value - b.r.q.median - (a.value - a.r.q.median))
    .slice(0, 3);
  for (const c of cats) out.push(make(`unusual-increase:cat:${c.id || 'none'}`, names.get(c.id) ?? '', c.value, c.r));
  return ok('unusual-increase', need, out);
}

// ===== c) months with lower saving capacity (and seasonal patterns)

export interface MonthSavings {
  month: string;
  available: number; // available income (personal net + commercial net benefit)
  expense: number;
}

export function detectLowSavings(d: { today: string; months: readonly MonthSavings[] }, t: Thresholds): DetectorResult {
  const need = { needed: 6, have: d.months.length, unit: 'months' as const };
  if (d.months.length < 6) return insufficient('low-savings', need);
  const series = d.months.map((m) => ({ month: m.month, saving: subMoney(m.available, m.expense) }));
  const med = median(series.map((s) => s.saving));
  const low = (v: number) => v < med - (Math.abs(med) * t['dropPercent']) / 100;
  const out: Insight[] = [];
  const last = series[series.length - 1];
  if (low(last.saving)) {
    out.push(
      makeInsight({
        id: 'low-savings:last',
        rule: 'low-savings',
        module: 'savings',
        severity: last.saving < 0 ? 'alert' : 'attention',
        titleKey: 'You saved much less than usual',
        messageKey: 'Last month you saved {saving}, well below your usual {median}.',
        params: { saving: fmtMoney(last.saving), median: fmtMoney(med) },
        evidence: [
          { label: 'Saved last month', value: last.saving, kind: 'money', source: { period: last.month } },
          { label: 'Median monthly saving', value: med, kind: 'money', source: { period: `${series[0].month}..${last.month}` } },
          { label: 'Months compared', value: series.length, kind: 'count' },
        ],
        formula: 'Saving = available income − counted expenses, for each month; compared with the median of all the months.',
        dataState: 'confirmed',
        period: last.month,
        actions: [{ labelKey: 'Open the budget plan', link: '/budgets/plan' }],
      })
    );
  }
  if (d.months.length >= 12) {
    const next = shiftMonthKey(monthOf(d.today), 1);
    const sameMonth = series.filter((s) => s.month.slice(5) === next.slice(5) && s.month < next);
    if (sameMonth.length && sameMonth.every((s) => low(s.saving))) {
      out.push(
        makeInsight({
          id: `low-savings:seasonal:${next.slice(5)}`,
          rule: 'low-savings',
          module: 'savings',
          severity: 'attention',
          titleKey: 'A month that usually leaves little saving is coming',
          messageKey: 'In the same month of earlier years you saved far less than usual (median {median}). Plan ahead.',
          params: { median: fmtMoney(med) },
          evidence: [
            ...sameMonth.map((s) => ({ label: 'Saved in the same month', value: s.saving, kind: 'money' as const, source: { period: s.month } })),
            { label: 'Median monthly saving', value: med, kind: 'money' },
          ],
          formula: 'The same calendar month was below the median saving in every earlier year with data (at least 12 months of history).',
          dataState: 'estimate',
          period: next,
          actions: [{ labelKey: 'Open the budget plan', link: '/budgets/plan' }],
        })
      );
    }
  }
  return ok('low-savings', need, out);
}

// ===== d) recommended budget adjustments

export function detectBudgetAdjustments(d: { rec: Recommendation; limits: Partial<Record<BucketKind, number>> }, t: Thresholds): DetectorResult {
  const need = { needed: 3, have: d.rec.monthsUsed, unit: 'months' as const };
  if (!d.rec.sufficient) return insufficient('budget-adjust', need);
  const out: Insight[] = [];
  if (d.rec.shortfall) {
    out.push(
      makeInsight({
        id: 'budget-adjust:shortfall',
        rule: 'budget-adjust',
        module: 'budget',
        severity: 'alert',
        titleKey: 'Your income base does not cover your obligations',
        messageKey: 'Your base income of {base} is below what your fixed obligations and debt payments take ({obligations}).',
        params: { base: fmtMoney(d.rec.base), obligations: fmtMoney(round2(d.rec.obligations + d.rec.debtMinimums)) },
        evidence: [
          { label: 'Base income', value: d.rec.base, kind: 'money' },
          { label: 'Fixed obligations (median)', value: d.rec.obligations, kind: 'money' },
          { label: 'Debt payments', value: d.rec.debtMinimums, kind: 'money' },
        ],
        formula: 'Base income compared with the median of the fixed spending plus the debt payments.',
        dataState: 'estimate',
        period: `${d.rec.monthsUsed} months`,
        actions: [{ labelKey: 'Open the budget plan', link: '/budgets/plan' }],
      })
    );
  }
  const gaps = d.rec.buckets
    .filter((b) => !b.manual && b.suggested !== null && b.suggested > 0 && (d.limits[b.kind] ?? 0) > 0)
    .map((b) => ({ b, limit: d.limits[b.kind]!, gap: ((d.limits[b.kind]! - b.suggested!) / b.suggested!) * 100 }))
    .filter((x) => Math.abs(x.gap) >= t['gapPercent'])
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
    .slice(0, 3);
  for (const g of gaps) {
    out.push(
      makeInsight({
        id: `budget-adjust:${g.b.kind}`,
        rule: 'budget-adjust',
        module: 'budget',
        severity: 'info',
        titleKey: g.gap > 0 ? 'A block limit is above what your history suggests' : 'A block limit is below what your history suggests',
        messageKey: 'The limit of {block} is {limit}; your history suggests about {suggested} ({gap} apart).',
        params: { block: BUCKET_LABELS[g.b.kind], limit: fmtMoney(g.limit), suggested: fmtMoney(g.b.suggested!), gap: fmtPct(Math.abs(g.gap)) },
        translateParams: ['block'],
        evidence: [
          { label: 'Current limit', value: g.limit, kind: 'money' },
          { label: 'Suggested from your history', value: g.b.suggested!, kind: 'money' },
          { label: 'Median of the block', value: g.b.median, kind: 'money' },
          { label: 'Months used', value: d.rec.monthsUsed, kind: 'count' },
        ],
        formula: 'The median of the monthly spending of the block over the last 3 to 6 months, never an imposed percentage.',
        dataState: 'estimate',
        period: `${d.rec.monthsUsed} months`,
        actions: [{ labelKey: 'Open the budget plan', link: '/budgets/plan' }],
      })
    );
  }
  return ok('budget-adjust', need, out);
}

// ===== e) how much you can set aside each month

export interface ReservableInput {
  guaranteed: number;
  fixed: number;
  variableMedian: number;
  variableHigh: number; // an upper figure of the variable spending (conservative reading)
  debt: number;
  variableMonths: number;
}

export function reservableEstimate(i: ReservableInput, safetyPercent: number): Estimate<number> {
  const safety = (v: number) => round2((v * safetyPercent) / 100);
  const expected = round2(i.guaranteed - i.fixed - i.variableMedian - i.debt - safety(i.variableMedian));
  const conservative = round2(i.guaranteed - i.fixed - Math.max(i.variableMedian, i.variableHigh) - i.debt - safety(Math.max(i.variableMedian, i.variableHigh)));
  return estimate(expected, Math.min(conservative, expected), expected, [
    'Counts only guaranteed income (recurring and documented), never variable income or non-monetary benefits.',
    'Subtracts fixed obligations, the median of the variable spending and the debt payments.',
    'Keeps a safety margin over the variable spending; the conservative figure uses a higher variable spending.',
  ]);
}

export function detectReservable(d: ReservableInput, t: Thresholds): DetectorResult {
  if (d.guaranteed <= 0) return insufficient('reservable', { needed: 1, have: 0, unit: 'sources' });
  const need = { needed: 3, have: d.variableMonths, unit: 'months' as const };
  if (d.variableMonths < 3) return insufficient('reservable', need);
  const e = reservableEstimate(d, t['safetyPercent']);
  return ok('reservable', need, [
    makeInsight({
      id: 'reservable:month',
      rule: 'reservable',
      module: 'savings',
      severity: e.value <= 0 ? 'attention' : 'info',
      titleKey: e.value <= 0 ? 'There is no margin to set aside each month' : 'You can probably set aside each month',
      messageKey: e.value <= 0 ? 'Your guaranteed income does not leave anything over after fixed, variable and debt payments (about {value}).' : 'About {value} a month (between {low} and {high}). This is an estimate.',
      params: { value: fmtMoney(e.value), low: fmtMoney(e.low), high: fmtMoney(e.high) },
      evidence: [
        { label: 'Guaranteed income', value: d.guaranteed, kind: 'money' },
        { label: 'Fixed obligations', value: d.fixed, kind: 'money' },
        { label: 'Median of the variable spending', value: d.variableMedian, kind: 'money', source: { period: `${d.variableMonths} months` } },
        { label: 'Debt payments', value: d.debt, kind: 'money' },
        { label: 'Safety margin', value: round2((d.variableMedian * t['safetyPercent']) / 100), kind: 'money' },
        { label: 'Conservative figure', value: e.low, kind: 'money' },
      ],
      formula: 'Guaranteed income − fixed obligations − median of the variable spending − debt payments − safety margin.',
      dataState: 'estimate',
      period: `${d.variableMonths} months`,
      actions: [{ labelKey: 'Open the goals', link: '/goals' }],
    }),
  ]);
}

// ===== f) dependence on variable income

export interface IncomeMonth {
  month: string;
  available: number; // personal net + commercial net benefit
  unclassified: number; // income without a source: treated as not guaranteed
}

export function detectVariableDependence(d: { txs: readonly TransactionModel[]; sources: readonly IncomeSourceModel[]; months: readonly IncomeMonth[] }, t: Thresholds): DetectorResult {
  const withIncome = d.months.filter((m) => m.available + m.unclassified > 0);
  const need = { needed: 3, have: withIncome.length, unit: 'months' as const };
  if (withIncome.length < 3) return insufficient('variable-dependence', need);
  const guaranteed = new Set(d.sources.filter((s) => s.active && s.stability === 'recurring' && s.verifiability === 'documented' && !isCommercialKind(s.kind)).map((s) => s.id));
  const keys = new Set(d.months.map((m) => m.month));
  let guaranteedReceived = 0;
  for (const x of d.txs) if (x.incomeSourceId && guaranteed.has(x.incomeSourceId) && isIncomeTx(x) && keys.has(monthOf(x.date))) guaranteedReceived = addMoney(guaranteedReceived, x.amount);
  const totals = d.months.map((m) => addMoney(m.available, m.unclassified));
  const total = sumMoney(totals);
  const variable = Math.max(0, subMoney(total, guaranteedReceived));
  const share = total > 0 ? (variable / total) * 100 : 0;
  const cv = mean(totals) > 0 ? (stdev(totals) / mean(totals)) * 100 : 0;
  if (share < t['sharePercent']) return ok('variable-dependence', need, []);
  const period = `${d.months[0].month}..${d.months[d.months.length - 1].month}`;
  return ok('variable-dependence', need, [
    makeInsight({
      id: 'variable-dependence:income',
      rule: 'variable-dependence',
      module: 'income',
      severity: share >= 70 ? 'alert' : 'attention',
      titleKey: 'Much of your income is variable',
      messageKey: '{share} of your income in the last 6 months came from variable sources (it moves about {cv} from month to month). Consider budgeting only with your guaranteed income.',
      params: { share: fmtPct(share), cv: fmtPct(cv) },
      evidence: [
        { label: 'Share of variable income', value: round(share), kind: 'percent', source: { period } },
        { label: 'Variation between months (coefficient of variation)', value: round(cv), kind: 'percent', source: { period } },
        { label: 'Total income', value: total, kind: 'money', source: { period } },
        { label: 'Received from guaranteed sources', value: guaranteedReceived, kind: 'money', source: { period } },
      ],
      formula: 'Variable income = total income − income from recurring and documented sources; the variation is the standard deviation of the monthly totals divided by their mean.',
      dataState: 'confirmed',
      period,
      actions: [{ labelKey: 'Open the income sources', link: '/income' }],
    }),
  ]);
}

// ===== g) sustainability of a new debt (on demand, uses the capacity of prompt 08)

export interface DebtSustainability {
  rule: 'commitments';
  status: 'ok' | 'insufficient-history';
  insight: Insight | null;
  base: CapacityResult | null;
  stressed: CapacityResult | null;
  monthsOfReserve: number | null;
}

// Stress test: the variable income levels (business and declared) fall by `stress` percent. Salary
// and bonuses are untouched. Non-monetary benefits are not an input.
export function newDebtSustainability(d: { tiers: IncomeTiers; settings: LoanSettings; obligations: Obligations; installmentMonthly: number; liquid: number }, stress = 20): DebtSustainability {
  const income = d.tiers.salary + d.tiers.bonuses + d.tiers.commercial + d.tiers.declared;
  if (income <= 0 || !(d.installmentMonthly > 0)) return { rule: 'commitments', status: 'insufficient-history', insight: null, base: null, stressed: null, monthsOfReserve: null };
  const base = evaluateCapacity(d.tiers, d.settings, d.obligations, d.installmentMonthly);
  const factor = 1 - stress / 100;
  const stressedTiers: IncomeTiers = { ...d.tiers, commercial: round2(d.tiers.commercial * factor), declared: round2(d.tiers.declared * factor) };
  const stressed = evaluateCapacity(stressedTiers, d.settings, d.obligations, d.installmentMonthly);
  const monthsOfReserve = round(Math.max(0, d.liquid) / d.installmentMonthly);
  const worst = stressed.rows[0]; // the conservative reading
  const severity = worst.status === 'risky' ? 'alert' : worst.status === 'tight' || monthsOfReserve < 3 ? 'attention' : 'info';
  const insight = makeInsight({
    id: 'new-debt:sustainability',
    rule: 'commitments',
    module: 'debt',
    severity,
    titleKey: severity === 'info' ? 'The new debt looks sustainable' : 'The new debt is hard to sustain',
    messageKey: 'If your variable income fell {stress}%, the installment would leave {left} a month and your money covers it for {months} months.',
    params: { stress: String(stress), left: fmtMoney(worst.availableAfter), months: String(monthsOfReserve) },
    evidence: [
      { label: 'Installment per month', value: d.installmentMonthly, kind: 'money' },
      { label: 'Left after the installment (conservative reading)', value: base.rows[0].availableAfter, kind: 'money' },
      { label: 'Left after the installment with the stress test', value: worst.availableAfter, kind: 'money' },
      { label: 'Months of installments your liquid money covers', value: monthsOfReserve, kind: 'count' },
    ],
    formula: 'Payment capacity of the conservative reading with the business and declared income lowered by the stress percentage; reserve = liquid money ÷ installment.',
    dataState: 'estimate',
    period: 'simulation',
    actions: [{ labelKey: 'Open the loan simulator', link: '/loans/simulator' }],
  });
  return { rule: 'commitments', status: 'ok', insight, base, stressed, monthsOfReserve };
}

// ===== h) declared income versus what was recorded (a difference, not an accusation)

export function detectDeclaredVsReceived(d: { today: string; txs: readonly TransactionModel[]; sources: readonly IncomeSourceModel[] }, t: Thresholds): DetectorResult {
  const months = lastCompleteMonths(d.today, t['months']);
  const window = new Set(months);
  const start = months[0];
  const eligible = d.sources.filter((s) => s.active && (s.currency ?? 'DOP') === 'DOP' && !isCommercialKind(s.kind) && !!s.expectedNet && !!s.schedule && monthOf(s.createdAt) <= start);
  const need = { needed: 1, have: eligible.length, unit: 'sources' as const };
  if (!eligible.length) return insufficient('declared-vs-received', need);
  const received = new Map<string, number>();
  const unlinked: TransactionModel[] = [];
  const known = new Set(d.sources.map((s) => s.id));
  for (const x of d.txs) {
    if (!isIncomeTx(x) || !window.has(monthOf(x.date))) continue;
    if (x.incomeSourceId && known.has(x.incomeSourceId)) received.set(x.incomeSourceId, addMoney(received.get(x.incomeSourceId) ?? 0, x.amount));
    else unlinked.push(x);
  }
  const period = `${start}..${months[months.length - 1]}`;
  const out: Insight[] = [];
  for (const s of eligible) {
    const expected = round2(s.expectedNet! * occurrencesPerMonth(s.schedule) * months.length);
    const got = received.get(s.id) ?? 0;
    const gap = subMoney(got, expected);
    const gapPct = expected > 0 ? (gap / expected) * 100 : 0;
    if (Math.abs(gapPct) < t['gapPercent'] || Math.abs(gap) < t['minGap']) continue;
    out.push(
      makeInsight({
        id: `declared-vs-received:${s.id}`,
        rule: 'declared-vs-received',
        module: 'income',
        severity: 'info',
        titleKey: 'Difference between declared and recorded income',
        messageKey: '{name}: you declared about {expected} for these months and {received} was recorded ({gap} {direction}). It is only a difference to review.',
        params: { name: s.name, expected: fmtMoney(expected), received: fmtMoney(got), gap: fmtPct(Math.abs(gapPct)), direction: gap < 0 ? 'less' : 'more' },
        translateParams: ['direction'],
        evidence: [
          { label: 'Declared (expected amount × payments)', value: expected, kind: 'money', source: { period } },
          { label: 'Recorded', value: got, kind: 'money', source: { period } },
          { label: 'Difference', value: gap, kind: 'money' },
          { label: 'Difference (%)', value: round(gapPct), kind: 'percent' },
        ],
        formula: 'Expected net amount × payments per month × months, compared with the income recorded for that source. It is a difference, not an accusation.',
        dataState: 'confirmed',
        period,
        actions: [{ labelKey: 'Open the income sources', link: '/income' }],
      })
    );
  }
  const unlinkedTotal = sumMoney(unlinked.map((x) => x.amount));
  if (unlinked.length && unlinkedTotal >= t['minGap']) {
    out.push(
      makeInsight({
        id: 'declared-vs-received:unlinked',
        rule: 'declared-vs-received',
        module: 'income',
        severity: 'info',
        titleKey: 'Deposits not linked to any income source',
        messageKey: '{count} deposits totaling {amount} are not linked to any income source. Link them to see the full picture.',
        params: { count: String(unlinked.length), amount: fmtMoney(unlinkedTotal) },
        evidence: [
          { label: 'Deposits without a source', value: unlinked.length, kind: 'count', source: { period, txIds: unlinked.slice(0, 40).map((x) => x.id) } },
          { label: 'Total', value: unlinkedTotal, kind: 'money', source: { period } },
        ],
        formula: 'Income movements of the period that point to no income source.',
        dataState: 'confirmed',
        period,
        actions: [{ labelKey: 'Open the income sources', link: '/income' }],
      })
    );
  }
  return ok('declared-vs-received', need, out);
}

// ===== i) possible duplicates (candidates with a score: the user decides, nothing is merged)

export interface DuplicateCandidate {
  aId: string;
  bId: string;
  score: number; // 0-100
  amount: number;
  accountId: string;
  dateA: string;
  dateB: string;
  noteSimilarity: number; // 0-1
}

const norm = (s?: string): string => (s ?? '').toLowerCase().replace(/[^a-z0-9áéíóúñ]+/g, ' ').trim();

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const c = s.replace(/ /g, '');
  for (let i = 0; i < c.length - 1; i++) m.set(c.slice(i, i + 2), (m.get(c.slice(i, i + 2)) ?? 0) + 1);
  return m;
}

export function noteSimilarity(a?: string, b?: string): number {
  const x = norm(a);
  const y = norm(b);
  if (!x && !y) return 0.6; // nothing to compare: neutral, not proof
  if (!x || !y) return 0.4;
  if (x === y) return 1;
  const bx = bigrams(x);
  const by = bigrams(y);
  let inter = 0;
  for (const [k, v] of bx) inter += Math.min(v, by.get(k) ?? 0);
  const total = [...bx.values()].reduce((s, v) => s + v, 0) + [...by.values()].reduce((s, v) => s + v, 0);
  return total ? (2 * inter) / total : 0;
}

export function findDuplicateCandidates(txs: readonly TransactionModel[], today: string, minScore = 75, windowDays = 90): DuplicateCandidate[] {
  const from = addDays(today, -windowDays);
  const groups = new Map<string, TransactionModel[]>();
  for (const x of txs) {
    if (x.date < from || x.date > today || x.type === 'transfer' || x.status === 'reversed' || x.origin === 'reversal' || x.origin === 'adjustment' || x.linkedId) continue;
    const key = `${x.type}|${x.accountId}|${x.currency ?? 'DOP'}|${x.amount}`;
    const g = groups.get(key);
    if (g) g.push(x);
    else groups.set(key, [x]);
  }
  const out: DuplicateCandidate[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const s = [...list].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    for (let i = 0; i < s.length; i++) {
      for (let j = i + 1; j < s.length; j++) {
        const days = daysBetween(s[i].date, s[j].date);
        if (days > 1) break;
        const sim = noteSimilarity(s[i].note, s[j].note);
        const score = Math.round((0.5 + 0.2 * (days === 0 ? 1 : 0.7) + 0.3 * sim) * 100);
        if (score >= minScore) out.push({ aId: s[i].id, bId: s[j].id, score, amount: s[i].amount, accountId: s[i].accountId, dateA: s[i].date, dateB: s[j].date, noteSimilarity: Math.round(sim * 100) / 100 });
      }
    }
  }
  return out.sort((a, b) => b.score - a.score || a.aId.localeCompare(b.aId));
}

export function detectDuplicates(d: { today: string; txs: readonly TransactionModel[]; accounts: readonly AccLite[] }, t: Thresholds): DetectorResult {
  const need = { needed: 0, have: 0, unit: 'days' as const };
  const names = new Map(d.accounts.map((a) => [a.id, a.name]));
  const top = findDuplicateCandidates(d.txs, d.today, t['minScore']).slice(0, 5);
  return ok(
    'duplicates',
    need,
    top.map((c) =>
      makeInsight({
        id: `duplicates:${[c.aId, c.bId].sort().join(':')}`,
        rule: 'duplicates',
        module: 'data',
        severity: 'info',
        titleKey: 'These two movements may be duplicates',
        messageKey: 'Two movements of {amount} in {account} on {dateA} and {dateB} look alike (score {score}). Check them: nothing is merged on its own.',
        params: { amount: fmtMoney(c.amount), account: names.get(c.accountId) ?? '', dateA: c.dateA, dateB: c.dateB, score: String(c.score) },
        evidence: [
          { label: 'Amount', value: c.amount, kind: 'money', source: { txIds: [c.aId, c.bId] } },
          { label: 'Score', value: c.score, kind: 'percent' },
          { label: 'Note similarity', value: Math.round(c.noteSimilarity * 100), kind: 'percent' },
          { label: 'First date', value: c.dateA, kind: 'date' },
          { label: 'Second date', value: c.dateB, kind: 'date' },
        ],
        formula: 'Same type, account and amount within one day; the score adds the similarity of the notes. It is a candidate, never a verdict.',
        dataState: 'estimate',
        period: `${c.dateA}..${c.dateB}`,
        actions: [{ labelKey: 'See the movements', link: '/transactions' }],
      })
    )
  );
}

// ===== j) upcoming payment commitments

export interface Commitment {
  date: string;
  amount: number;
  kind: 'card' | 'loan' | 'fixed';
  label: string;
}

export function detectCommitments(d: { today: string; liquid: number; commitments: readonly Commitment[]; cuts?: readonly { date: string; label: string }[] }, _t: Thresholds): DetectorResult {
  const need = { needed: 0, have: 0, unit: 'days' as const };
  const horizon = addDays(d.today, 30);
  const within = d.commitments.filter((c) => c.amount > 0 && c.date <= horizon).sort((a, b) => a.date.localeCompare(b.date));
  if (!within.length) return ok('commitments', need, []);
  const total = sumMoney(within.map((c) => c.amount));
  const overdue = within.filter((c) => c.date < d.today);
  const period = `${d.today}..${horizon}`;
  const listEvidence = within.slice(0, 6).map((c) => ({ label: c.label, value: c.amount, kind: 'money' as const, source: { period: c.date } }));
  const cutEvidence = (d.cuts ?? []).slice(0, 3).map((c) => ({ label: c.label, value: c.date, kind: 'date' as const }));
  const out: Insight[] = [];
  if (overdue.length) {
    const sum = sumMoney(overdue.map((c) => c.amount));
    out.push(
      makeInsight({
        id: 'commitments:overdue',
        rule: 'commitments',
        module: 'debt',
        severity: 'alert',
        critical: true,
        titleKey: 'You have overdue payments',
        messageKey: '{count} payments are overdue for {amount}.',
        params: { count: String(overdue.length), amount: fmtMoney(sum) },
        evidence: overdue.slice(0, 6).map((c) => ({ label: c.label, value: c.amount, kind: 'money' as const, source: { period: c.date } })),
        formula: 'Card statements, loan installments and fixed expenses whose due date has passed and are not paid.',
        dataState: 'confirmed',
        period,
        actions: [{ labelKey: 'Open the loans', link: '/loans' }],
      })
    );
  }
  if (d.liquid < total) {
    const short = round2(total - d.liquid);
    out.push(
      makeInsight({
        id: 'commitments:shortfall',
        rule: 'commitments',
        module: 'debt',
        severity: 'alert',
        critical: true,
        titleKey: 'Your money does not cover your next payments',
        messageKey: 'You owe {total} in the next 30 days and have {liquid} available: {short} is missing.',
        params: { total: fmtMoney(total), liquid: fmtMoney(d.liquid), short: fmtMoney(short) },
        evidence: [
          { label: 'Commitments in the next 30 days', value: total, kind: 'money', source: { period } },
          { label: 'Liquid money', value: d.liquid, kind: 'money' },
          { label: 'Missing', value: short, kind: 'money' },
          ...listEvidence,
        ],
        formula: 'Liquid money (cash, bank and savings) minus the card statements, loan installments and fixed expenses due in the next 30 days.',
        dataState: 'estimate',
        period,
        actions: [{ labelKey: 'Open the dashboard', link: '/' }],
      })
    );
  }
  out.push(
    makeInsight({
      id: 'commitments:upcoming',
      rule: 'commitments',
      module: 'debt',
      severity: 'info',
      titleKey: 'Payments coming in the next 30 days',
      messageKey: '{count} commitments for {total} in the next 30 days.',
      params: { count: String(within.length), total: fmtMoney(total) },
      evidence: [{ label: 'Commitments in the next 30 days', value: total, kind: 'money', source: { period } }, ...listEvidence, ...cutEvidence],
      formula: 'Card statements still owed, loan installments and fixed expenses with a due date in the next 30 days.',
      dataState: 'confirmed',
      period,
      actions: [{ labelKey: 'Open the dashboard', link: '/' }],
    })
  );
  return ok('commitments', need, out);
}
