import { Injectable, signal } from '@angular/core';
import { BudgetModel } from '../models/budget.model';
import { StorageService } from './storage.service';

@Injectable({ providedIn: 'root' })
export class BudgetService {
  private _budgets = signal<BudgetModel[]>([]);
  budgets = this._budgets.asReadonly();

  constructor(private storage: StorageService) {
    this._budgets.set(this.storage.get<BudgetModel[]>('budgets', []));
  }

  byCategoryId(categoryId: string): BudgetModel | undefined {
    return this._budgets().find((b) => b.categoryId === categoryId);
  }

  // One budget per category: creates it or updates the existing limit
  upsert(categoryId: string, monthlyLimit: number): void {
    const existing = this.byCategoryId(categoryId);
    if (existing) {
      this._budgets.update((list) =>
        list.map((b) => (b.id === existing.id ? { ...b, monthlyLimit } : b))
      );
    } else {
      const budget: BudgetModel = { id: crypto.randomUUID(), categoryId, monthlyLimit };
      this._budgets.update((list) => [...list, budget]);
    }
    this.persist();
  }

  remove(id: string): void {
    this._budgets.update((list) => list.filter((b) => b.id !== id));
    this.persist();
  }

  private persist(): void {
    this.storage.set('budgets', this._budgets());
  }
}
