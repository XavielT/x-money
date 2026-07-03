import { Injectable, signal } from '@angular/core';
import { RecurringFrequency, RecurringModel } from '../models/recurring.model';
import { StorageService } from './storage.service';
import { TransactionService } from './transaction.service';

@Injectable({ providedIn: 'root' })
export class RecurringService {
  private _recurring = signal<RecurringModel[]>([]);
  recurring = this._recurring.asReadonly();

  constructor(
    private storage: StorageService,
    private transactionService: TransactionService
  ) {
    this._recurring.set(this.storage.get<RecurringModel[]>('recurring', []));
    this.processDue();
  }

  // Posts every occurrence that is due (nextDate <= today) as a real transaction
  // and advances nextDate. Called on app start and after adding a rule.
  processDue(): void {
    const today = this.todayIso();
    let changed = false;

    const updated = this._recurring().map((rule) => {
      if (!rule.active) return rule;
      let next = rule.nextDate;
      let guard = 0; // safety cap if the phone was off for very long
      while (next <= today && guard < 500) {
        this.transactionService.add({
          type: rule.type,
          amount: rule.amount,
          categoryId: rule.categoryId,
          accountId: rule.accountId,
          toAccountId: rule.toAccountId,
          date: next,
          note: rule.note,
        });
        next = this.advance(next, rule.frequency, this.anchorDay(rule));
        changed = true;
        guard++;
      }
      return next === rule.nextDate ? rule : { ...rule, nextDate: next };
    });

    if (changed) {
      this._recurring.set(updated);
      this.persist();
    }
  }

  add(data: Omit<RecurringModel, 'id' | 'nextDate' | 'active'>): void {
    const rule: RecurringModel = {
      ...data,
      id: crypto.randomUUID(),
      nextDate: data.startDate,
      active: true,
    };
    this._recurring.update((list) => [...list, rule]);
    this.persist();
    this.processDue();
  }

  // Edit amount and/or frequency of an existing rule
  update(id: string, amount: number, frequency: RecurringFrequency): void {
    this._recurring.update((list) =>
      list.map((r) => (r.id === id ? { ...r, amount, frequency } : r))
    );
    this.persist();
  }

  toggleActive(id: string): void {
    this._recurring.update((list) =>
      list.map((r) => (r.id === id ? { ...r, active: !r.active } : r))
    );
    this.persist();
    this.processDue(); // resuming catches up missed occurrences from nextDate
  }

  remove(id: string): void {
    this._recurring.update((list) => list.filter((r) => r.id !== id));
    this.persist();
  }

  // Day of month of the first occurrence, so "every 31st" clamps in short
  // months (Feb -> 28) but returns to 31 afterwards
  private anchorDay(rule: RecurringModel): number {
    return Number(rule.startDate.split('-')[2]);
  }

  private advance(date: string, frequency: RecurringFrequency, anchorDay: number): string {
    const [y, m, d] = date.split('-').map(Number);
    let next: Date;
    switch (frequency) {
      case 'daily':
        next = new Date(y, m - 1, d + 1);
        break;
      case 'weekly':
        next = new Date(y, m - 1, d + 7);
        break;
      case 'monthly': {
        const lastDay = new Date(y, m + 1, 0).getDate(); // last day of following month
        next = new Date(y, m, Math.min(anchorDay, lastDay));
        break;
      }
      case 'yearly': {
        const lastDay = new Date(y + 1, m, 0).getDate();
        next = new Date(y + 1, m - 1, Math.min(anchorDay, lastDay));
        break;
      }
    }
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(
      next.getDate()
    ).padStart(2, '0')}`;
  }

  private todayIso(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;
  }

  private persist(): void {
    this.storage.set('recurring', this._recurring());
  }
}
