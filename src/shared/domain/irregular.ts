// Spending that happens a variable number of times (work lunches: RD$250-400 each, 0 to 4 times a
// week). Pure. Everything returned is an ESTIMATE (rule 10) and carries its assumptions; the
// nature of these expenses stays variable (rule 8).
import { IrregularPattern } from '../models/category.model';
import { TransactionModel } from '../models/transaction.model';
import { addMoney, round2 } from '../utils/money';
import { addDays, daysBetween, lastDayOfMonth } from './dates';

const WEEKS_PER_MONTH = 52 / 12;
export const HISTORY_WINDOW_WEEKS = 8;
export const MIN_HISTORY_WEEKS = 4;

export const timesPerWeek = (times: number, per: IrregularPattern['per']): number => (per === 'week' ? times : times / WEEKS_PER_MONTH);

export interface IrregularProjection {
  occurrences: number; // in the month so far
  averagePerTransaction: number | null; // null without occurrences
  spent: number; // accumulated in the month
  projected: number; // spent + what the rest of the month is expected to add
  low: number; // from the declared minimums
  high: number; // from the declared maximums
  basis: 'history' | 'declared'; // declared midpoint when there are fewer than 4 weeks of history
  historyWeeks: number;
  assumptions: { perWeek: number; averageAmount: number; remainingWeeks: number };
  estimate: true;
}

// `txs`: the counted expenses of this category (RD$), any dates. Month is 1-12.
export function irregularProjection(txs: readonly TransactionModel[], pattern: IrregularPattern, today: string, year: number, month: number): IrregularProjection {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const monthEnd = `${prefix}-${String(lastDayOfMonth(year, month)).padStart(2, '0')}`;
  const inMonth = txs.filter((t) => t.date.startsWith(prefix));
  let spent = 0;
  for (const t of inMonth) spent = addMoney(spent, t.amount);
  const occurrences = inMonth.length;

  // how much history there is: weeks since the first movement of this category
  const first = txs.map((t) => t.date).sort()[0];
  const historyDays = first && first <= today ? daysBetween(first, today) + 1 : 0;
  const historyWeeks = Math.floor(historyDays / 7);

  const midpoint = { perWeek: (timesPerWeek(pattern.timesMin, pattern.per) + timesPerWeek(pattern.timesMax, pattern.per)) / 2, amount: (pattern.amountMin + pattern.amountMax) / 2 };
  let perWeek = midpoint.perWeek;
  let averageAmount = midpoint.amount;
  let basis: IrregularProjection['basis'] = 'declared';
  if (historyWeeks >= MIN_HISTORY_WEEKS) {
    const weeks = Math.min(HISTORY_WINDOW_WEEKS, historyWeeks);
    const from = addDays(today, -(weeks * 7) + 1);
    const recent = txs.filter((t) => t.date >= from && t.date <= today);
    perWeek = recent.length / weeks;
    if (recent.length) averageAmount = recent.reduce((s, t) => s + t.amount, 0) / recent.length;
    basis = 'history';
  }

  // days still to come this month (a past month has none, a future month all of it)
  const remainingDays = today >= monthEnd ? 0 : today < `${prefix}-01` ? lastDayOfMonth(year, month) : daysBetween(today, monthEnd);
  const remainingWeeks = remainingDays / 7;
  const projected = round2(spent + perWeek * averageAmount * remainingWeeks);
  const low = round2(spent + timesPerWeek(pattern.timesMin, pattern.per) * pattern.amountMin * remainingWeeks);
  const high = round2(spent + timesPerWeek(pattern.timesMax, pattern.per) * pattern.amountMax * remainingWeeks);
  return {
    occurrences,
    averagePerTransaction: occurrences ? round2(spent / occurrences) : null,
    spent,
    projected,
    // behavior outside the declared range widens the range instead of contradicting the estimate
    low: Math.min(low, projected),
    high: Math.max(high, projected),
    basis,
    historyWeeks,
    assumptions: { perWeek: Math.round(perWeek * 100) / 100, averageAmount: round2(averageAmount), remainingWeeks: Math.round(remainingWeeks * 100) / 100 },
    estimate: true,
  };
}
