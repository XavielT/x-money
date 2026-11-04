// Fixed obligations (recurring expenses): monthly cost, annual projection and what is still to be
// paid this month. Pure. The date stepping is the one RecurringService has always used.
import { RecurringFrequency, RecurringModel } from '../models/recurring.model';
import { addMoney, round2 } from '../utils/money';

// Same factors the subscription-cost insight has always used (daily and weekly are averages)
export const MONTHLY_FACTOR: Readonly<Record<RecurringFrequency, number>> = { daily: 30.44, weekly: 4.35, monthly: 1, yearly: 1 / 12 };

export const monthlyEquivalent = (rule: Pick<RecurringModel, 'amount' | 'frequency'>): number => round2(rule.amount * (MONTHLY_FACTOR[rule.frequency] ?? 1));

// Next occurrence after `date`. The anchor day keeps "every 31st" clamping in short months
// (Feb -> 28) and returning to 31 afterwards.
export function advanceDate(date: string, frequency: RecurringFrequency, anchorDay: number): string {
  const [y, m, d] = date.split('-').map(Number);
  let next: Date;
  switch (frequency) {
    case 'daily':
      next = new Date(y, m - 1, d + 1);
      break;
    case 'weekly':
      next = new Date(y, m - 1, d + 7);
      break;
    case 'monthly': {
      const lastDay = new Date(y, m + 1, 0).getDate();
      next = new Date(y, m, Math.min(anchorDay, lastDay));
      break;
    }
    case 'yearly': {
      const lastDay = new Date(y + 1, m, 0).getDate();
      next = new Date(y + 1, m - 1, Math.min(anchorDay, lastDay));
      break;
    }
  }
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
}

export const anchorDayOf = (rule: Pick<RecurringModel, 'startDate'>): number => Number(rule.startDate.split('-')[2]);

// Occurrences of a rule from its next date up to `to`, inclusive (what is still to be posted)
export function occurrencesUntil(rule: RecurringModel, to: string): string[] {
  const out: string[] = [];
  let d = rule.nextDate;
  for (let guard = 0; d <= to && guard < 400; guard++) {
    out.push(d);
    d = advanceDate(d, rule.frequency, anchorDayOf(rule));
  }
  return out;
}

export interface FixedSummary {
  monthly: number; // estimated monthly cost of the active rules
  yearly: number; // monthly x 12 (an estimate)
  pendingThisMonth: number; // occurrences still to be paid until the end of the month
  pending: { ruleId: string; date: string; amount: number }[];
  estimate: true;
}

export function fixedSummary(rules: readonly RecurringModel[], monthEnd: string): FixedSummary {
  let monthly = 0;
  let pendingThisMonth = 0;
  const pending: FixedSummary['pending'] = [];
  for (const r of rules) {
    monthly = addMoney(monthly, monthlyEquivalent(r));
    for (const date of occurrencesUntil(r, monthEnd)) {
      pendingThisMonth = addMoney(pendingThisMonth, r.amount);
      pending.push({ ruleId: r.id, date, amount: r.amount });
    }
  }
  return { monthly, yearly: round2(monthly * 12), pendingThisMonth, pending: pending.sort((a, b) => a.date.localeCompare(b.date)), estimate: true };
}
