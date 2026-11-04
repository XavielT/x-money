// "Ant expenses": small purchases that add up. One rule for the monthly insight and for a
// credit card's period, so the two never drift apart.
import { sumMoney } from '../utils/money';

export interface SmallPurchases {
  count: number;
  total: number;
  percent: number; // share of the whole spending of the period
  threshold: number;
}

export const NO_SMALL_PURCHASES: SmallPurchases = { count: 0, total: 0, percent: 0, threshold: 0 };

// Without a ceiling the usual relative rule applies: below ~2% of the spending, at least 100
export function smallPurchases(amounts: readonly number[], ceiling?: number): SmallPurchases {
  const total = sumMoney([...amounts]);
  if (!total) return NO_SMALL_PURCHASES;
  const threshold = ceiling !== undefined && ceiling > 0 ? ceiling : Math.max(100, total * 0.02);
  const small = amounts.filter((a) => a <= threshold);
  const smallTotal = sumMoney(small);
  return { count: small.length, total: smallTotal, percent: Math.round((smallTotal / total) * 100), threshold };
}

export interface SmallItem {
  amount: number;
  categoryId?: string;
  note?: string;
}

export interface SmallBreakdown {
  summary: SmallPurchases;
  byCategory: { categoryId: string; count: number; total: number; percent: number }[]; // which categories concentrate them
  top: { label: string; categoryId?: string; count: number; total: number }[]; // what weighs most (same note, else same category)
}

// The same rule as smallPurchases, plus where the small purchases pile up
export function smallBreakdown(items: readonly SmallItem[], ceiling?: number): SmallBreakdown {
  const summary = smallPurchases(items.map((i) => i.amount), ceiling);
  const small = items.filter((i) => i.amount <= summary.threshold);
  const cats = new Map<string, { count: number; total: number }>();
  const labels = new Map<string, { label: string; categoryId?: string; count: number; total: number }>();
  for (const i of small) {
    const c = cats.get(i.categoryId ?? '') ?? { count: 0, total: 0 };
    cats.set(i.categoryId ?? '', { count: c.count + 1, total: sumMoney([c.total, i.amount]) });
    const label = i.note?.trim().toLowerCase() || i.categoryId || '';
    const l = labels.get(label) ?? { label, categoryId: i.categoryId, count: 0, total: 0 };
    labels.set(label, { ...l, count: l.count + 1, total: sumMoney([l.total, i.amount]) });
  }
  return {
    summary,
    byCategory: [...cats.entries()]
      .map(([categoryId, v]) => ({ categoryId, ...v, percent: summary.total ? Math.round((v.total / summary.total) * 100) : 0 }))
      .sort((a, b) => b.total - a.total),
    top: [...labels.values()].sort((a, b) => b.total - a.total).slice(0, 5),
  };
}
