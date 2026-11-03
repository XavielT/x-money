import { LegacySource } from '../data-layer/legacy';

export class FakeLegacy implements LegacySource {
  archived: string[] = [];
  mirrored: Record<string, string | null> = {};
  constructor(public raw: Record<string, string> = {}) {}
  async readAll() {
    return { ...this.raw };
  }
  async archive(keys: string[]) {
    this.archived.push(...keys);
  }
  mirror(key: string, raw: string | null) {
    this.mirrored[key] = raw;
  }
  writeLocal() {
    /* degraded mode only */
  }
  async clearAll() {
    this.raw = {};
  }
}

// Shape of what 2.5.1 kept in localStorage: pre-2.1 account without type/currency,
// a USD movement, a transfer with fee, a recurring rule.
export const FIXTURE_251: Record<string, unknown> = {
  accounts: [
    { id: 'a-cash', name: 'Wallet', icon: '💵', initialBalance: 1500.5 },
    { id: 'a-bank', name: 'Bank', icon: '🏦', type: 'bank', currency: 'DOP', initialBalance: 20000 },
    { id: 'a-usd', name: 'Dollars', icon: '🏦', type: 'bank', currency: 'USD', initialBalance: 300 },
  ],
  categories: [{ id: 'custom-1', name: 'Coffee', icon: '☕', color: '#8d6e63', type: 'expense' }],
  transactions: [
    { id: 't1', type: 'expense', amount: 250.75, categoryId: 'cat-food', accountId: 'a-cash', date: '2026-11-01' },
    { id: 't2', type: 'income', amount: 5000, categoryId: 'cat-salary', accountId: 'a-bank', date: '2026-11-02', fee: 10 },
    { id: 't3', type: 'transfer', amount: 1000, accountId: 'a-bank', toAccountId: 'a-cash', fee: 2, date: '2026-11-02' },
    { id: 't4', type: 'expense', amount: 40, currency: 'USD', categoryId: 'cat-food', accountId: 'a-usd', date: '2026-11-03' },
  ],
  budgets: [{ id: 'b1', categoryId: 'cat-food', monthlyLimit: 3000 }],
  recurring: [],
  settings: { currency: 'RD$' },
  lock: 'a'.repeat(64),
};

export const asLegacy = (values: Record<string, unknown>) =>
  new FakeLegacy(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, JSON.stringify(v)])));
