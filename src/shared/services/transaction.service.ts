import { Injectable, computed, signal } from '@angular/core';
import {
  TransactionCurrency,
  TransactionModel,
  TransactionType,
} from '../models/transaction.model';
import { StorageService } from './storage.service';
import { AccountService } from './account.service';

export interface MonthSummary {
  income: number;
  expense: number;
}

export interface CategoryTotal {
  categoryId: string;
  total: number;
}

// All summaries, stats and budgets work in the primary currency (DOP / the
// symbol chosen in Settings). USD movements only affect USD balances.
@Injectable({ providedIn: 'root' })
export class TransactionService {
  private _transactions = signal<TransactionModel[]>([]);
  transactions = this._transactions.asReadonly();

  // Newest first (by date, then insertion order)
  sorted = computed(() =>
    [...this._transactions()].sort((a, b) => b.date.localeCompare(a.date))
  );

  // Primary-currency balance across all accounts (transfers net out)
  totalBalance = computed(() => this.totalBalanceIn('DOP'));

  // US dollar balance across all accounts (0 when the user never uses USD)
  totalBalanceUsd = computed(() => this.totalBalanceIn('USD'));

  constructor(
    private storage: StorageService,
    private accountService: AccountService
  ) {
    this._transactions.set(this.storage.get<TransactionModel[]>('transactions', []));
  }

  byId(id: string): TransactionModel | undefined {
    return this._transactions().find((t) => t.id === id);
  }

  add(data: Omit<TransactionModel, 'id'>): void {
    const transaction: TransactionModel = { ...data, id: crypto.randomUUID() };
    this._transactions.update((list) => [transaction, ...list]);
    this.persist();
  }

  update(transaction: TransactionModel): void {
    this._transactions.update((list) =>
      list.map((t) => (t.id === transaction.id ? transaction : t))
    );
    this.persist();
  }

  remove(id: string): void {
    this._transactions.update((list) => list.filter((t) => t.id !== id));
    this.persist();
  }

  currencyOf(t: TransactionModel): TransactionCurrency {
    return t.currency ?? 'DOP';
  }

  // Transactions of a given month (month is 1-12), newest first
  forMonth(year: number, month: number): TransactionModel[] {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    return this.sorted().filter((t) => t.date.startsWith(prefix));
  }

  forYear(year: number): TransactionModel[] {
    const prefix = `${year}-`;
    return this.sorted().filter((t) => t.date.startsWith(prefix));
  }

  monthSummary(year: number, month: number): MonthSummary {
    return this.summarize(this.forMonth(year, month));
  }

  yearSummary(year: number): MonthSummary {
    return this.summarize(this.forYear(year));
  }

  // Totals per category, biggest first (primary currency, transfers excluded)
  categoryTotals(year: number, month: number, type: TransactionType): CategoryTotal[] {
    return this.totalsByCategory(this.forMonth(year, month), type);
  }

  categoryTotalsForYear(year: number, type: TransactionType): CategoryTotal[] {
    return this.totalsByCategory(this.forYear(year), type);
  }

  // Balance of one account in one currency. Transactions made with a linked
  // debit card count against the bank account the card is connected to.
  accountBalance(accountId: string, currency: TransactionCurrency = 'DOP'): number {
    const account = this.accountService.byId(accountId);
    const initialCurrency = account?.currency === 'USD' ? 'USD' : 'DOP';
    const initial = initialCurrency === currency ? account?.initialBalance ?? 0 : 0;

    return this._transactions().reduce((sum, t) => {
      if (this.currencyOf(t) !== currency) return sum;
      const from = this.accountService.effectiveOwnerId(t.accountId);
      // Bank fee/tax always leaves the source account
      if (from === accountId) sum -= t.fee ?? 0;
      if (t.type === 'transfer') {
        const to = t.toAccountId ? this.accountService.effectiveOwnerId(t.toAccountId) : undefined;
        if (from === accountId) sum -= t.amount;
        if (to === accountId) sum += t.amount;
        return sum;
      }
      if (from !== accountId) return sum;
      return sum + (t.type === 'income' ? t.amount : -t.amount);
    }, initial);
  }

  private totalBalanceIn(currency: TransactionCurrency): number {
    const initial = this.accountService.accounts().reduce((sum, a) => {
      const accountCurrency = a.currency === 'USD' ? 'USD' : 'DOP';
      return accountCurrency === currency ? sum + a.initialBalance : sum;
    }, 0);
    return this._transactions().reduce((sum, t) => {
      if (this.currencyOf(t) !== currency) return sum;
      sum -= t.fee ?? 0; // fees leave the money pool regardless of type
      if (t.type === 'income') return sum + t.amount;
      if (t.type === 'expense') return sum - t.amount;
      return sum;
    }, initial);
  }

  private summarize(transactions: TransactionModel[]): MonthSummary {
    return transactions.reduce(
      (acc, t) => {
        if (this.currencyOf(t) !== 'DOP') return acc;
        acc.expense += t.fee ?? 0; // bank fees are spent money
        if (t.type === 'income') acc.income += t.amount;
        else if (t.type === 'expense') acc.expense += t.amount;
        return acc;
      },
      { income: 0, expense: 0 }
    );
  }

  private totalsByCategory(
    transactions: TransactionModel[],
    type: TransactionType
  ): CategoryTotal[] {
    const totals = new Map<string, number>();
    for (const t of transactions) {
      if (this.currencyOf(t) !== 'DOP') continue;
      // Fees of every movement pile up under the Bank fees category
      if (type === 'expense' && t.fee) {
        totals.set('cat-bank-fees', (totals.get('cat-bank-fees') ?? 0) + t.fee);
      }
      if (t.type !== type || !t.categoryId) continue;
      totals.set(t.categoryId, (totals.get(t.categoryId) ?? 0) + t.amount);
    }
    return [...totals.entries()]
      .map(([categoryId, total]) => ({ categoryId, total }))
      .sort((a, b) => b.total - a.total);
  }

  private persist(): void {
    this.storage.set('transactions', this._transactions());
  }
}
