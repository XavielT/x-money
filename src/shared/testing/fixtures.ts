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

// A fuller 2.5.1 shape: dual credit card, linked debit card, transfer with fee, recurring
// rule, custom category, budgets, USD movement.
export const FIXTURE_251_FULL: Record<string, unknown> = {
  accounts: [
    { id: 'a-cash', name: 'Wallet', icon: '💵', initialBalance: 1500.5 }, // pre-2.1: no type/currency
    { id: 'a-bank', name: 'Bank', icon: '🏦', type: 'bank', currency: 'DOP', initialBalance: 20000, bankKind: 'payroll' },
    { id: 'a-debit', name: 'Debit', icon: '💳', type: 'card', cardKind: 'debit', currency: 'DOP', linkedAccountId: 'a-bank', initialBalance: 0 },
    { id: 'a-visa', name: 'Visa', icon: '💳', type: 'card', cardKind: 'credit', currency: 'dual', initialBalance: 0 },
    { id: 'a-usd', name: 'Dollars', icon: '🏦', type: 'savings', currency: 'USD', initialBalance: 300 },
  ],
  categories: [{ id: 'custom-1', name: 'Coffee', icon: '☕', color: '#8d6e63', type: 'expense' }],
  transactions: [
    { id: 't1', type: 'expense', amount: 250.75, categoryId: 'cat-food', accountId: 'a-cash', date: '2026-11-01' },
    { id: 't2', type: 'income', amount: 5000, categoryId: 'cat-salary', accountId: 'a-bank', date: '2026-11-02', fee: 10 },
    { id: 't3', type: 'transfer', amount: 1000, accountId: 'a-bank', toAccountId: 'a-cash', fee: 2, date: '2026-11-02' },
    { id: 't4', type: 'expense', amount: 40, currency: 'USD', categoryId: 'cat-food', accountId: 'a-usd', date: '2026-11-03' },
    { id: 't5', type: 'expense', amount: 800, categoryId: 'custom-1', accountId: 'a-debit', date: '2026-11-03' },
    { id: 't6', type: 'expense', amount: 3000, categoryId: 'cat-shopping', accountId: 'a-visa', date: '2026-11-03' },
    { id: 't7', type: 'expense', amount: 25, currency: 'USD', categoryId: 'cat-subscriptions', accountId: 'a-visa', date: '2026-11-03' },
  ],
  budgets: [{ id: 'b1', categoryId: 'cat-food', monthlyLimit: 3000 }],
  recurring: [
    { id: 'r1', type: 'expense', amount: 500, categoryId: 'cat-subscriptions', accountId: 'a-bank', frequency: 'monthly', startDate: '2026-12-01', nextDate: '2026-12-01', active: true },
  ],
  settings: { currency: 'RD$', taxPercent: 0.2 },
};
