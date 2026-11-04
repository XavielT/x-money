// Reconciliation of one account against the bank statement. The difference is NEVER
// adjusted silently: the app shows it and lets the user review movements or create a
// visible, audited adjustment.
import { TransactionCurrency, TransactionModel } from '../models/transaction.model';
import { subMoney } from '../utils/money';
import { addDays } from './dates';
import { LedgerAccount, accountBalance, ownerId, txCurrency } from './ledger';

export interface ReconcileView {
  calculated: number; // balance at the statement date, from movements only
  difference: number; // bank balance - calculated
  pending: TransactionModel[]; // movements since the last reconciliation, up to the date
}

export function reconcileView(
  accounts: readonly LedgerAccount[],
  txs: readonly TransactionModel[],
  accountId: string,
  currency: TransactionCurrency,
  statementDate: string,
  bankBalance: number,
  lastReconciledAt?: string
): ReconcileView {
  const calculated = accountBalance(accounts, txs, accountId, currency, statementDate);
  // since the last reconciliation; the first time, the last two months (the difference always
  // uses the whole history, the list is only what is worth ticking)
  const since = lastReconciledAt ?? addDays(statementDate, -62);
  const pending = txs
    .filter(
      (t) =>
        txCurrency(t) === currency &&
        t.date <= statementDate &&
        t.date > since &&
        !t.reconciled &&
        (ownerId(accounts, t.accountId) === accountId ||
          (t.toAccountId !== undefined && ownerId(accounts, t.toAccountId) === accountId))
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  return { calculated, difference: subMoney(bankBalance, calculated), pending };
}

// Adjustment that makes the calculated balance match the bank: positive difference = income
export function adjustmentFor(difference: number): { type: 'income' | 'expense'; amount: number } | null {
  if (Math.abs(difference) < 0.005) return null;
  return { type: difference > 0 ? 'income' : 'expense', amount: Math.abs(difference) };
}
