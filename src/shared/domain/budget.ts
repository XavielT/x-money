// Budgets, blocks, projections, recommendations and trends. Pure. RD$ only (like the statistics).
// Everything that looks ahead (pace, projection, recommendations, savings potential) is an
// ESTIMATE (rule 10): it comes back flagged with its assumptions, never as confirmed data.
import { BudgetBucketModel, BudgetMoveModel, BucketKind, MoveRef, BaseIncome, MANUAL_BUCKETS } from '../models/budget.model';
import { CategoryModel } from '../models/category.model';
import { TransactionModel } from '../models/transaction.model';
import { addMoney, round2, subMoney, sumMoney } from '../utils/money';
import { daysBetween, lastCompleteMonths, lastDayOfMonth } from './dates';
import { natureOfCategory } from './categories';
import { IrregularProjection } from './irregular';
import { totalsByCategory } from './stats';

export const DEFAULT_RISK_AT = 90;
export const MIN_DAYS_FOR_PACE = 5; // before that, a daily pace says nothing

const monthTxs = (txs: readonly TransactionModel[], key: string) => txs.filter((t) => t.date.startsWith(key));

// RD$ spending per category of one month (fees under Bank fees, reversed pairs out)
export function monthTotals(txs: readonly TransactionModel[], key: string): Map<string, number> {
  return new Map(totalsByCategory(monthTxs(txs, key), 'expense').map((t) => [t.categoryId, t.total]));
}

export function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : round2((s[mid - 1] + s[mid]) / 2);
}

// ----- blocks

// Where each built-in category goes by default (editable). Anything unmapped falls in "free".
export const DEFAULT_BUCKET_CATEGORIES: Readonly<Record<BucketKind, readonly string[]>> = {
  essential: ['cat-bills', 'cat-subscriptions', 'cat-electricity', 'cat-internet', 'cat-utilities', 'cat-rent', 'cat-obligations', 'cat-health', 'cat-education', 'cat-bank-fees', 'cat-card-interest'],
  food: ['cat-food', 'cat-groceries', 'cat-restaurants', 'cat-delivery'],
  transport: ['cat-transport', 'cat-vehicle-maintenance', 'cat-car-project'],
  entertainment: ['cat-entertainment', 'cat-going-out', 'cat-hobby', 'cat-sports', 'cat-travel'],
  'family-home': ['cat-home', 'cat-family', 'cat-pets'],
  savings: [],
  emergency: [],
  'business-capital': [],
  'debt-payments': [],
  free: ['cat-shopping', 'cat-occasional', 'cat-gifts-expense', 'cat-beauty', 'cat-other-expense'],
};

export const BUCKET_KINDS: readonly BucketKind[] = ['essential', 'food', 'transport', 'entertainment', 'family-home', 'savings', 'emergency', 'business-capital', 'debt-payments', 'free'];

export const isManualBucket = (kind: BucketKind): boolean => MANUAL_BUCKETS.includes(kind);

// The block a category belongs to: the mapped one, else "free"
export function bucketKindOf(categoryId: string | undefined, buckets: readonly BudgetBucketModel[]): BucketKind {
  const hit = buckets.find((b) => !isManualBucket(b.kind) && !!categoryId && b.categoryIds.includes(categoryId));
  return hit?.kind ?? 'free';
}

export function bucketLimit(b: Pick<BudgetBucketModel, 'mode' | 'value'>, base: number): number {
  return b.mode === 'percent' ? round2((base * b.value) / 100) : round2(b.value);
}

// What a block has consumed in a month: its categories' spending, or the amount put in by hand
export function bucketSpent(b: BudgetBucketModel, buckets: readonly BudgetBucketModel[], totals: ReadonlyMap<string, number>, monthKey: string): number {
  if (isManualBucket(b.kind)) return round2(b.manualByMonth?.[monthKey] ?? 0);
  let spent = 0;
  for (const [categoryId, total] of totals) if (bucketKindOf(categoryId, buckets) === b.kind) spent = addMoney(spent, total);
  return spent;
}

// Which income the distribution is based on, and what that amounts to (always shown to the user)
export interface BaseInput {
  guaranteed: number;
  monthsAvailable: number[]; // available income of the last complete months, oldest first
  actual: number;
}

export interface BaseResult {
  base: BaseIncome;
  amount: number;
  note: 'ok' | 'no-data'; // an average over months without any income says nothing
  estimate: boolean;
}

