export type TransactionType = 'income' | 'expense';

// A transaction can also be a transfer between two accounts; transfers do not
// count as income or expense anywhere (summaries, stats, budgets)
export type TransactionKind = TransactionType | 'transfer';

export type TransactionCurrency = 'DOP' | 'USD';

export interface TransactionModel {
  id: string;
  type: TransactionKind;
  amount: number;
  categoryId?: string; // absent on transfers
  accountId: string; // source account
  toAccountId?: string; // destination account, transfers only
  currency?: TransactionCurrency; // default DOP (the primary currency)
  date: string; // ISO yyyy-MM-dd
  note?: string;
}
