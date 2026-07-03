import { CategoryModel } from '../models/category.model';

// Default set based on the common categories of Monefy / Spendee / Money Manager
export const DEFAULT_CATEGORIES_MOCK: CategoryModel[] = [
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