export function baseIncome(base: BaseIncome, input: BaseInput): BaseResult {
  if (base === 'guaranteed') return { base, amount: round2(input.guaranteed), note: input.guaranteed > 0 ? 'ok' : 'no-data', estimate: true };
  if (base === 'actual') return { base, amount: round2(input.actual), note: input.actual > 0 ? 'ok' : 'no-data', estimate: false };
  const months = input.monthsAvailable.slice(-3);
  const total = sumMoney(months);
  return { base, amount: months.length ? round2(total / months.length) : 0, note: total > 0 ? 'ok' : 'no-data', estimate: true };
}

// ----- moving money between blocks or categories inside a month

export type MoveError = 'amount' | 'same' | 'kind' | 'insufficient' | 'month';

const sameRef = (a: MoveRef, b: MoveRef) => a.type === b.type && a.id === b.id;

// limit + what moved in - what moved out, for one block/category in one month
export function adjustedLimit(limit: number, moves: readonly BudgetMoveModel[], ref: MoveRef, monthKey: string): number {
  let result = limit;
  for (const m of moves) {
    if (m.undone || m.month !== monthKey) continue;
    if (sameRef(m.to, ref)) result = addMoney(result, m.amount);
    if (sameRef(m.from, ref)) result = subMoney(result, m.amount);
  }
  return result;
}

// A move needs a positive amount, two different items of the same kind, and enough limit at the origin
export function validateMove(from: MoveRef, to: MoveRef, amount: number, fromLimit: number, monthKey: string): MoveError | null {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return 'month';
  if (!Number.isFinite(amount) || amount <= 0) return 'amount';
  if (sameRef(from, to)) return 'same';
  if (from.type !== to.type) return 'kind';
  if (amount > fromLimit) return 'insufficient';
  return null;
}

// ----- pace and risk of exceeding

export interface BudgetRisk {
  status: 'ok' | 'risk' | 'over';
  limit: number;
  spent: number;
  projected: number; // end-of-month spending at the current pace (or the declared pattern)
  hitDate: string | null; // the day the limit is reached at this pace, if it is within the month
  basis: 'pace' | 'pattern' | 'spent';
  estimate: true;
}

// Month is 1-12. For a past month the projection is what was spent; for the current one it is
// the daily pace (spent so far / days elapsed x days in the month), or the pattern's projection.
export function budgetRisk(
  limit: number,
  spent: number,
  today: string,
  year: number,
  month: number,
  riskAt = DEFAULT_RISK_AT,
  pattern?: IrregularProjection
): BudgetRisk {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const days = lastDayOfMonth(year, month);
  const base = { limit, spent, estimate: true as const };
  if (spent > limit) return { ...base, status: 'over', projected: spent, hitDate: null, basis: 'spent' };
  const current = today.startsWith(prefix);
  if (!current) return { ...base, status: 'ok', projected: spent, hitDate: null, basis: 'spent' };
  const elapsed = Number(today.slice(8, 10));
  let projected = spent;
  let basis: BudgetRisk['basis'] = 'spent';
  if (pattern) {
    projected = pattern.projected;
    basis = 'pattern';
  } else if (elapsed >= MIN_DAYS_FOR_PACE) {
    projected = round2((spent / elapsed) * days);
    basis = 'pace';
  }
  let hitDate: string | null = null;
  if (basis !== 'spent' && spent > 0 && elapsed > 0) {
    const day = Math.ceil(limit / (spent / elapsed));
    if (day <= days && day > elapsed) hitDate = `${prefix}-${String(day).padStart(2, '0')}`;
  }
  const risky = limit > 0 && basis !== 'spent' && projected > (limit * riskAt) / 100;
  return { ...base, status: risky ? 'risk' : 'ok', projected, hitDate, basis };
}

// ----- projection of the balance at the end of the month

export interface VariableRemaining {
  projected: number;
  low: number;
  high: number;
  basis: 'weekly-history' | 'pace';
  estimate: true;
}

// Daily spending rate of the variable categories (RD$ per day): the weekly rate of the last 4
// weeks (the lowest and highest week give the range), or this month's own pace when there are
// fewer than 2 weeks of history.
export interface VariableRates {
  mid: number;
  low: number;
  high: number;
  basis: 'weekly-history' | 'pace';
}

