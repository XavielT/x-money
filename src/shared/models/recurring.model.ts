import { TransactionType } from './transaction.model';

export type RecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurringModel {
  id: string;
  type: TransactionType;
  amount: number;
  categoryId: string;
  accountId: string;
  note?: string;
  frequency: RecurringFrequency;
  startDate: string; // ISO yyyy-MM-dd, first occurrence (anchors the day of month)
  nextDate: string; // next occurrence still to be posted
  active: boolean;
}
