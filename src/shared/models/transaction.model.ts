import { Nature } from './category.model';
import { Deduction } from './income-source.model';

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
  subcategoryId?: string; // optional child of categoryId: the category still holds the movement, so older totals add up
  nature?: Nature; // overrides the category's nature for this one movement
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
  incomePattern?: string; // confirmed recurring-income pattern (the user can turn it into a source)

  // Income (2.9.0). `amount` is always what reached the account (the net).
  incomeSourceId?: string; // absent = unclassified
  grossAmount?: number; // before deductions, optional
  deductions?: Deduction[]; // free list of named deductions, no built-in rates
  costBasis?: number; // commercial sales: what the goods cost
  saleExpenses?: number; // commercial sales: declared expenses of that sale
  businessOperationId?: string; // reserved for the business module (prompt 06)
}
