import { CategoryModel } from '../models/category.model';

export const DEFAULT_CATEGORIES_MOCK: CategoryModel[] = [
  // Expense categories
  { id: 'cat-food', name: 'Food', icon: '🍔', color: '#ff7043', type: 'expense' },
  { id: 'cat-groceries', name: 'Groceries', icon: '🛒', color: '#66bb6a', type: 'expense' },
  { id: 'cat-transport', name: 'Transport', icon: '🚗', color: '#42a5f5', type: 'expense' },
  { id: 'cat-home', name: 'Home', icon: '🏠', color: '#ab47bc', type: 'expense' },
  { id: 'cat-bills', name: 'Bills', icon: '🧾', color: '#ffca28', type: 'expense' },
  { id: 'cat-health', name: 'Health', icon: '💊', color: '#ec407a', type: 'expense' },
  { id: 'cat-entertainment', name: 'Entertainment', icon: '🎮', color: '#7e57c2', type: 'expense' },
  { id: 'cat-shopping', name: 'Shopping', icon: '🛍️', color: '#26c6da', type: 'expense' },
  { id: 'cat-education', name: 'Education', icon: '📚', color: '#8d6e63', type: 'expense' },
  { id: 'cat-other-expense', name: 'Other', icon: '📦', color: '#78909c', type: 'expense' },
  // Income categories
  { id: 'cat-salary', name: 'Salary', icon: '💼', color: '#22c55e', type: 'income' },
  { id: 'cat-freelance', name: 'Freelance', icon: '💻', color: '#00bfa5', type: 'income' },
  { id: 'cat-gifts', name: 'Gifts', icon: '🎁', color: '#f06292', type: 'income' },
  { id: 'cat-other-income', name: 'Other', icon: '💰', color: '#9ccc65', type: 'income' },
];
