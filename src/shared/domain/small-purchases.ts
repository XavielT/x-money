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
