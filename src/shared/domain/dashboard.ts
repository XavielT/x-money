// Dashboard building blocks. Pure. The dashboard never calculates money on its own: it composes
// the services of the earlier prompts and these helpers. Everything that looks ahead or infers
// comes back flagged `estimate` with its assumptions (rule 10); an indicator whose module does
// not exist yet is `available: false` (hidden), never a false zero.
import { Nature } from '../models/category.model';
import { TransactionModel } from '../models/transaction.model';
import { addMoney, round2, sumMoney } from '../utils/money';
import { addDays, daysBetween, lastCompleteMonths, lastDayOfMonth } from './dates';
import { LedgerAccount, balances, txCurrency } from './ledger';
import { feeOnly, isCounted, summarize } from './stats';

export type IndicatorId =
  | 'income'
  | 'expenses'
  | 'commercial-profit'
  | 'business-capital'
  | 'available'
  | 'savings'
  | 'debts'
  | 'card-utilization'
  | 'budget-left'
  | 'net-worth';

export interface IndicatorComponent {
  label: string; // English phrase: it is the translation key
  amount: number | null; // null = a text-only line (a percentage has its own display)
  display?: 'money' | 'percent' | 'count';
  kind: 'data' | 'estimate' | 'excluded'; // excluded = shown so the exclusion is visible, NOT part of the value
  note?: string;
}

export interface Indicator {
  id: IndicatorId;
  label: string;
  value: number | null;
  display: 'money' | 'percent';
  currency: 'DOP';
  components: IndicatorComponent[];
  formula: string;
  sources: string[]; // services / modules the figures come from
  estimate: boolean;
  available: boolean;
  missing?: string; // when not available or without data: what is missing and how to record it
}

// What a module that does not exist yet will provide later (06 business, 07 savings, 08 loans)
export interface ExternalFigure {
  value: number;
  components?: IndicatorComponent[];
}

export interface ExternalFigures {
  businessCapital?: ExternalFigure; // inventory at cost, unsold
  commercialProfit?: ExternalFigure; // net benefit of the month from the business module
  goalsReserved?: ExternalFigure; // money set aside in goals (comes out of available money)
  goalsSaved?: ExternalFigure; // contributions to goals that are NOT inside a savings account
  loanBalance?: ExternalFigure; // what is owed on loans
  commercialWorkingCapital?: ExternalFigure; // shown apart from net worth (rule 6)
}

// ----- expenses

export interface ExpenseBreakdown {
  total: number;
  fixed: number;
  variable: number;
}

// Same rules as summarize(): reversed pairs and adjustments are out, the fee of a movement is an
// expense (variable, it lives under Bank fees), a reversed original keeps the fee the bank charged.
// `natureOf` says whether one movement is fixed or variable.
export function expenseBreakdown(txs: readonly TransactionModel[], natureOf: (t: TransactionModel) => Nature): ExpenseBreakdown {
  let fixed = 0;
  let variable = 0;
  for (const t of txs) {
    if (txCurrency(t) !== 'DOP') continue;
    if (!isCounted(t)) {
      if (feeOnly(t)) variable = addMoney(variable, t.fee!);
      continue;
    }
    if (t.fee) variable = addMoney(variable, t.fee);
    if (t.type !== 'expense') continue;
    if (natureOf(t) === 'fixed') fixed = addMoney(fixed, t.amount);
    else variable = addMoney(variable, t.amount);
  }
  return { total: addMoney(fixed, variable), fixed, variable };
}

// ----- monthly flow

export interface MonthFlow {
  month: string; // 'YYYY-MM'
  income: number;
  expense: number;
  partial: boolean; // the running month
}

const monthKey = (iso: string) => iso.slice(0, 7);

// Income and expense of the last `n` months including the running one (marked partial)
export function monthlyFlow(txs: readonly TransactionModel[], today: string, n: number): MonthFlow[] {
  const months = [...lastCompleteMonths(today, n - 1), monthKey(today)];
  const wanted = new Set(months);
  const byMonth = new Map<string, TransactionModel[]>();
  for (const t of txs) {
    const key = monthKey(t.date);
    if (!wanted.has(key)) continue;
    const list = byMonth.get(key);
    if (list) list.push(t);
    else byMonth.set(key, [t]);
  }
  return months.map((month, i) => ({ month, ...summarize(byMonth.get(month) ?? []), partial: i === months.length - 1 }));
}

