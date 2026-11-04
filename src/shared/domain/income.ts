// Income sources: expected dates, averages, stability and the monthly breakdown. Pure.
// Integrity rules in force here:
//  - 5: a commercial sale is revenue (gross); only price - cost - sale expenses is benefit.
//  - 7: variable income is never "guaranteed": guaranteed = recurring AND documented sources,
//       with their expected net amount. Everything else is shown apart as an average.
// Figures are RD$ only (US$ income is left out, as in the statistics) and every average is an
// estimate with its assumptions returned next to it.
import { IncomeKind, IncomeSchedule, IncomeSourceModel, isCommercialKind } from '../models/income-source.model';
import { TransactionModel } from '../models/transaction.model';
import { addMoney, round2, subMoney, sumMoney } from '../utils/money';
import { addDays, addMonthsKeepingDay, daysBetween, lastDayOfMonth, weekdayOf } from './dates';
import { txCurrency } from './ledger';
import { isCounted } from './stats';

// ---- which movements are income of a source

export const isIncomeTx = (t: TransactionModel): boolean => t.type === 'income' && isCounted(t) && txCurrency(t) === 'DOP';

// ---- expected dates

export function validSchedule(s: IncomeSchedule | undefined): boolean {
  if (!s) return true;
  if (s.mode === 'weekly') return Number.isInteger(s.weekday) && s.weekday >= 0 && s.weekday <= 6;
  if (s.mode === 'month-days') return s.days.length > 0 && s.days.length <= 6 && s.days.every((d) => Number.isInteger(d) && d >= 1 && d <= 31);
  return Number.isInteger(s.n) && s.n >= 1 && s.n <= 365 && /^\d{4}-\d{2}-\d{2}$/.test(s.anchor);
}

// Dates the schedule expects in [from, to], inclusive and sorted. A day that does not exist in a
// short month (30 in February) falls on the last day of it.
export function expectedDates(schedule: IncomeSchedule | undefined, from: string, to: string): string[] {
  if (!schedule || !validSchedule(schedule) || from > to) return [];
  const out: string[] = [];
  if (schedule.mode === 'weekly') {
    let d = addDays(from, (schedule.weekday - weekdayOf(from) + 7) % 7);
    for (; d <= to; d = addDays(d, 7)) out.push(d);
    return out;
  }
  if (schedule.mode === 'month-days') {
    let y = Number(from.slice(0, 4));
    let m = Number(from.slice(5, 7));
    const [ty, tm] = [Number(to.slice(0, 4)), Number(to.slice(5, 7))];
    while (y < ty || (y === ty && m <= tm)) {
      const days = new Set(schedule.days.map((d) => Math.min(d, lastDayOfMonth(y, m))));
      for (const day of [...days].sort((a, b) => a - b)) {
        const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (iso >= from && iso <= to) out.push(iso);
      }
      if (++m > 12) {
        m = 1;
        y++;
      }
    }
    return out;
  }
  // every N days / weeks / months from an anchor date
  const step = (k: number): string =>
    schedule.unit === 'months' ? addMonthsKeepingDay(schedule.anchor, k * schedule.n) : addDays(schedule.anchor, k * schedule.n * (schedule.unit === 'weeks' ? 7 : 1));
  let k = 0;
  if (schedule.anchor < from) {
    // jump close to `from` without walking years of steps
    const per = schedule.n * (schedule.unit === 'months' ? 31 : schedule.unit === 'weeks' ? 7 : 1); // never overshoots
    k = Math.max(0, Math.floor(daysBetween(schedule.anchor, from) / per) - 1);
  }
  for (let d = step(k); d <= to && out.length < 400; d = step(++k)) if (d >= from) out.push(d);
  return out;
}

// How many times a month the schedule pays, on average (an estimate: 52/12 for weekly)
export function occurrencesPerMonth(schedule: IncomeSchedule | undefined): number {
  if (!schedule || !validSchedule(schedule)) return 0;
  if (schedule.mode === 'weekly') return 52 / 12;
  if (schedule.mode === 'month-days') return new Set(schedule.days).size;
  return schedule.unit === 'months' ? 1 / schedule.n : schedule.unit === 'weeks' ? 52 / 12 / schedule.n : 365 / 12 / schedule.n;
}

// ---- expected vs received

