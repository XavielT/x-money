import { Injectable, signal } from '@angular/core';
import { RecurringFrequency, RecurringModel } from '../models/recurring.model';
import { StorageService } from './storage.service';
import { TransactionService } from './transaction.service';
import { AuditLogService } from './audit-log.service';
import { AccountService } from './account.service';
import { advanceDate, anchorDayOf } from '../domain/fixed';

@Injectable({ providedIn: 'root' })
export class RecurringService {
  private _recurring = signal<RecurringModel[]>([]);
  recurring = this._recurring.asReadonly();

  constructor(
    private storage: StorageService,
    private transactionService: TransactionService,
    private audit: AuditLogService,
    private accountService: AccountService
  ) {
    this._recurring.set(this.storage.get<RecurringModel[]>('recurring', []));
    this.storage.watch('recurring', (v) => this._recurring.set((v as RecurringModel[] | undefined) ?? []));
    this.processDue();
  }

  // Posts every occurrence that is due (nextDate <= today) as a real transaction
  // and advances nextDate. Called on app start and after adding a rule.
  processDue(): void {
    const today = this.todayIso();
    let changed = false;
    let posted = 0;

    const updated = this._recurring().map((rule) => {
      if (!rule.active) return rule;
      let next = rule.nextDate;
      let guard = 0; // safety cap if the phone was off for very long
      while (next <= today && guard < 500) {
        const result = this.transactionService.add({
          id: `rec-${rule.id}-${next}`,
          type: rule.type,
          amount: rule.amount,
          categoryId: rule.categoryId,
          subcategoryId: rule.subcategoryId,
          nature: rule.nature,
          accountId: rule.accountId,
          toAccountId: rule.toAccountId,
          // rules created before 2.7.0 have no currency: a US$ account posts in US$
          currency: rule.currency ?? (this.accountService.byId(rule.accountId)?.currency === 'USD' ? 'USD' : undefined),
          fee: rule.fee,
          date: next,
          note: rule.note,
          origin: 'recurring',
          incomeSourceId: rule.type === 'income' ? rule.incomeSourceId : undefined,
        });
        // the account is gone or archived (or the rule is invalid): do not post and do not
        // advance, the occurrence waits until the rule is fixed
        if (!result.ok) break;
        posted++;
        next = advanceDate(next, rule.frequency, anchorDayOf(rule));
        changed = true;
        guard++;
      }
      return next === rule.nextDate ? rule : { ...rule, nextDate: next };
    });

    if (changed) {
      this._recurring.set(updated);
      this.persist();
    }
    if (posted > 0) {
      this.audit.log({ type: 'recurring-post', entity: 'transaction', entityId: 'recurring', after: { posted }, origin: 'recurring' });
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

  // Links an income rule to a source (or unlinks it). The rule itself is not touched otherwise.
  setIncomeSource(id: string, sourceId: string | undefined): void {
    this._recurring.update((list) => list.map((r) => (r.id === id && r.type === 'income' ? { ...r, incomeSourceId: sourceId } : r)));
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
