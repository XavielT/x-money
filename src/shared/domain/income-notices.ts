// The days a phone reminder should fire for an expected income ("your payroll should arrive today"). Pure. It names only the
// source and the date: never an amount, and never a movement: the user still confirms with "Yes, it arrived".
import { IncomeSourceModel } from '../models/income-source.model';
import { TransactionModel } from '../models/transaction.model';
import { addDays } from './dates';
import { expectations } from './income';

export interface IncomeNotice {
  key: string; // stable: source + date
  sourceId: string;
  at: string; // ISO date the reminder fires
}

export function plannedIncomeNotices(sources: readonly IncomeSourceModel[], txs: readonly TransactionModel[], today: string, days = 35): IncomeNotice[] {
  const out: IncomeNotice[] = [];
  for (const s of sources) {
    // from today: an expectation already received or skipped is not "upcoming" and gets no reminder
    for (const e of expectations(s, txs, today, addDays(today, days), today)) {
      if (e.status === 'upcoming' || (e.status === 'pending' && e.date === today)) out.push({ key: `income:${s.id}:${e.date}`, sourceId: s.id, at: e.date });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
