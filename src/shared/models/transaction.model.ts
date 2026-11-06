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
  | 'loan-disbursement' // money the lender handed over: not income
  | 'loan-principal' // the part of a loan payment that repays the debt: not an expense
  | 'loan-payment' // interest, insurance and charges of a loan payment (and the charges paid at the start): a real expense
  | 'business-sale'
  | 'business-purchase'
  | 'business-expense'
  | 'business-deposit'; // an advance from a buyer: not income, not profit until the sale

// 'business' movements move real money (balances include them) but are NOT personal income,
// personal expenses, personal budgets or personal statistics. Everything older is 'personal'.
export type TransactionScope = 'personal' | 'business';

// 'reversed' marks both halves of a reversed pair: balances keep both (they cancel),
// statistics and budgets skip both
export type TransactionStatus = 'posted' | 'reversed';

// What was bought, kept with the movement so that "what did I buy that day?" can be answered later.
// Optional and additive (2.20.2): movements written before it simply have none. Amounts are major units.
export interface PurchaseLine {
  description: string;
  quantity?: number;
  amount?: number;
}

export interface PurchaseDetails {
  lines?: PurchaseLine[]; // at most 30
  invoiceNumber?: string;
  fiscalNumber?: string; // NCF
  taxId?: string; // RNC of the seller
  subtotal?: number;
  tax?: number; // ITBIS: data, not another expense
  reference?: string;
  origin?: 'image' | 'pdf' | 'voice' | 'text' | 'email' | 'notification'; // what the details were read from
  text?: string; // the bank's own words (notice, email), reduced; at most 1500 characters
}

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
  details?: PurchaseDetails; // what was bought (captured from a receipt, an invoice or a bank notice)

  // Traceability (schema v2, all optional so v1 data stays valid)
  origin?: TransactionOrigin;
  scope?: TransactionScope;
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