export function variableRates(txs: readonly TransactionModel[], categories: readonly CategoryModel[], today: string): VariableRates {
  const variable = new Set(categories.filter((c) => c.type === 'expense' && !c.parentId && natureOfCategory(c) === 'variable').map((c) => c.id));
  const counts = (t: TransactionModel) => t.type === 'expense' && !!t.categoryId && variable.has(t.categoryId) && t.status !== 'reversed' && t.origin !== 'adjustment' && (t.currency ?? 'DOP') === 'DOP';
  const weekly = [0, 0, 0, 0];
  const spans = Math.min(4, Math.floor((daysBetween(txs.map((t) => t.date).sort()[0] ?? today, today) + 1) / 7));
  for (const t of txs) {
    if (!counts(t)) continue;
    const back = daysBetween(t.date, today);
    if (back < 0 || back >= 28) continue;
    const idx = Math.floor(back / 7);
    weekly[idx] = addMoney(weekly[idx], t.amount);
  }
  const used = spans >= 2 ? weekly.slice(0, spans) : [];
  if (used.length) return { mid: sumMoney(used) / used.length / 7, low: Math.min(...used) / 7, high: Math.max(...used) / 7, basis: 'weekly-history' };
  const elapsed = Number(today.slice(8, 10));
  let spent = 0;
  for (const t of txs) if (t.date.startsWith(today.slice(0, 7)) && t.date <= today && counts(t)) spent = addMoney(spent, t.amount);
  const pace = spent / Math.max(1, elapsed);
  return { mid: pace, low: pace, high: pace, basis: 'pace' };
}

// What the variable categories are still expected to spend this month; a category with a
// declared irregular pattern uses that pattern's projection instead.
export function variableRemaining(
  txs: readonly TransactionModel[],
  categories: readonly CategoryModel[],
  today: string,
  patterns: ReadonlyMap<string, IrregularProjection> = new Map()
): VariableRemaining {
  const monthEnd = `${today.slice(0, 7)}-${String(lastDayOfMonth(Number(today.slice(0, 4)), Number(today.slice(5, 7)))).padStart(2, '0')}`;
  const remainingDays = Math.max(0, daysBetween(today, monthEnd));
  const variable = new Set(categories.filter((c) => c.type === 'expense' && !c.parentId && natureOfCategory(c) === 'variable').map((c) => c.id));
  const rates = variableRates(txs, categories, today);
  const projected = rates.mid * remainingDays;
  const low = rates.low * remainingDays;
  const high = rates.high * remainingDays;
  const basis = rates.basis;
  // declared patterns replace the part of the estimate that belongs to their category
  let patternExtra = 0;
  for (const [categoryId, p] of patterns) {
    if (!variable.has(categoryId)) continue;
    patternExtra = addMoney(patternExtra, round2(p.projected - p.spent));
  }
  return { projected: round2(projected + patternExtra), low: round2(low + patternExtra), high: round2(high + patternExtra), basis, estimate: true };
}

export interface MonthEndProjection {
  projected: number;
  low: number; // worst case: the most variable spending
  high: number;
  liquid: number;
  fixedPending: number;
  variable: VariableRemaining;
  guaranteedExpected: number; // guaranteed income still to arrive (never variable income, never benefits)
  estimate: true;
}

// liquid balance - fixed obligations still to pay - variable spending still expected + guaranteed
// income still expected. Variable income and non-monetary benefits are never included.
export function monthEndProjection(liquid: number, fixedPending: number, variable: VariableRemaining, guaranteedExpected: number): MonthEndProjection {
  const base = subMoney(addMoney(liquid, guaranteedExpected), fixedPending);
  return { projected: round2(base - variable.projected), low: round2(base - variable.high), high: round2(base - variable.low), liquid, fixedPending, variable, guaranteedExpected, estimate: true };
}

// ----- history-based recommendations (deterministic)

export const MIN_MONTHS_RECOMMENDATION = 3;

export interface BucketRecommendation {
  kind: BucketKind;
  months: number[]; // what was really spent, oldest first
  median: number;
  suggested: number | null; // null for blocks fed by hand
  manual: boolean;
}

export interface Recommendation {
  sufficient: boolean; // at least 3 months of history; otherwise the declared figures are used
  monthsUsed: number;
  base: number;
  obligations: number; // median of the fixed spending
  variablesMedian: number; // median of every spending block except "free"
  freeMedian: number;
  debtMinimums: number;
  shortfall: boolean; // the base does not even cover the obligations
  buckets: BucketRecommendation[];
  estimate: true;
}

