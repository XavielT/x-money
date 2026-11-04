import { TransactionCurrency, TransactionKind } from './transaction.model';

export type RecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurringModel {
  id: string;
  type: TransactionKind;
  amount: number;
  categoryId?: string; // absent on transfers
  subcategoryId?: string;
  nature?: 'fixed' | 'variable'; // a recurring expense suggests fixed; the user decides
  accountId: string;
  toAccountId?: string; // transfers only
  currency?: TransactionCurrency; // default: the account's own currency
  fee?: number; // bank commission/tax charged with each occurrence
  note?: string;
  frequency: RecurringFrequency;
  startDate: string; // ISO yyyy-MM-dd, first occurrence (anchors the day of month)
  nextDate: string; // next occurrence still to be posted
  active: boolean;
  incomeSourceId?: string; // income rules only: labels what the rule posts (2.9.0)
}
