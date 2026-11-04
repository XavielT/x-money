import { Injectable, computed } from '@angular/core';
import { RecurringModel } from '../models/recurring.model';
import { natureOfCategory } from '../domain/categories';
import { FixedSummary, fixedSummary, monthlyEquivalent } from '../domain/fixed';
import { lastDayOfMonth, localIso } from '../domain/dates';
import { AccountService } from './account.service';
import { CategoryService } from './category.service';
import { RecurringService } from './recurring.service';
import { TransactionService } from './transaction.service';

export interface Obligation {
  rule: RecurringModel;
  categoryId: string | undefined;
  monthly: number; // estimated monthly cost
  next: string; // next due date
}

// Fixed expenses = the active recurring EXPENSE rules whose nature is fixed. A rule suggests
// "fixed" when it is created (a recurring expense usually is) but the user decides: the rule's own
// nature wins, then its category's (rule 8: the nature is never inferred from repetition).
@Injectable({ providedIn: 'root' })
export class FixedExpenseService {
  constructor(
    private recurring: RecurringService,
    private categories: CategoryService,
    private accounts: AccountService,
    private transactions: TransactionService
  ) {}

  natureOf(rule: RecurringModel) {
    return rule.nature ?? natureOfCategory(rule.categoryId ? this.categories.byId(rule.categoryId) : undefined);
  }

  // RD$ only, like every statistic
  private isDop(rule: RecurringModel): boolean {
    return (rule.currency ?? (this.accounts.byId(rule.accountId)?.currency === 'USD' ? 'USD' : 'DOP')) === 'DOP';
  }

  rules = computed(() => this.recurring.recurring().filter((r) => r.active && r.type === 'expense' && this.natureOf(r) === 'fixed' && this.isDop(r)));

  obligations = computed<Obligation[]>(() =>
    this.rules()
      .map((rule) => ({ rule, categoryId: rule.categoryId, monthly: monthlyEquivalent(rule), next: rule.nextDate }))
      .sort((a, b) => a.next.localeCompare(b.next))
  );

  summary = computed<FixedSummary>(() => {
    const today = localIso(this.transactions.clock());
    const monthEnd = `${today.slice(0, 7)}-${String(lastDayOfMonth(Number(today.slice(0, 4)), Number(today.slice(5, 7)))).padStart(2, '0')}`;
    return fixedSummary(this.rules(), monthEnd);
  });
}
