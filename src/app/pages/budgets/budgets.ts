import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CategoryModel } from '../../../shared/models/category.model';
import { BudgetModel } from '../../../shared/models/budget.model';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { BudgetService } from '../../../shared/services/budget.service';
import { CategoryService } from '../../../shared/services/category.service';
import { TransactionService } from '../../../shared/services/transaction.service';
import { SettingsService } from '../../../shared/services/settings.service';
import { BudgetRisk } from '../../../shared/domain/budget';
import { RouterLink } from '@angular/router';
import { TranslateService } from '../../../shared/services/translate.service';

interface BudgetRow {
  budget: BudgetModel;
  category: CategoryModel | undefined;
  spent: number;
  limit: number; // the monthly limit with what moved in or out this month
  risk: BudgetRisk;
  percent: number; // capped at 100 for the bar width
  status: 'ok' | 'warn' | 'over';
}

@Component({
  selector: 'app-budgets',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe],
  templateUrl: './budgets.html',
  styleUrl: './budgets.scss',
})
export class BudgetsComponent {
  private now = new Date();
  year = this.now.getFullYear();
  month = this.now.getMonth() + 1;
  monthLabel = '';

  // New/updated budget form
  selectedCategoryId = '';
  limit: number | null = null;

  rows = computed<BudgetRow[]>(() =>
    this.budgetService.categoryRows(this.year, this.month).map(({ budget, limit, spent, risk }) => {
      const ratio = limit > 0 ? spent / limit : 0;
      return {
        budget,
        category: this.categoryService.byId(budget.categoryId),
        spent,
        limit,
        risk,
        percent: Math.min(100, Math.round(ratio * 100)),
        status: ratio >= 1 ? 'over' : ratio >= 0.7 ? 'warn' : 'ok',
      };
    })
  );

  // Categories and their subcategories, to set a limit on either
  categoryOptions = computed(() =>
    this.categoryService.expenseCategories().flatMap((c) => [{ id: c.id, label: `${c.icon} ${c.name}` }, ...this.categoryService.children(c.id).map((s) => ({ id: s.id, label: `   ↳ ${s.icon} ${s.name}` }))])
  );

  // "At this pace you reach RD$X on day Y" (an estimate)
  riskText(row: BudgetRow): string {
    const r = row.risk;
    const amount = `${this.settings.currency()}${Math.round(r.projected).toLocaleString('en-US')}`;
    if (r.hitDate) return this.translate.instant('At this pace you reach the limit on {date} and end the month at {amount} (estimate)', { date: r.hitDate, amount });
    return this.translate.instant('At this pace you end the month at {amount} (estimate)', { amount });
  }

  constructor(
    private translate: TranslateService,
    public budgetService: BudgetService,
    public categoryService: CategoryService,
    public transactionService: TransactionService,
    public settings: SettingsService
  ) {
    this.monthLabel = this.now.toLocaleString(this.translate.locale(), {
      month: 'long',
      year: 'numeric',
    });
  }

  saveBudget(): void {
    if (!this.selectedCategoryId || this.limit == null || this.limit <= 0) return;
    this.budgetService.upsert(this.selectedCategoryId, Number(this.limit));
    this.selectedCategoryId = '';
    this.limit = null;
  }

  removeBudget(id: string): void {
    if (!confirm(this.translate.instant('Remove this budget?'))) return;
    this.budgetService.remove(id);
  }
}
