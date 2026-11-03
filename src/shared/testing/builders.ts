import { AccountModel } from '../models/account.model';
import { CategoryModel } from '../models/category.model';
import { RecurringModel } from '../models/recurring.model';
import { TransactionModel } from '../models/transaction.model';

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

export function account(overrides: Partial<AccountModel> = {}): AccountModel {
  return {
    id: nextId('acc'),
    name: 'Test account',
    icon: '🏦',
    type: 'bank',
    currency: 'DOP',
    initialBalance: 0,
    ...overrides,
  };
}

export function transaction(overrides: Partial<TransactionModel> = {}): TransactionModel {
  return {
    id: nextId('tx'),
    type: 'expense',
    amount: 100,
    categoryId: 'cat-other-expense',
    accountId: 'acc-1',
    date: '2026-11-02',
    ...overrides,
  };
}

export function category(overrides: Partial<CategoryModel> = {}): CategoryModel {
  return {
    id: nextId('cat'),
    name: 'Test category',
    icon: '🏷️',
    color: '#78909c',
    type: 'expense',
    ...overrides,
  };
}

export function recurring(overrides: Partial<RecurringModel> = {}): RecurringModel {
  return {
    id: nextId('rec'),
    type: 'expense',
    amount: 100,
    categoryId: 'cat-subscriptions',
    accountId: 'acc-1',
    frequency: 'monthly',
    startDate: '2026-10-01',
    nextDate: '2026-10-01',
    active: true,
    ...overrides,
  };
}
