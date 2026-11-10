import { describe, expect, it } from 'vitest';
import { transaction } from '../testing/builders';
import { suggestBudgetLimit } from './budget-suggestion';

// "today" is mid-November 2026: the last full months are Aug, Sep and Oct
const TODAY = '2026-11-09';
const spend = (date: string, amount: number, extra: Parameters<typeof transaction>[0] = {}) => transaction({ categoryId: 'food', date, amount, ...extra });

describe('suggestBudgetLimit', () => {
  it('no history for the category: nothing to suggest', () => {
    expect(suggestBudgetLimit([], 'food', TODAY)).toBeNull();
    expect(suggestBudgetLimit([spend('2026-10-05', 100, { categoryId: 'other' })], 'food', TODAY)).toBeNull();
  });

  it('one month of history: that month', () => {
    expect(suggestBudgetLimit([spend('2026-10-05', 300), spend('2026-10-20', 200.55)], 'food', TODAY)).toEqual({ amount: 500.55, months: 1 });
  });

  it('several months: the average over the months since the first expense, rounded to cents', () => {
    const txs = [spend('2026-08-10', 1000), spend('2026-09-10', 2000), spend('2026-10-10', 2000.01)];
    expect(suggestBudgetLimit(txs, 'food', TODAY)).toEqual({ amount: 1666.67, months: 3 });
  });

  it('a month with nothing after the first expense counts as zero; the months before it do not exist', () => {
    // first expense in September; October is empty: (900 + 0) / 2
    expect(suggestBudgetLimit([spend('2026-09-03', 900)], 'food', TODAY)).toEqual({ amount: 450, months: 2 });
    // August is before the first expense: not a zero month
    expect(suggestBudgetLimit([spend('2026-09-03', 900), spend('2026-10-03', 300)], 'food', TODAY)?.months).toBe(2);
  });

  it('the current month never enters; an older expense only says tracking had started, so the empty months after it count as zero', () => {
    const txs = [spend('2026-11-02', 9999), spend('2026-07-31', 9999), spend('2026-10-05', 100)];
    expect(suggestBudgetLimit(txs, 'food', TODAY)).toEqual({ amount: 33.33, months: 3 });
    expect(suggestBudgetLimit([spend('2026-11-02', 9999), spend('2026-10-05', 100)], 'food', TODAY)).toEqual({ amount: 100, months: 1 });
  });

  it('only history from before the window or from this month: nothing', () => {
    expect(suggestBudgetLimit([spend('2026-11-02', 100)], 'food', TODAY)).toBeNull();
    expect(suggestBudgetLimit([spend('2026-05-02', 100)], 'food', TODAY)).toBeNull(); // the window has no month after it began
  });

  it('dollars never mix in: only RD$ movements are averaged', () => {
    const txs = [spend('2026-10-05', 100), spend('2026-10-06', 5000, { currency: 'USD' })];
    expect(suggestBudgetLimit(txs, 'food', TODAY)).toEqual({ amount: 100, months: 1 });
    expect(suggestBudgetLimit([spend('2026-10-05', 80, { currency: 'USD' })], 'food', TODAY)).toBeNull();
  });

  it('ignores transfers, card payments, income, reversed movements, reversals and business movements', () => {
    const txs = [
      spend('2026-10-01', 100),
      spend('2026-10-02', 700, { type: 'transfer', toAccountId: 'x', origin: 'card-payment' }),
      spend('2026-10-03', 700, { type: 'income' }),
      spend('2026-10-04', 700, { status: 'reversed' }),
      spend('2026-10-05', 700, { origin: 'reversal' }),
      spend('2026-10-06', 700, { scope: 'business' }),
      spend('2026-10-07', 700, { origin: 'loan-principal' }),
    ];
    expect(suggestBudgetLimit(txs, 'food', TODAY)).toEqual({ amount: 100, months: 1 });
  });

  it('spending in a subcategory counts for that subcategory (the budget category) and a parent keeps its own', () => {
    const txs = [spend('2026-10-05', 100, { categoryId: 'food', subcategoryId: 'snacks' })];
    expect(suggestBudgetLimit(txs, 'snacks', TODAY)).toEqual({ amount: 100, months: 1 });
    expect(suggestBudgetLimit(txs, 'food', TODAY)).toEqual({ amount: 100, months: 1 });
  });

  it('crosses the year: in January the window is Oct, Nov, Dec of the year before', () => {
    const txs = [spend('2025-12-15', 300), spend('2025-10-15', 300)];
    expect(suggestBudgetLimit(txs, 'food', '2026-01-10')).toEqual({ amount: 200, months: 3 });
  });

  it('floating point never leaks: three 0.1 months average to 0.1', () => {
    const txs = [spend('2026-08-01', 0.1), spend('2026-09-01', 0.1), spend('2026-10-01', 0.1)];
    expect(suggestBudgetLimit(txs, 'food', TODAY)?.amount).toBe(0.1);
  });

  it('does not change its input', () => {
    const txs = [spend('2026-10-05', 100)];
    const copy = JSON.stringify(txs);
    suggestBudgetLimit(txs, 'food', TODAY);
    expect(JSON.stringify(txs)).toBe(copy);
  });
});
