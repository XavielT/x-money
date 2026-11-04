// Detection of transfers between own accounts that were typed as an expense in one account
// and an income in another. Pure: it only suggests; the app never converts them by itself.
import { TransactionModel } from '../models/transaction.model';
import { daysBetween } from './dates';
import { LedgerAccount, ownerId, txCurrency } from './ledger';
import { round2, subMoney } from '../utils/money';

export interface TransferSuggestion {
  key: string; // stable id of the pair (used to remember a dismissal)
  expenseId: string;
  incomeId: string;
  amount: number; // what arrived
  fee: number; // what was lost on the way (bank fee/tax)
  fromAccountId: string;
  toAccountId: string;
  date: string;
}

export const WINDOW_DAYS = 3;

// Movements that can be one half of an unmarked transfer
const eligible = (t: TransactionModel) =>
  t.status !== 'reversed' &&
  !t.linkedId &&
  !t.reconciled &&
  t.scope !== 'business' &&
  (t.origin === undefined || t.origin === 'manual' || t.origin === 'import' || t.origin === 'recurring');

// The difference between what left and what arrived is accepted as a fee up to 1% of the
// amount (or 50 units for small amounts); anything bigger is probably not the same money
const feeTolerance = (amount: number) => Math.max(round2(amount * 0.01), 50);

export function detectUnmarkedTransfers(
  txs: readonly TransactionModel[],
  accounts: readonly LedgerAccount[],
  dismissed: readonly string[] = []
): TransferSuggestion[] {
  const active = new Set(accounts.filter((a) => !a.archived).map((a) => a.id));
  const expenses = txs.filter((t) => t.type === 'expense' && eligible(t) && active.has(t.accountId));
  const incomes = txs.filter((t) => t.type === 'income' && eligible(t) && active.has(t.accountId));

  const candidates: { e: TransactionModel; i: TransactionModel; gap: number; diff: number }[] = [];
  for (const e of expenses) {
    for (const i of incomes) {
      if (txCurrency(e) !== txCurrency(i)) continue;
      if (ownerId(accounts, e.accountId) === ownerId(accounts, i.accountId)) continue;
      const gap = Math.abs(daysBetween(e.date, i.date));
      if (gap > WINDOW_DAYS) continue;
      const diff = subMoney(e.amount, i.amount); // what was lost on the way
      if (diff < 0 || diff > feeTolerance(e.amount)) continue;
      candidates.push({ e, i, gap, diff });
    }
  }
  // closest pairs first; every movement is used at most once
  candidates.sort((a, b) => a.diff - b.diff || a.gap - b.gap || a.e.id.localeCompare(b.e.id));
  const usedE = new Set<string>();
  const usedI = new Set<string>();
  const out: TransferSuggestion[] = [];
  for (const { e, i, diff } of candidates) {
    if (usedE.has(e.id) || usedI.has(i.id)) continue;
    const key = `${e.id}|${i.id}`;
    if (dismissed.includes(key)) continue;
    usedE.add(e.id);
    usedI.add(i.id);
    out.push({
      key,
      expenseId: e.id,
      incomeId: i.id,
      amount: i.amount,
      fee: diff,
      fromAccountId: e.accountId,
      toAccountId: i.accountId,
      date: e.date < i.date ? e.date : i.date,
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
