// Reversals, linked groups and partial operations. Nothing is ever deleted by a reversal:
// the inverse movement is added next to the original and both are marked.
import { TransactionModel } from '../models/transaction.model';
import { addMoney, subMoney } from '../utils/money';

// Movements that are one atomic unit with `tx` (same linkedId, or the document it points to)
export function groupOf(txs: readonly TransactionModel[], tx: TransactionModel): TransactionModel[] {
  if (!tx.linkedId) return [tx];
  return txs.filter((t) => t.id === tx.id || t.linkedId === tx.linkedId || t.id === tx.linkedId);
}

export const isReversalPart = (t: TransactionModel): boolean => !!(t.reversalOf || t.reversedBy);

// Inverse of a movement, dated `date` (a reversal never changes the original's date, so the
// history is not reordered). The pair cancels out in balances. The fee the bank already
// charged is NOT refunded: it stays on the original (balance and statistics both keep it).
export function buildReversal(original: TransactionModel, date: string, id: string, now: string): TransactionModel {
  const inverse: TransactionModel = {
    id,
    type: original.type === 'income' ? 'expense' : original.type === 'expense' ? 'income' : 'transfer',
    amount: original.amount,
    accountId: original.type === 'transfer' ? original.toAccountId! : original.accountId,
    toAccountId: original.type === 'transfer' ? original.accountId : undefined,
    categoryId: original.categoryId,
    currency: original.currency,
    date,
    note: original.note,
    origin: 'reversal',
    linkedId: original.linkedId,
    reversalOf: original.id,
    status: 'reversed',
    createdAt: now,
    updatedAt: now,
  };
  return inverse;
}

// Sum of the parts of a partial operation that still count (reversed parts do not)
export function partsTotal(parts: readonly TransactionModel[]): number {
  return parts.filter((p) => p.status !== 'reversed').reduce((sum, p) => addMoney(sum, p.amount), 0);
}

// A part can be added only while the sum stays within the declared total
export function partFits(existingParts: readonly TransactionModel[], newAmount: number, declaredTotal: number): boolean {
  return subMoney(declaredTotal, addMoney(partsTotal(existingParts), newAmount)) >= 0;
}
