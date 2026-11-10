import { CategoryModel } from '../models/category.model';
import { TransactionModel } from '../models/transaction.model';

// The categories of a type, the ones the user picks most first (ties keep the catalog order). Pure.
// Only movements the user wrote count (reversals and reversed originals say nothing about habit).
export function rankCategories(categories: readonly CategoryModel[], transactions: readonly Pick<TransactionModel, 'type' | 'categoryId' | 'status' | 'origin'>[], type: 'expense' | 'income'): CategoryModel[] {
  const uses = new Map<string, number>();
  for (const t of transactions) {
    if (t.type !== type || !t.categoryId || t.status === 'reversed' || t.origin === 'reversal') continue;
    uses.set(t.categoryId, (uses.get(t.categoryId) ?? 0) + 1);
  }
  return categories
    .map((c, i) => ({ c, i, n: uses.get(c.id) ?? 0 }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((x) => x.c);
}

// The grid shows the first `limit`; a category chosen from "More" takes the first place so the choice is always visible.
export function splitCategories<T extends { id: string }>(ranked: readonly T[], limit: number, selectedId = ''): { shown: T[]; rest: T[] } {
  if (ranked.length <= limit) return { shown: [...ranked], rest: [] };
  let shown = ranked.slice(0, limit);
  const selected = ranked.find((c) => c.id === selectedId);
  if (selected && !shown.some((c) => c.id === selectedId)) shown = [selected, ...shown.slice(0, limit - 1)];
  const keep = new Set(shown.map((c) => c.id));
  return { shown, rest: ranked.filter((c) => !keep.has(c.id)) };
}