const EARLY_DAYS = 3; // paid a little before the date
const LATE_DAYS = 10; // paid late: still the same expectation

export interface Expectation {
  sourceId: string;
  date: string; // the expected date
  status: 'received' | 'pending' | 'skipped' | 'upcoming';
  txId?: string; // the movement that satisfied it
}

// Pairs the expected dates of a source with the movements that arrived, oldest first, each
// movement used once. A date nobody confirmed stays "pending": it is an expectation, never money.
export function expectations(
  source: IncomeSourceModel,
  txs: readonly TransactionModel[],
  from: string,
  to: string,
  today: string
): Expectation[] {
  if (!source.active || !source.schedule) return [];
  const mine = txs.filter((t) => t.incomeSourceId === source.id && isIncomeTx(t)).sort((a, b) => a.date.localeCompare(b.date));
  const used = new Set<string>();
  const skipped = new Set(source.skippedDates ?? []);
  // look back so a movement slightly before `from` can still satisfy its date
  const dates = expectedDates(source.schedule, from, to);
  return dates.map((date) => {
    const hit = mine.find((t) => !used.has(t.id) && t.date >= addDays(date, -EARLY_DAYS) && t.date <= addDays(date, LATE_DAYS));
    if (hit) {
      used.add(hit.id);
      return { sourceId: source.id, date, status: 'received', txId: hit.id };
    }
    if (skipped.has(date)) return { sourceId: source.id, date, status: 'skipped' };
    return { sourceId: source.id, date, status: date > today ? 'upcoming' : 'pending' };
  });
}

