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
import { TranslateService } from '../../../shared/services/translate.service';

interface BudgetRow {
  budget: BudgetModel;
  category: CategoryModel | undefined;
  spent: number;
  percent: number; // capped at 100 for the bar width
  status: 'ok' | 'warn' | 'over';
}

@Component({
  selector: 'app-budgets',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
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
    this.budgetService.budgets().map((budget) => {
      const spent = this.transactionService
        .forMonth(this.year, this.month)
        .filter((t) => t.type === 'expense' && t.categoryId === budget.categoryId)
        .reduce((sum, t) => sum + t.amount, 0);
      const ratio = budget.monthlyLimit > 0 ? spent / budget.monthlyLimit : 0;
      return {
        budget,
        category: this.categoryService.byId(budget.categoryId),
        spent,
        percent: Math.min(100, Math.round(ratio * 100)),
        status: ratio >= 1 ? 'over' : ratio >= 0.7 ? 'warn' : 'ok',
      };
    })
  );

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