// ----- savings history, rebuilt from the movements (nothing is stored apart)

export interface SavingsPoint {
  month: string;
  date: string; // the day the balance is taken: the month end, or today for the running month
  total: number;
}

export function savingsHistory(accounts: readonly (LedgerAccount & { type?: string })[], txs: readonly TransactionModel[], today: string, n: number): SavingsPoint[] {
  const savings = accounts.filter((a) => a.type === 'savings' && !a.archived);
  if (!savings.length) return [];
  const months = [...lastCompleteMonths(today, n - 1), monthKey(today)];
  return months.map((month, i) => {
    const date = i === months.length - 1 ? today : `${month}-${String(lastDayOfMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)))).padStart(2, '0')}`;
    const b = balances(accounts, txs, 'DOP', date);
    return { month, date, total: sumMoney(savings.map((a) => b.byAccount.get(a.id) ?? 0)) };
  });
}

// ----- comparison of two months

export interface MonthSnapshot {
  personalNet: number;
  commercialGross: number;
  commercialBenefit: number;
  expense: number;
  fixedExpense: number;
  variableExpense: number;
  netFlow: number; // income - expense of the month (all counted income)
  liquidEnd: number; // liquid balance at the end of the month
}

export interface ComparisonRow {
  id: keyof MonthSnapshot;
  a: number;
  b: number;
  diff: number; // b - a
  percent: number | null; // null when a is zero: a percentage of nothing says nothing
}

export const SNAPSHOT_ORDER: readonly (keyof MonthSnapshot)[] = ['personalNet', 'commercialGross', 'commercialBenefit', 'expense', 'fixedExpense', 'variableExpense', 'netFlow', 'liquidEnd'];

export function compareMonths(a: MonthSnapshot, b: MonthSnapshot): ComparisonRow[] {
  return SNAPSHOT_ORDER.map((id) => ({
    id,
    a: a[id],
    b: b[id],
    diff: round2(b[id] - a[id]),
    percent: a[id] !== 0 ? Math.round(((b[id] - a[id]) / Math.abs(a[id])) * 1000) / 10 : null,
  }));
}

// ----- available money

// Liquid money minus what is already committed (card payments due soon, fixed obligations still
// to pay this month) minus what is set aside in goals. Both numbers are always shown.
export function availableMoney(liquid: number, commitments: readonly number[], reserved = 0): number {
  return round2(liquid - sumMoney([...commitments]) - reserved);
}

// ----- cash flow projection

export interface CashEvent {
  date: string;
  amount: number;
}

export interface CashflowInput {
  startLiquid: number;
  today: string;
  income: readonly CashEvent[]; // guaranteed income still expected
  variableIncomeMonthly: number; // average of variable income (monthly)
  includeVariableIncome: boolean; // only with an explicit switch
  fixed: readonly CashEvent[]; // fixed obligations coming due
  cards: readonly CashEvent[]; // card statements coming due
  rates: { mid: number; low: number; high: number }; // variable spending per day
  cushion: number;
}

export interface CashflowPoint {
  day: number;
  date: string;
  mid: number;
  low: number; // worst case: the highest variable spending and no variable income
  high: number; // best case: the lowest variable spending
}

export interface Cashflow {
  points: CashflowPoint[]; // day 0 (today) to day 90
  summaries: { days: 30 | 60 | 90; mid: number; low: number; high: number }[];
  firstBelowZero: { mid: string | null; worst: string | null };
  firstBelowCushion: { mid: string | null; worst: string | null };
  assumptions: string[]; // English phrases (translation keys)
  estimate: true;
}

const DAYS_PER_MONTH = 30.44;

