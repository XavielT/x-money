// Income/expense statistics. Always RD$ (the primary currency): US$ movements only
// affect US$ balances. Transfers are never income or expense (rule 1); the bank fee of a
// movement is a real expense; reversed pairs and reconciliation adjustments are skipped.
import { TransactionModel, TransactionType } from '../models/transaction.model';
import { addMoney } from '../utils/money';
import { txCurrency } from './ledger';

export const BANK_FEES_CATEGORY = 'cat-bank-fees';

// Does this movement take part in income/expense statistics and budgets?
export function isCounted(t: Pick<TransactionModel, 'status' | 'origin'>): boolean {
  return t.status !== 'reversed' && t.origin !== 'adjustment';
}

// A reversal gives the amount back but not the fee the bank already charged: the fee of
// the original stays an expense even though the pair itself is skipped
export const feeOnly = (t: TransactionModel): boolean => t.status === 'reversed' && !!t.reversedBy && !!t.fee;

export interface Summary {
  income: number;
  expense: number;
}

export function summarize(txs: readonly TransactionModel[]): Summary {
  let income = 0;
  let expense = 0;
  for (const t of txs) {
    if (txCurrency(t) !== 'DOP') continue;
    if (!isCounted(t)) {
      if (feeOnly(t)) expense = addMoney(expense, t.fee!);
      continue;
    }
    if (t.fee) expense = addMoney(expense, t.fee);
    if (t.type === 'income') income = addMoney(income, t.amount);
    else if (t.type === 'expense') expense = addMoney(expense, t.amount);
  }
  return { income, expense };
}

export interface CategoryTotal {
  categoryId: string;
  total: number;
}

export function totalsByCategory(txs: readonly TransactionModel[], type: TransactionType): CategoryTotal[] {
  const totals = new Map<string, number>();
  const add = (id: string, amount: number) => totals.set(id, addMoney(totals.get(id) ?? 0, amount));
  for (const t of txs) {
    if (txCurrency(t) !== 'DOP') continue;
    if (!isCounted(t)) {
      if (type === 'expense' && feeOnly(t)) add(BANK_FEES_CATEGORY, t.fee!);
      continue;
    }
    if (type === 'expense' && t.fee) add(BANK_FEES_CATEGORY, t.fee);
    if (t.type !== type || !t.categoryId) continue;
    add(t.categoryId, t.amount);
  }
  return [...totals.entries()].map(([categoryId, total]) => ({ categoryId, total })).sort((a, b) => b.total - a.total);
}

// Spent in one category or subcategory, RD$ only (a RD$ budget never counts US$ movements).
// The bank fee of a movement belongs to "Bank fees", exactly as in totalsByCategory, so a budget
// on that category sees it (a reversed movement keeps the fee the bank already charged).
export function spentInCategory(txs: readonly TransactionModel[], categoryId: string): number {
  let spent = 0;
  for (const t of txs) {
    if (txCurrency(t) !== 'DOP') continue;
    if (!isCounted(t)) {
      if (categoryId === BANK_FEES_CATEGORY && feeOnly(t)) spent = addMoney(spent, t.fee!);
      continue;
    }
    if (categoryId === BANK_FEES_CATEGORY && t.fee) spent = addMoney(spent, t.fee);
    if (t.type === 'expense' && (t.categoryId === categoryId || t.subcategoryId === categoryId)) spent = addMoney(spent, t.amount);
  }
  return spent;
}
