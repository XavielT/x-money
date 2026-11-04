import { CategoryModel } from '../models/category.model';
import { DEFAULT_NATURE } from '../domain/categories';

// Default set based on the common categories of Monefy / Spendee / Money Manager
const BASE_CATEGORIES: CategoryModel[] = [
  // Expense categories
  { id: 'cat-food', name: 'Food', icon: '🍔', color: '#ff7043', type: 'expense' },
  { id: 'cat-groceries', name: 'Groceries', icon: '🛒', color: '#66bb6a', type: 'expense' },
  { id: 'cat-restaurants', name: 'Restaurants', icon: '🍽️', color: '#ffa726', type: 'expense' },
  { id: 'cat-transport', name: 'Transport', icon: '🚗', color: '#42a5f5', type: 'expense' },
  { id: 'cat-home', name: 'Home', icon: '🏠', color: '#ab47bc', type: 'expense' },
  { id: 'cat-bills', name: 'Bills', icon: '🧾', color: '#ffca28', type: 'expense' },
  { id: 'cat-subscriptions', name: 'Subscriptions', icon: '📺', color: '#5c6bc0', type: 'expense' },
  { id: 'cat-health', name: 'Health', icon: '💊', color: '#ec407a', type: 'expense' },
  { id: 'cat-beauty', name: 'Beauty', icon: '💄', color: '#f48fb1', type: 'expense' },
  { id: 'cat-sports', name: 'Sports', icon: '🏋️', color: '#26a69a', type: 'expense' },
  { id: 'cat-entertainment', name: 'Entertainment', icon: '🎮', color: '#7e57c2', type: 'expense' },
  { id: 'cat-hobby', name: 'Hobby', icon: '🎨', color: '#ff8a65', type: 'expense' },
  { id: 'cat-car-project', name: 'Car project', icon: '🛠️', color: '#8d6e63', type: 'expense' },
  { id: 'cat-shopping', name: 'Shopping', icon: '🛍️', color: '#26c6da', type: 'expense' },
  { id: 'cat-travel', name: 'Travel', icon: '✈️', color: '#29b6f6', type: 'expense' },
  { id: 'cat-pets', name: 'Pets', icon: '🐾', color: '#9ccc65', type: 'expense' },
  { id: 'cat-education', name: 'Education', icon: '📚', color: '#bcaaa4', type: 'expense' },
  { id: 'cat-gifts-expense', name: 'Gifts', icon: '🎁', color: '#ef5350', type: 'expense' },
  { id: 'cat-card-interest', name: 'Card interest and charges', icon: '💳', color: '#c62828', type: 'expense' },
  { id: 'cat-bank-fees', name: 'Bank fees', icon: '🏛️', color: '#90a4ae', type: 'expense' },
  { id: 'cat-recon-adjustment', name: 'Reconciliation adjustment', icon: '⚖️', color: '#9e9e9e', type: 'expense', system: true },
  // Added in 2.10.0 (fixed and variable ones the list was missing)
  { id: 'cat-electricity', name: 'Electricity', icon: '💡', color: '#fdd835', type: 'expense' },
  { id: 'cat-internet', name: 'Internet', icon: '🌐', color: '#29b6f6', type: 'expense' },
  { id: 'cat-utilities', name: 'Services', icon: '🚰', color: '#4db6ac', type: 'expense' },
  { id: 'cat-rent', name: 'Rent', icon: '🔑', color: '#8e24aa', type: 'expense' },
  { id: 'cat-obligations', name: 'Recurring obligations', icon: '📆', color: '#5c6bc0', type: 'expense' },
  { id: 'cat-delivery', name: 'Delivery', icon: '🛵', color: '#ff8f00', type: 'expense' },
  { id: 'cat-going-out', name: 'Going out', icon: '🍻', color: '#ab47bc', type: 'expense' },
  { id: 'cat-family', name: 'Family expenses', icon: '👨‍👩‍👧', color: '#ec407a', type: 'expense' },
  { id: 'cat-vehicle-maintenance', name: 'Vehicle maintenance', icon: '🔧', color: '#6d4c41', type: 'expense' },
  { id: 'cat-occasional', name: 'Occasional purchases', icon: '🛒', color: '#26c6da', type: 'expense' },
  // Business module (2.12.0): app-managed, hidden from the pickers; business movements are not personal spending
  { id: 'cat-working-capital', name: 'Working capital (inventory)', icon: '📦', color: '#8d6e63', type: 'expense', system: true },
  { id: 'cat-business-expense', name: 'Business operation expense', icon: '🧰', color: '#8d6e63', type: 'expense', system: true },
  { id: 'cat-other-expense', name: 'Other', icon: '📦', color: '#78909c', type: 'expense' },
  // Income categories
  { id: 'cat-salary', name: 'Salary', icon: '💼', color: '#22c55e', type: 'income' },
  { id: 'cat-freelance', name: 'Freelance', icon: '💻', color: '#00bfa5', type: 'income' },
  { id: 'cat-business', name: 'Business', icon: '🏢', color: '#66bb6a', type: 'income' },
  { id: 'cat-investments', name: 'Investments', icon: '📈', color: '#26a69a', type: 'income' },
  { id: 'cat-refunds', name: 'Refunds', icon: '↩️', color: '#29b6f6', type: 'income' },
  { id: 'cat-gifts', name: 'Gifts', icon: '🎁', color: '#f06292', type: 'income' },
  { id: 'cat-other-income', name: 'Other', icon: '💰', color: '#9ccc65', type: 'income' },
];

// Every built-in expense category carries its default nature (fixed ones are listed in domain/categories.ts)
export const DEFAULT_CATEGORIES_MOCK: CategoryModel[] = BASE_CATEGORIES.map((c) => (c.type === 'expense' ? { ...c, nature: DEFAULT_NATURE[c.id] ?? 'variable' } : c));
