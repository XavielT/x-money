// The expenses filed under "Other", grouped by the place they were made at, so one tap can file all of them in the category that
// fits. Pure. Only what the user can still edit: a reversed movement, a reversal, an adjustment and business movements are not here.
import { TransactionCurrency, TransactionModel } from '../models/transaction.model';
import { normalizeMerchant } from './capture/merchant';
import { hintFor } from './merchant-categories';

export const OTHER_EXPENSE_ID = 'cat-other-expense';

export interface OtherGroup {
  key: string; // the place, normalized: two readings of the same shop share it
  label: string; // how to show it (the first note of the group, without the bank's reference)
  currency: TransactionCurrency;
  count: number;
  total: number; // major units, only meaningful inside one currency
  ids: string[]; // the movements (newest first)
  suggestion?: string; // a category id the built-in knowledge proposes
}

// "SHELL AV LUPERON · ref 123" -> "SHELL AV LUPERON"
const placeOf = (note: string | undefined): string => (note ?? '').split(' · ')[0].trim();

export function otherGroups(txs: readonly TransactionModel[], categoryExists: (id: string) => boolean = () => true): OtherGroup[] {
  const groups = new Map<string, OtherGroup>();
  const sorted = [...txs].sort((a, b) => b.date.localeCompare(a.date));
  for (const t of sorted) {
    if (t.type !== 'expense' || t.categoryId !== OTHER_EXPENSE_ID) continue;
    if (t.status === 'reversed' || t.reversalOf || t.reversedBy || t.origin === 'adjustment' || t.origin === 'reversal' || t.scope === 'business') continue;
    const label = placeOf(t.note);
    const norm = normalizeMerchant(label);
    if (!norm) continue; // a movement with no place says nothing to group by
    const currency: TransactionCurrency = t.currency ?? 'DOP';
    const key = `${currency}|${norm.split(' ').slice(0, 3).join(' ')}`;
    const g = groups.get(key) ?? { key, label, currency, count: 0, total: 0, ids: [] as string[] };
    g.count += 1;
    g.total = Math.round((g.total + t.amount) * 100) / 100;
    g.ids.push(t.id);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => {
      const hint = hintFor(g.label, 'expense');
      return hint && categoryExists(hint.categoryId) ? { ...g, suggestion: hint.categoryId } : g;
    })
    .sort((a, b) => b.total - a.total);
}
