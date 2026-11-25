// Which accounts have gone too long without being matched against the bank. Pure. A reminder, never an action: it only names
// the accounts; the user opens "Match with the bank" and decides. Cash, debit cards (their money is in the linked account),
// archived accounts and accounts with no movements yet are never due.
import { AccountModel } from '../models/account.model';
import { TransactionModel } from '../models/transaction.model';

export const MATCH_EVERY_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface MatchDue {
  account: AccountModel;
  days: number | null; // days since the last match, null = never matched
}

export function accountsToMatch(accounts: readonly AccountModel[], txs: readonly TransactionModel[], now: Date, everyDays = MATCH_EVERY_DAYS): MatchDue[] {
  const withMovements = new Set<string>();
  for (const t of txs) {
    if (t.status === 'reversed') continue;
    if (t.accountId) withMovements.add(t.accountId);
    if (t.toAccountId) withMovements.add(t.toAccountId);
  }
  const due: MatchDue[] = [];
  for (const a of accounts) {
    if (a.archived || a.type === 'cash' || a.type === 'other') continue;
    if (a.type === 'card' && a.cardKind !== 'credit') continue;
    if (!withMovements.has(a.id)) continue;
    const last = a.reconciledAt ? new Date(`${a.reconciledAt.slice(0, 10)}T00:00:00`).getTime() : NaN;
    const days = Number.isFinite(last) ? Math.floor((now.getTime() - last) / DAY_MS) : null;
    if (days === null || days >= everyDays) due.push({ account: a, days });
  }
  // never matched first, then the longest ago
  return due.sort((x, y) => (y.days ?? Infinity) - (x.days ?? Infinity));
}
