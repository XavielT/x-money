export type TransactionType = 'income' | 'expense';

// A transaction can also be a transfer between two accounts; transfers do not
// count as income or expense anywhere (summaries, stats, budgets)
export type TransactionKind = TransactionType | 'transfer';

export type TransactionCurrency = 'DOP' | 'USD';

// Where a movement came from. The module-specific ones are declared up front so the
// schema does not have to change again; they are unused until their prompt.
export type TransactionOrigin =
  | 'manual'
  | 'recurring'
  | 'transfer'
  | 'card-payment'
  | 'adjustment'
  | 'reversal'
  | 'import'
  | 'loan-disbursement'
  | 'business-sale'
  | 'business-purchase';

// 'reversed' marks both halves of a reversed pair: balances keep both (they cancel),
// statistics and budgets skip both
export type TransactionStatus = 'posted' | 'reversed';

export interface TransactionModel {
  id: string;
  type: TransactionKind;
  amount: number;
  categoryId?: string; // absent on transfers
  accountId: string; // source account
  toAccountId?: string; // destination account, transfers only
  currency?: TransactionCurrency; // default DOP (the primary currency)
  fee?: number; // bank commission/tax discounted with the movement (e.g. DGII 0.15%)
  date: string; // ISO yyyy-MM-dd
  note?: string;

  // Traceability (schema v2, all optional so v1 data stays valid)
  origin?: TransactionOrigin;
  linkedId?: string; // related pair / document: linked movements are one atomic unit
  groupTotal?: number; // declared total of a partial operation (parts share linkedId)
  reversalOf?: string; // set on the inverse movement: the original it cancels
  reversedBy?: string; // set on the original: its inverse movement
  correctionOf?: string; // new movement that replaces a reconciled one (via reversal)
  status?: TransactionStatus;
  createdAt?: string; // ISO timestamp, absent on movements that predate 2.7.0
  updatedAt?: string;
  reconciled?: boolean; // appeared on a bank statement
  incomePattern?: string; // confirmed recurring-income pattern (prompt 03 links it to a source)
}
