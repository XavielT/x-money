import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TransactionType } from '../../../shared/models/transaction.model';
import { CategoryModel } from '../../../shared/models/category.model';
import { TransactionService } from '../../../shared/services/transaction.service';
import { CategoryService } from '../../../shared/services/category.service';
import { SettingsService } from '../../../shared/services/settings.service';

interface StatSlice {
  category: CategoryModel | undefined;
  total: number;
  percent: number; // 0-100, of the grand total
  dasharray: string;
  dashoffset: number;
}

@Component({
  selector: 'app-stats',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './stats.html',
  styleUrl: './stats.scss',
})
export class StatsComponent {
  private now = new Date();
  year = signal(this.now.getFullYear());
  month = signal(this.now.getMonth() + 1);
  type = signal<TransactionType>('expense');

  monthLabel = computed(() =>
    new Date(this.year(), this.month() - 1, 1).toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
    })
  );

  grandTotal = computed(() =>
    this.transactionService
      .categoryTotals(this.year(), this.month(), this.type())
      .reduce((sum, t) => sum + t.total, 0)
  );

  // Donut slices: circle r=15.9155 → circumference = 100, so percents map directly
  slices = computed<StatSlice[]>(() => {
    const totals = this.transactionService.categoryTotals(this.year(), this.month(), this.type());
    const grand = totals.reduce((sum, t) => sum + t.total, 0);
    if (!grand) return [];

    let consumed = 0;
    return totals.map((t) => {
      const percent = (t.total / grand) * 100;
      const slice: StatSlice = {
        category: this.categoryService.byId(t.categoryId),
        total: t.total,
        percent: Math.round(percent),
        dasharray: `${percent} ${100 - percent}`,
        dashoffset: 25 - consumed, // 25 starts the ring at 12 o'clock
      };
      consumed += percent;
      return slice;
    });
  });

  constructor(
    public transactionService: TransactionService,
    public categoryService: CategoryService,
    public settings: SettingsService
  ) {}

  setType(type: TransactionType): void {
    this.type.set(type);
  }

  prevMonth(): void {
    if (this.month() === 1) {
      this.month.set(12);
      this.year.update((y) => y - 1);
    } else {
      this.month.update((m) => m - 1);
    }
  }

  nextMonth(): void {
    if (this.month() === 12) {
      this.month.set(1);
      this.year.update((y) => y + 1);
    } else {
      this.month.update((m) => m + 1);
    }
  }
}
