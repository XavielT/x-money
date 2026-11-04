// Detection of recurring income (payroll and similar). Pure and conservative: it only
// suggests; nothing is tagged until the user confirms (rule 7: a variable income is never
// treated as guaranteed).
import { AccountType } from '../models/account.model';
import { TransactionModel } from '../models/transaction.model';
import { daysBetween } from './dates';
import { txCurrency } from './ledger';
import { round2 } from '../utils/money';

export type Cadence = 'weekly' | 'biweekly' | 'monthly';

const PERIOD: Record<Cadence, number> = { weekly: 7, biweekly: 15, monthly: 30 };
const TOLERANCE_DAYS = 3;
const AMOUNT_TOLERANCE = 0.05;
export const MIN_OCCURRENCES = 3;

export interface IncomePatternSuggestion {
  key: string; // account + cadence + amount bucket: stable, so a dismissal sticks
  accountId: string;
  cadence: Cadence;
  amount: number; // median
  count: number;
  lastDate: string;
  txIds: string[];
}

export interface IncomeAccount {
  id: string;
  type: AccountType;
  archived?: boolean;
}

const median = (values: number[]): number => {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : round2((s[mid - 1] + s[mid]) / 2);
};

// Groups amounts within +-5% of the group's median
function clusterByAmount(txs: TransactionModel[]): TransactionModel[][] {
  const sorted = [...txs].sort((a, b) => a.amount - b.amount);
  const clusters: TransactionModel[][] = [];
  for (const t of sorted) {
    const current = clusters[clusters.length - 1];
    if (current && Math.abs(t.amount - median(current.map((x) => x.amount))) <= median(current.map((x) => x.amount)) * AMOUNT_TOLERANCE) {
      current.push(t);
    } else {
      clusters.push([t]);
    }
  }
  return clusters;
}

const inBand = (gap: number, period: number, times = 1) => Math.abs(gap - period * times) <= TOLERANCE_DAYS * times;

// A late payment shifts two gaps (one long, one short) that together still fit two periods
function regularity(gaps: number[], period: number): number {
  let ok = 0;
  for (let i = 0; i < gaps.length; i++) {
    if (inBand(gaps[i], period)) ok++;
    else if (i + 1 < gaps.length && inBand(gaps[i] + gaps[i + 1], period, 2)) {
      ok += 2;
      i++;
    }
  }
  return ok / gaps.length;
}

export function detectRecurringIncomes(
  txs: readonly TransactionModel[],
  accounts: readonly IncomeAccount[],
  skip: readonly string[] = [] // keys already confirmed or dismissed
): IncomePatternSuggestion[] {
  const bankIds = new Set(accounts.filter((a) => (a.type === 'bank' || a.type === 'savings') && !a.archived).map((a) => a.id));
  const incomes = txs.filter(
    (t) =>
      t.type === 'income' &&
      t.status !== 'reversed' &&
      t.origin !== 'adjustment' &&
      t.scope !== 'business' &&
      t.origin !== 'reversal' &&
      t.origin !== 'loan-disbursement' &&
      txCurrency(t) === 'DOP' &&
      bankIds.has(t.accountId)
  );

  const byAccount = new Map<string, TransactionModel[]>();
  for (const t of incomes) byAccount.set(t.accountId, [...(byAccount.get(t.accountId) ?? []), t]);

  const found: IncomePatternSuggestion[] = [];
  for (const [accountId, list] of byAccount) {
    for (const cluster of clusterByAmount(list)) {
      if (cluster.length < MIN_OCCURRENCES) continue;
      const dated = [...cluster].sort((a, b) => a.date.localeCompare(b.date));
      const gaps = dated.slice(1).map((t, i) => daysBetween(dated[i].date, t.date));
      if (gaps.some((g) => g <= 0)) continue; // two deposits the same day are not a cadence
      const typical = median(gaps);
      const cadence = (Object.keys(PERIOD) as Cadence[]).find((c) => inBand(typical, PERIOD[c]));
      if (!cadence || regularity(gaps, PERIOD[cadence]) < 0.75) continue;
      const amount = median(cluster.map((t) => t.amount));
      const key = `${accountId}|${cadence}|${Math.floor(amount / 100)}`;
      if (skip.includes(key)) continue;
      found.push({
        key,
        accountId,
        cadence,
        amount,
        count: cluster.length,
        lastDate: dated[dated.length - 1].date,
        txIds: dated.map((t) => t.id),
      });
    }
  }
  return found.sort((a, b) => b.lastDate.localeCompare(a.lastDate));
}