// "Did it arrive?": expected dates that have passed (up to `lookbackDays`) with nothing confirmed
export function pendingConfirmations(sources: readonly IncomeSourceModel[], txs: readonly TransactionModel[], today: string, lookbackDays = 14): Expectation[] {
  const out: Expectation[] = [];
  for (const s of sources) {
    for (const e of expectations(s, txs, addDays(today, -lookbackDays), today, today)) if (e.status === 'pending') out.push(e);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// "Expected this week": what is still to come in the next `days`
export function upcomingExpectations(sources: readonly IncomeSourceModel[], txs: readonly TransactionModel[], today: string, days = 7): Expectation[] {
  const out: Expectation[] = [];
  for (const s of sources) {
    for (const e of expectations(s, txs, today, addDays(today, days), today)) if (e.status === 'upcoming') out.push(e);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ---- monthly totals, averages, stability

export const monthKeyOf = (iso: string): string => iso.slice(0, 7);

const shiftMonthKey = (key: string, by: number): string => {
  const idx = Number(key.slice(0, 4)) * 12 + (Number(key.slice(5, 7)) - 1) + by;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
};

// Received (net) per month for the given movements
export function monthlyTotals(txs: readonly TransactionModel[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of txs) if (isIncomeTx(t)) out.set(monthKeyOf(t.date), addMoney(out.get(monthKeyOf(t.date)) ?? 0, t.amount));
  return out;
}

export interface Averages {
  months: number; // complete months the figures are based on (the assumption)
  monthly: number;
  quarterly: number; // monthly x 3
  annual: number; // monthly x 12
  currentMonthSoFar: number; // the running month, left out of the averages
  estimate: true; // averages are estimates, never confirmed income
}

// Average over the last `window` COMPLETE months. The running month is excluded (reported apart).
// Months without income count as zero, but only from the first month with income on: a source
// created today is not penalized for the years before it existed.
export function averages(txs: readonly TransactionModel[], today: string, window = 6): Averages {
  const totals = monthlyTotals(txs);
  const current = monthKeyOf(today);
  const currentMonthSoFar = totals.get(current) ?? 0;
  const past = [...totals.keys()].filter((k) => k < current).sort();
  if (!past.length) return { months: 0, monthly: 0, quarterly: 0, annual: 0, currentMonthSoFar, estimate: true };
  const last = shiftMonthKey(current, -1);
  const first = past[0] > shiftMonthKey(last, -(window - 1)) ? past[0] : shiftMonthKey(last, -(window - 1));
  const values: number[] = [];
  for (let k = first; k <= last; k = shiftMonthKey(k, 1)) values.push(totals.get(k) ?? 0);
  const monthly = round2(sumMoney(values) / values.length);
  return { months: values.length, monthly, quarterly: round2(monthly * 3), annual: round2(monthly * 12), currentMonthSoFar, estimate: true };
}

export type Calculated = 'insufficient' | 'stable' | 'variable';

export interface StabilityReport {
  months: number;
  cv: number | null; // coefficient of variation of the last 6 complete months (null: not enough history)
  calculated: Calculated;
  mismatch: boolean; // what the user declared does not match what happened
  variationPercent: number | null; // cv as a percentage, rounded
}

export const MIN_MONTHS_FOR_STABILITY = 3;
const STABLE_CV = 0.15; // up to ~15 % of month-to-month variation reads as stable

// Calculated stability next to the declared one. With fewer than 3 months it says so instead of guessing.
export function stability(txs: readonly TransactionModel[], declared: IncomeSourceModel['stability'], today: string): StabilityReport {
  const totals = monthlyTotals(txs);
  const current = monthKeyOf(today);
  const past = [...totals.keys()].filter((k) => k < current).sort();
  if (!past.length) return { months: 0, cv: null, calculated: 'insufficient', mismatch: false, variationPercent: null };
  const last = shiftMonthKey(current, -1);
  const first = past[0] > shiftMonthKey(last, -5) ? past[0] : shiftMonthKey(last, -5);
  const values: number[] = [];
  for (let k = first; k <= last; k = shiftMonthKey(k, 1)) values.push(totals.get(k) ?? 0);
  if (values.length < MIN_MONTHS_FOR_STABILITY) return { months: values.length, cv: null, calculated: 'insufficient', mismatch: false, variationPercent: null };
  const mean = sumMoney(values) / values.length;
  if (mean <= 0) return { months: values.length, cv: null, calculated: 'insufficient', mismatch: false, variationPercent: null };
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const cv = Math.sqrt(variance) / mean;
  const calculated: Calculated = cv <= STABLE_CV ? 'stable' : 'variable';
  const mismatch = (declared === 'recurring' && calculated === 'variable') || (declared === 'variable' && calculated === 'stable');
  return { months: values.length, cv: Math.round(cv * 1000) / 1000, calculated, mismatch, variationPercent: Math.round(cv * 100) };
}

// ---- guaranteed vs variable (rule 7)

export interface IncomeCapacity {
  guaranteedMonthly: number; // recurring AND documented, expected net x payments per month
  guaranteedSources: string[];
  missingExpected: string[]; // would qualify but has no expected net: it contributes nothing
  variableAverage: number; // average of the personal sources that are not guaranteed: NOT guaranteed
  variableSources: string[];
  estimate: true;
}

export function incomeCapacity(sources: readonly IncomeSourceModel[], txs: readonly TransactionModel[], today: string): IncomeCapacity {
  let guaranteed = 0;
  let variable = 0;
  const g: string[] = [];
  const missing: string[] = [];
  const v: string[] = [];
  for (const s of sources) {
    if (!s.active || (s.currency ?? 'DOP') !== 'DOP' || isCommercialKind(s.kind)) continue; // business sales are not personal income
    if (s.stability === 'recurring' && s.verifiability === 'documented') {
      if (s.expectedNet && s.expectedNet > 0 && s.schedule) {
        guaranteed = addMoney(guaranteed, round2(s.expectedNet * occurrencesPerMonth(s.schedule)));
        g.push(s.id);
      } else missing.push(s.id);
      continue;
    }
    variable = addMoney(variable, averages(txs.filter((t) => t.incomeSourceId === s.id), today).monthly);
    v.push(s.id);
  }
  return { guaranteedMonthly: guaranteed, guaranteedSources: g, missingExpected: missing, variableAverage: variable, variableSources: v, estimate: true };
}

// ---- monthly breakdown (what the dashboard, budgets and loans read)

// Benefit of a commercial sale: price - cost - declared sale expenses. Undefined without a cost:
// the sale price alone says nothing about profit.
export function saleBenefit(t: Pick<TransactionModel, 'amount' | 'costBasis' | 'saleExpenses'>): number | undefined {
  return t.costBasis === undefined ? undefined : subMoney(subMoney(t.amount, t.costBasis), t.saleExpenses ?? 0);
}

export interface MonthBreakdown {
  personalNet: number; // payroll, bonuses, freelance, extraordinary and custom, as received
  personalByKind: Partial<Record<IncomeKind, number>>;
  commercialGross: number; // business sales, as revenue (rule 5: NOT profit)
  commercialNetBenefit: number; // only sales with a declared cost
  commercialWithoutCost: number; // how many sales have no cost yet (their benefit is unknown, not zero)
  unclassified: number; // income with no source: not counted as personal until classified
  // Business operations (2.12.0): their revenue is in commercialGross and ONLY their net profit in
  // commercialNetBenefit; the recovered cost is working capital and never personal income.
  businessRevenue: number;
  businessNetProfit: number;
  businessByKind: Partial<Record<IncomeKind, { revenue: number; netProfit: number }>>;
  // "available income" = personalNet + commercialNetBenefit. The recovered cost of sales is
  // working capital, not personal income.
  available: number;
  guaranteedMonthly: number;
  variableAverage: number;
  estimate: true; // guaranteed / variableAverage are expectations and averages
}

export function monthBreakdown(
  txs: readonly TransactionModel[],
  sources: readonly IncomeSourceModel[],
  year: number,
  month: number,
  today: string,
  businessSales: readonly { date: string; price: number; netProfit: number; kind: IncomeKind }[] = []
): MonthBreakdown {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const byId = new Map(sources.map((s) => [s.id, s]));
  let personalNet = 0;
  let commercialGross = 0;
  let commercialNetBenefit = 0;
  let commercialWithoutCost = 0;
  let unclassified = 0;
  const personalByKind: Partial<Record<IncomeKind, number>> = {};
  for (const t of txs) {
    if (!t.date.startsWith(prefix) || !isIncomeTx(t)) continue;
    const source = t.incomeSourceId ? byId.get(t.incomeSourceId) : undefined;
    if (!source) {
      unclassified = addMoney(unclassified, t.amount); // also a source that was deleted
      continue;
    }
    if (isCommercialKind(source.kind)) {
      commercialGross = addMoney(commercialGross, t.amount);
      const benefit = saleBenefit(t);
      if (benefit === undefined) commercialWithoutCost++;
      else commercialNetBenefit = addMoney(commercialNetBenefit, benefit);
    } else {
      personalNet = addMoney(personalNet, t.amount);
      personalByKind[source.kind] = addMoney(personalByKind[source.kind] ?? 0, t.amount);
    }
  }
  let businessRevenue = 0;
  let businessNetProfit = 0;
  const businessByKind: MonthBreakdown['businessByKind'] = {};
  for (const s of businessSales) {
    if (!s.date.startsWith(prefix)) continue;
    businessRevenue = addMoney(businessRevenue, s.price);
    businessNetProfit = addMoney(businessNetProfit, s.netProfit);
    const k = businessByKind[s.kind] ?? { revenue: 0, netProfit: 0 };
    businessByKind[s.kind] = { revenue: addMoney(k.revenue, s.price), netProfit: addMoney(k.netProfit, s.netProfit) };
  }
  commercialGross = addMoney(commercialGross, businessRevenue);
  commercialNetBenefit = addMoney(commercialNetBenefit, businessNetProfit);
  const capacity = incomeCapacity(sources, txs, today);
  return {
    businessRevenue,
    businessNetProfit,
    businessByKind,
    personalNet,
    personalByKind,
    commercialGross,
    commercialNetBenefit,
    commercialWithoutCost,
    unclassified,
    available: addMoney(personalNet, commercialNetBenefit),
    guaranteedMonthly: capacity.guaranteedMonthly,
    variableAverage: capacity.variableAverage,
    estimate: true,
  };
}

// Share of each source in the received income of a period (stable vs variable view)
export interface SourceWeight {
  sourceId: string | null; // null = unclassified
  total: number;
  percent: number;
}

export function sourceWeights(txs: readonly TransactionModel[], from: string, to: string): SourceWeight[] {
  const totals = new Map<string | null, number>();
  for (const t of txs) {
    if (!isIncomeTx(t) || t.date < from || t.date > to) continue;
    const key = t.incomeSourceId ?? null;
    totals.set(key, addMoney(totals.get(key) ?? 0, t.amount));
  }
  const sum = sumMoney([...totals.values()]);
  return [...totals.entries()]
    .map(([sourceId, total]) => ({ sourceId, total, percent: sum > 0 ? Math.round((total / sum) * 1000) / 10 : 0 }))
    .sort((a, b) => b.total - a.total);
}
