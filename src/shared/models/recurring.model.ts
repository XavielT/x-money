import { TransactionKind } from './transaction.model';

export type RecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurringModel {
  id: string;
  type: TransactionKind;
  amount: number;
  categoryId?: string; // absent on transfers
  accountId: string;
  toAccountId?: string; // transfers only
  fee?: number; // bank commission/tax charged with each occurrence
  note?: string;
  frequency: RecurringFrequency;
  startDate: string; // ISO yyyy-MM-dd, first occurrence (anchors the day of month)
  nextDate: string; // next occurrence still to be posted
  active: boolean;
}
