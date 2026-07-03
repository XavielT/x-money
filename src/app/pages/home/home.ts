import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TransactionItem } from '../../../shared/components/transaction-item/transaction-item';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { TransactionService } from '../../../shared/services/transaction.service';
import { CategoryService } from '../../../shared/services/category.service';
import { SettingsService } from '../../../shared/services/settings.service';
import { BudgetService } from '../../../shared/services/budget.service';
import { TranslateService } from '../../../shared/services/translate.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterLink, TransactionItem, TranslatePipe],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class HomeComponent {
  private today = new Date();
  year = this.today.getFullYear();
  month = this.today.getMonth() + 1;
  monthLabel = '';

  summary = computed(() => this.transactionService.monthSummary(this.year, this.month));

  recent = computed(() => this.transactionService.sorted().slice(0, 5));

  // Top expense categories of the month, bars scaled to the biggest one
  topCategories = computed(() => {
    const totals = this.transactionService.categoryTotals(this.year, this.month, 'expense');
    const max = totals[0]?.total ?? 0;
    return totals.slice(0, 4).map((t) => ({
      category: this.categoryService.byId(t.categoryId),
      total: t.total,
      percent: max ? Math.round((t.total / max) * 100) : 0,
    }));
  });

  // Budgets at 90%+ of their monthly limit
  budgetAlerts = computed(() =>
    this.budgetService
      .budgets()
      .map((budget) => {
        const spent = this.transactionService
          .forMonth(this.year, this.month)
          .filter((t) => t.type === 'expense' && t.categoryId === budget.categoryId)
          .reduce((sum, t) => sum + t.amount, 0);
        const percent = budget.monthlyLimit > 0 ? Math.round((spent / budget.monthlyLimit) * 100) : 0;
        return {
          category: this.categoryService.byId(budget.categoryId),
          percent,
          over: percent >= 100,
        };
      })
      .filter((alert) => alert.percent >= 90)
  );

  hasTransactions = computed(() => this.transactionService.transactions().length > 0);

  constructor(
    private budgetService: BudgetService,
    private translate: TranslateService,
    public transactionService: TransactionService,
    public categoryService: CategoryService,
    public settings: SettingsService
  ) {
    this.monthLabel = this.today.toLocaleString(this.translate.locale(), { month: 'long' });
  }

  abs(value: number): number {
    return Math.abs(value);
  }
}
