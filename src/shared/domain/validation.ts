// Validation of a movement before it is saved. Pure: the caller provides the accounts and
// today's date. The service enforces it, so it applies to every entry point (form,
// recurring rules, imports of single movements), not only to the form.
import { TransactionCurrency, TransactionKind } from '../models/transaction.model';
import { addYears, isValidIsoDate } from './dates';
import { LedgerAccount, ownerId } from './ledger';

export type TxErrorCode =
  | 'amount'
  | 'fee'
  | 'date'
  | 'date-far-future' // allowed after an explicit confirmation
  | 'account'
  | 'account-archived'
  | 'currency'
  | 'to-account'
  | 'same-account'
  | 'cross-currency'
  | 'partial-exceeds'
  | 'reconciled' // needs confirmation: the correction goes through a reversal
  | 'linked'
  | 'reversed'
  | 'already-reversed'
  | 'not-found'
  | 'not-a-pair'
  | 'changed'
  | 'read-only';

export type TxResult = { ok: true; id: string } | { ok: false; error: TxErrorCode };

export interface TxInput {
  type: TransactionKind;
  amount: number;
  currency?: TransactionCurrency;
  accountId: string;
  toAccountId?: string;
  fee?: number;
  date: string;
}

export interface ValidationOptions {
  confirmFarFuture?: boolean;
  allowNegativeFee?: boolean; // only the inverse movement of a reversal carries a negative fee
}

const accepts = (a: LedgerAccount, currency: TransactionCurrency) => {
  const c = a.currency ?? 'DOP';
  return c === 'dual' || c === currency;
};

export function validateTransaction(
  input: TxInput,
  accounts: readonly LedgerAccount[],
  today: string,
  options: ValidationOptions = {}
): TxErrorCode | null {
  if (typeof input.amount !== 'number' || !Number.isFinite(input.amount) || input.amount <= 0) return 'amount';
  if (input.fee !== undefined && input.fee !== null) {
    if (!Number.isFinite(input.fee) || (input.fee < 0 && !options.allowNegativeFee)) return 'fee';
  }
  if (!isValidIsoDate(input.date)) return 'date';
  if (!options.confirmFarFuture && input.date > addYears(today, 1)) return 'date-far-future';

  const from = accounts.find((a) => a.id === input.accountId);
  if (!from) return 'account';
  if (from.archived) return 'account-archived';
  const currency = input.currency ?? 'DOP';
  if (!accepts(from, currency)) return 'currency';

  if (input.type === 'transfer') {
    const to = input.toAccountId ? accounts.find((a) => a.id === input.toAccountId) : undefined;
    if (!to) return 'to-account';
    if (to.archived) return 'account-archived';
    // a debit card and the bank account behind it are the same money
    if (ownerId(accounts, from.id) === ownerId(accounts, to.id)) return 'same-account';
    // RD$ <-> US$ would need both amounts; there is no invented exchange rate
    if (!accepts(to, currency)) return 'cross-currency';
  }
  return null;
}
