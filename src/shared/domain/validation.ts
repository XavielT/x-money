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
  | 'gross' // gross below the net received, or not a number
  | 'deductions'
  | 'cost-basis'
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
  grossAmount?: number;
  deductions?: { name: string; amount: number }[];
  costBasis?: number;
  saleExpenses?: number;
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
  if (input.grossAmount !== undefined && input.grossAmount !== null) {
    // the net is what arrived: it cannot be more than the gross
    if (!Number.isFinite(input.grossAmount) || input.grossAmount < input.amount) return 'gross';
  }
  if (input.deductions !== undefined && input.deductions !== null) {
    if (!Array.isArray(input.deductions) || input.deductions.some((d) => !d || typeof d.name !== 'string' || !d.name.trim() || !Number.isFinite(d.amount) || d.amount < 0)) return 'deductions';
  }
  for (const v of [input.costBasis, input.saleExpenses]) {
    if (v !== undefined && v !== null && (!Number.isFinite(v) || v < 0)) return 'cost-basis';
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
