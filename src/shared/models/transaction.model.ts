export type TransactionType = 'income' | 'expense';

export interface TransactionModel {
  id: string;
  type: TransactionType;
  amount: number;
  categoryId: string;
  accountId: string;
  date: string; // ISO yyyy-MM-dd
  note?: string;
}
