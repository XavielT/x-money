import { Injectable, computed, signal } from '@angular/core';
import { TransactionModel, TransactionType } from '../models/transaction.model';
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

@Injectable({ providedIn: 'root' })
export class TransactionService {
  private _transactions = signal<TransactionModel[]>([]);
  transactions = this._transactions.asReadonly();

  // Newest first (by date, then insertion order)
  sorted = computed(() =>
    [...this._transactions()].sort((a, b) => b.date.localeCompare(a.date))
  );

  // Total balance across all accounts = initial balances + income − expenses.
  // Transfers move money between accounts, so they don't change the total.
  totalBalance = computed(() => {
    const initial = this.accountService
      .accounts()
      .reduce((sum, a) => sum + a.initialBalance, 0);
    return this._transactions().reduce((sum, t) => {
      if (t.type === 'income') return sum + t.amount;
      if (t.type === 'expense') return sum - t.amount;
      return sum;
    }, initial);
  });

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

  // Transactions of a given month (month is 1-12), newest first
  forMonth(year: number, month: number): TransactionModel[] {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    return this.sorted().filter((t) => t.date.startsWith(prefix));
  }

  monthSummary(year: number, month: number): MonthSummary {
    return this.forMonth(year, month).reduce(
      (acc, t) => {
        if (t.type === 'income') acc.income += t.amount;
        else if (t.type === 'expense') acc.expense += t.amount;
        return acc;
      },
      { income: 0, expense: 0 }
    );
  }

  // Totals per category for a month and type, biggest first (transfers excluded)
  categoryTotals(year: number, month: number, type: TransactionType): CategoryTotal[] {
    const totals = new Map<string, number>();
    for (const t of this.forMonth(year, month)) {
      if (t.type !== type || !t.categoryId) continue;
      totals.set(t.categoryId, (totals.get(t.categoryId) ?? 0) + t.amount);
    }
    return [...totals.entries()]
      .map(([categoryId, total]) => ({ categoryId, total }))
      .sort((a, b) => b.total - a.total);
  }

  accountBalance(accountId: string): number {
    const initial = this.accountService.byId(accountId)?.initialBalance ?? 0;
    return this._transactions().reduce((sum, t) => {
      if (t.type === 'transfer') {
        if (t.accountId === accountId) sum -= t.amount;
        if (t.toAccountId === accountId) sum += t.amount;
        return sum;
      }
      if (t.accountId !== accountId) return sum;
      return sum + (t.type === 'income' ? t.amount : -t.amount);
    }, initial);
  }

  private persist(): void {
    this.storage.set('transactions', this._transactions());
  }
}