export function cashflowProjection(input: CashflowInput): Cashflow {
  const { today, cushion } = input;
  const dailyVariableIncome = input.includeVariableIncome ? input.variableIncomeMonthly / DAYS_PER_MONTH : 0;
  const byDay = (events: readonly CashEvent[]) => {
    const out = new Array<number>(91).fill(0);
    for (const e of events) {
      const d = Math.max(0, daysBetween(today, e.date)); // a due date already past counts today
      if (d <= 90) out[d] = addMoney(out[d], e.amount);
    }
    return out;
  };
  const inc = byDay(input.income);
  const fixed = byDay(input.fixed);
  const cards = byDay(input.cards);
  const points: CashflowPoint[] = [];
  let known = input.startLiquid;
  for (let day = 0; day <= 90; day++) {
    known = known + inc[day] - fixed[day] - cards[day];
    points.push({
      day,
      date: addDays(today, day),
      mid: round2(known + dailyVariableIncome * day - input.rates.mid * day),
      low: round2(known - input.rates.high * day),
      high: round2(known + dailyVariableIncome * day - input.rates.low * day),
    });
  }
  const first = (pick: (p: CashflowPoint) => number, limit: number) => points.find((p) => pick(p) < limit)?.date ?? null;
  const assumptions = [
    'Starts from your liquid balance today.',
    'Adds only guaranteed income still expected (recurring and documented).',
    input.includeVariableIncome ? 'Includes the average of variable income (switched on by you).' : 'Variable income is NOT included.',
    'Subtracts fixed obligations and card statements by their due date.',
    'Variable spending follows the recent weekly rate; the band uses the lowest and highest week.',
  ];
  return {
    points,
    summaries: ([30, 60, 90] as const).map((days) => ({ days, mid: points[days].mid, low: points[days].low, high: points[days].high })),
    firstBelowZero: { mid: first((p) => p.mid, 0), worst: first((p) => p.low, 0) },
    firstBelowCushion: { mid: cushion > 0 ? first((p) => p.mid, cushion) : null, worst: cushion > 0 ? first((p) => p.low, cushion) : null },
    assumptions,
    estimate: true,
  };
}

// ----- unusual expenses

export interface UnusualFlag {
  txId: string;
  categoryId: string;
  amount: number;
  date: string;
  threshold: number;
  rule: 'iqr' | 'median';
  reference: number; // Q3 (iqr) or the median (median)
  samples: number; // how many movements of the category the rule looked at
}

export interface UnusualResult {
  sufficient: boolean; // at least 3 months with data
  monthsWithData: number;
  flags: UnusualFlag[];
}

// Linear interpolation between ranks
export function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export const MIN_SAMPLES_IQR = 8;
export const MIN_SAMPLES_MEDIAN = 3;

// Movements of this month above Q3 + 1.5 x IQR of the category's last 6 months (or above 2 x the
// median when there are few), and above a configurable minimum.
export function unusualExpenses(txs: readonly TransactionModel[], today: string, minAmount: number): UnusualResult {
  const history = new Set(lastCompleteMonths(today, 6));
  const current = monthKey(today);
  const byCategory = new Map<string, number[]>();
  const monthsWithData = new Set<string>();
  const candidates: TransactionModel[] = [];
  for (const t of txs) {
    if (t.type !== 'expense' || !isCounted(t) || txCurrency(t) !== 'DOP' || !t.categoryId) continue;
    const key = monthKey(t.date);
    if (history.has(key)) {
      monthsWithData.add(key);
      byCategory.set(t.categoryId, [...(byCategory.get(t.categoryId) ?? []), t.amount]);
    } else if (key === current && t.date <= today) candidates.push(t);
  }
  if (monthsWithData.size < 3) return { sufficient: false, monthsWithData: monthsWithData.size, flags: [] };
  const flags: UnusualFlag[] = [];
  for (const t of candidates) {
    const sample = [...(byCategory.get(t.categoryId!) ?? [])].sort((x, y) => x - y);
    if (sample.length < MIN_SAMPLES_MEDIAN || t.amount < minAmount) continue;
    let threshold: number;
    let rule: UnusualFlag['rule'];
    let reference: number;
    if (sample.length >= MIN_SAMPLES_IQR) {
      const q1 = quantile(sample, 0.25);
      const q3 = quantile(sample, 0.75);
      threshold = q3 + 1.5 * (q3 - q1);
      rule = 'iqr';
      reference = q3;
    } else {
      reference = quantile(sample, 0.5);
      threshold = 2 * reference;
      rule = 'median';
    }
    if (t.amount > threshold) flags.push({ txId: t.id, categoryId: t.categoryId!, amount: t.amount, date: t.date, threshold: round2(threshold), rule, reference: round2(reference), samples: sample.length });
  }
  return { sufficient: true, monthsWithData: monthsWithData.size, flags: flags.sort((a, b) => b.amount / b.threshold - a.amount / a.threshold) };
}