// historyByBucket: monthly spending of each block over the last 3-6 complete months (oldest first).
// fixedHistory: monthly spending in fixed-nature categories over the same months.
export function recommend(base: number, historyByBucket: ReadonlyMap<BucketKind, number[]>, fixedHistory: number[], debtMinimums = 0): Recommendation {
  const monthsUsed = Math.max(0, ...[...historyByBucket.values()].map((v) => v.length), fixedHistory.length);
  const sufficient = monthsUsed >= MIN_MONTHS_RECOMMENDATION;
  const buckets: BucketRecommendation[] = BUCKET_KINDS.map((kind) => ({
    kind,
    months: historyByBucket.get(kind) ?? [],
    median: median(historyByBucket.get(kind) ?? []),
    suggested: null,
    manual: isManualBucket(kind),
  }));
  const obligations = median(fixedHistory);
  const medianOf = (k: BucketKind) => buckets.find((b) => b.kind === k)!.median;
  const spendingKinds = BUCKET_KINDS.filter((k) => !isManualBucket(k));
  const variablesMedian = sumMoney(spendingKinds.filter((k) => k !== 'free').map(medianOf));
  const freeMedian = medianOf('free');
  const shortfall = base < obligations + debtMinimums;
  if (sufficient) {
    // what a block costs you, capped so the blocks together never promise more than the base
    const needs = sumMoney(spendingKinds.map(medianOf));
    // no income data (base 0): nothing to scale against, so the blocks keep what they really cost
    const scale = base > 0 && needs > base ? base / needs : 1;
    for (const b of buckets) if (!b.manual) b.suggested = round2(b.median * scale);
    // Savings: what is left of the base after every spending block (obligations live in the
    // essential block) and the debt minimums. Never below zero, and zero when the base does not
    // cover the obligations: no savings are invented. "Free money" is the usual free spending.
    const spending = sumMoney(spendingKinds.map((k) => buckets.find((x) => x.kind === k)!.suggested ?? 0));
    buckets.find((x) => x.kind === 'savings')!.suggested = shortfall || base <= 0 ? 0 : Math.max(0, round2(base - spending - debtMinimums));
    buckets.find((x) => x.kind === 'debt-payments')!.suggested = debtMinimums;
  }
  return { sufficient, monthsUsed, base, obligations, variablesMedian, freeMedian, debtMinimums, shortfall, buckets, estimate: true };
}

// ----- trends and where to reduce

export interface Trend {
  slope: number; // simple linear regression, RD$ per month
  monthOverMonth: number | null; // % change of the last month against the one before
  months: number;
  estimate: true;
}

export function trend(values: readonly number[]): Trend {
  const n = values.length;
  if (n < 2) return { slope: 0, monthOverMonth: null, months: n, estimate: true };
  const meanX = (n - 1) / 2;
  const meanY = sumMoney([...values]) / n;
  let num = 0;
  let den = 0;
  values.forEach((y, x) => {
    num += (x - meanX) * (y - meanY);
    den += (x - meanX) ** 2;
  });
  const prev = values[n - 2];
  return { slope: round2(num / den), monthOverMonth: prev > 0 ? Math.round(((values[n - 1] - prev) / prev) * 1000) / 10 : null, months: n, estimate: true };
}

export interface ReduceCandidate {
  categoryId: string;
  current: number; // spent so far this month
  median: number; // of the last 6 complete months
  reason: 'above-median' | 'over-budget';
  overBudgetMonths: number;
  potentialSaving: number; // current - median, an estimate
  estimate: true;
}

export const REDUCE_FACTOR = 1.2;
export const MIN_MONTHS_REDUCE = 3;

// Discretionary (variable) categories whose spending so far this month is above 120 % of their
// 6-month median, or that exceeded their budget in at least 3 of the last 6 months.
export function reduceCandidates(
  categories: readonly CategoryModel[],
  monthlyByCategory: ReadonlyMap<string, number[]>, // last complete months, oldest first
  currentByCategory: ReadonlyMap<string, number>,
  limits: ReadonlyMap<string, number>
): ReduceCandidate[] {
  const out: ReduceCandidate[] = [];
  for (const c of categories) {
    if (c.type !== 'expense' || c.system || c.parentId || natureOfCategory(c) !== 'variable') continue;
    const history = monthlyByCategory.get(c.id) ?? [];
    if (history.length < MIN_MONTHS_REDUCE) continue;
    const med = median(history);
    const current = currentByCategory.get(c.id) ?? 0;
    const limit = limits.get(c.id);
    const over = limit ? history.filter((v) => v > limit).length : 0;
    const above = med > 0 && current > med * REDUCE_FACTOR;
    if (!above && over < 3) continue;
    out.push({ categoryId: c.id, current, median: med, reason: above ? 'above-median' : 'over-budget', overBudgetMonths: over, potentialSaving: Math.max(0, subMoney(current, med)), estimate: true });
  }
  return out.sort((a, b) => b.potentialSaving - a.potentialSaving);
}

// Monthly series per category over the last `n` complete months (oldest first)
export function categorySeries(txs: readonly TransactionModel[], today: string, n: number): Map<string, number[]> {
  const months = lastCompleteMonths(today, n);
  const out = new Map<string, number[]>();
  months.forEach((key, i) => {
    for (const [categoryId, total] of monthTotals(txs, key)) {
      const series = out.get(categoryId) ?? new Array<number>(n).fill(0);
      series[i] = total;
      out.set(categoryId, series);
    }
  });
  return out;
}
