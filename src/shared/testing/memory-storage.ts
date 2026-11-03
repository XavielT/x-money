import { TestBed } from '@angular/core/testing';
import { StorageService } from '../services/storage.service';
import { AccountService } from '../services/account.service';
import { BudgetService } from '../services/budget.service';
import { CategoryService } from '../services/category.service';
import { RecurringService } from '../services/recurring.service';
import { SettingsService } from '../services/settings.service';
import { TransactionService } from '../services/transaction.service';

// In-memory stand-in for StorageService: same get/set/remove/clearAll contract,
// no localStorage and no Capacitor. `failOnSet` simulates a full disk/quota
// error for the given keys.
export class MemoryStorage {
  data = new Map<string, string>();
  failOnSet = new Set<string>();

  get<T>(key: string, fallback: T): T {
    const raw = this.data.get(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  }

  set<T>(key: string, value: T): void {
    if (this.failOnSet.has(key)) throw new Error(`QuotaExceeded: ${key}`);
    this.data.set(key, JSON.stringify(value));
  }

  remove(key: string): void {
    this.data.delete(key);
  }

  clearAll(): void {
    this.data.clear();
  }

  refresh(): void {
    /* no watchers in the memory stub */
  }

  watch(): () => void {
    return () => undefined;
  }

  seed(values: Record<string, unknown>): this {
    for (const [key, value] of Object.entries(values)) this.data.set(key, JSON.stringify(value));
    return this;
  }
}

// Starts a fresh "app session" on top of the given storage: new service
// instances that read whatever the previous session persisted. Recurring
// catch-up runs when RecurringService is first injected.
export function boot<S extends object = MemoryStorage>(storage: S = new MemoryStorage() as unknown as S) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: StorageService, useValue: storage as unknown as StorageService }],
  });
  return {
    storage,
    accounts: TestBed.inject(AccountService),
    categories: TestBed.inject(CategoryService),
    transactions: TestBed.inject(TransactionService),
    budgets: TestBed.inject(BudgetService),
    settings: TestBed.inject(SettingsService),
    // injected last: its constructor posts due occurrences
    recurring: TestBed.inject(RecurringService),
  };
}
