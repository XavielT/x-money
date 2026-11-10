import { TransactionModel } from '../models/transaction.model';
import { round2, sumMoney } from '../utils/money';
import { isCounted } from './stats';

// A suggested monthly limit for a category: what the user spent in it, per month, over the last full months.
// It is only a suggestion (the screen shows it as editable and never saves it on its own). Pure.
//  - RD$ only: dollars are not converted with an invented rate, so they never enter the average.
//  - Only expenses the budgets count: transfers, card payments, loan principal, business movements and reversed ones are out.
//  - A month before the category's first expense does not count as a zero month (the user was not tracking it yet);
//    a month after it with nothing does count as zero.
//  - No history, or nothing in the window: null.
export interface BudgetSuggestion {
  amount: number;
  months: number; // how many months the average is over
}

type Tx = Pick<TransactionModel, 'type' | 'amount' | 'fee' | 'date' | 'categoryId' | 'subcategoryId' | 'currency' | 'status' | 'origin' | 'scope'>;

export function suggestBudgetLimit(transactions: readonly Tx[], categoryId: string, today: string, months = 3): BudgetSuggestion | null {
  const own = transactions.filter((t) => t.type === 'expense' && t.origin !== 'reversal' && isCounted(t) && (t.currency ?? 'DOP') === 'DOP' && (t.categoryId === categoryId || t.subcategoryId === categoryId));
  if (!own.length) return null;

  const [ty, tm] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const keyOf = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;
  const window: string[] = []; // oldest first
  for (let i = months; i >= 1; i--) {
    const index = ty * 12 + (tm - 1) - i;
    window.push(keyOf(Math.floor(index / 12), (index % 12) + 1));
  }

  const first = own.map((t) => t.date.slice(0, 7)).sort()[0];
  const counted = window.filter((k) => k >= first);
  if (!counted.length) return null;

  const perMonth = counted.map((k) => sumMoney(own.filter((t) => t.date.slice(0, 7) === k).map((t) => t.amount)));
  const total = sumMoney(perMonth);
  if (total <= 0) return null;
  return { amount: round2(total / counted.length), months: counted.length };
}
