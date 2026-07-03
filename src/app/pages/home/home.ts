import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TransactionItem } from '../../../shared/components/transaction-item/transaction-item';
import { TransactionService } from '../../../shared/services/transaction.service';
import { CategoryService } from '../../../shared/services/category.service';
import { SettingsService } from '../../../shared/services/settings.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterLink, TransactionItem],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class HomeComponent {
  private today = new Date();
  year = this.today.getFullYear();
  month = this.today.getMonth() + 1;
  monthLabel = this.today.toLocaleString('en-US', { month: 'long' });

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

  hasTransactions = computed(() => this.transactionService.transactions().length > 0);

  abs(value: number): number {
    return Math.abs(value);
  }

  constructor(
    public transactionService: TransactionService,
    public categoryService: CategoryService,
    public settings: SettingsService
  ) {}
}
