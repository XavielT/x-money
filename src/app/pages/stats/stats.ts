import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TransactionType } from '../../../shared/models/transaction.model';
import { CategoryModel } from '../../../shared/models/category.model';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { TransactionService } from '../../../shared/services/transaction.service';
import { CategoryService } from '../../../shared/services/category.service';
import { AccountService } from '../../../shared/services/account.service';
import { SettingsService } from '../../../shared/services/settings.service';
import { InsightsService } from '../../../shared/services/insights.service';
import { TranslateService } from '../../../shared/services/translate.service';

interface StatSlice {
  category: CategoryModel | undefined;
  total: number;
  percent: number; // 0-100, of the grand total
  dasharray: string;
  dashoffset: number;
}

interface TrendMonth {
  label: string;
  income: number;
  expense: number;
  incomeHeight: number; // 0-100
  expenseHeight: number; // 0-100
}

@Component({
  selector: 'app-stats',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './stats.html',
  styleUrl: './stats.scss',
})
export class StatsComponent {
  private now = new Date();
  year = signal(this.now.getFullYear());
  month = signal(this.now.getMonth() + 1);
  type = signal<TransactionType>('expense');
  mode = signal<'month' | 'year'>('month');
  accountFilter = signal('');

  periodLabel = computed(() =>
    this.mode() === 'year'
      ? String(this.year())
      : new Date(this.year(), this.month() - 1, 1).toLocaleString(this.translate.locale(), {
          month: 'long',
          year: 'numeric',
        })
  );

  // Transactions of the selected period, restricted to the account filter.
  // Purchases with a linked debit card count for its bank account too.
  private periodTransactions = computed(() => {
    const txs =
      this.mode() === 'year'
        ? this.transactionService.forYear(this.year())
        : this.transactionService.forMonth(this.year(), this.month());
    const filter = this.accountFilter();
    if (!filter) return txs;
    return txs.filter(
      (t) =>
        t.accountId === filter || this.accountService.effectiveOwnerId(t.accountId) === filter
    );
  });

  private periodTotals = computed(() => {
    const totals = new Map<string, number>();
    for (const t of this.periodTransactions()) {
      if (t.type !== this.type() || !t.categoryId) continue;
      if (this.transactionService.currencyOf(t) !== 'DOP') continue;
      totals.set(t.categoryId, (totals.get(t.categoryId) ?? 0) + t.amount);
    }
    return [...totals.entries()]
      .map(([categoryId, total]) => ({ categoryId, total }))
      .sort((a, b) => b.total - a.total);
  });

  grandTotal = computed(() => this.periodTotals().reduce((sum, t) => sum + t.total, 0));

  // Donut slices: circle r=15.9155 → circumference = 100, so percents map directly
  slices = computed<StatSlice[]>(() => {
    const totals = this.periodTotals();
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

  // Income vs expense for the last 6 months, bar heights scaled to the max
  trends = computed<TrendMonth[]>(() => {
    const months: TrendMonth[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(this.now.getFullYear(), this.now.getMonth() - i, 1);
      const summary = this.transactionService.monthSummary(d.getFullYear(), d.getMonth() + 1);
      months.push({
        label: d.toLocaleString(this.translate.locale(), { month: 'short' }),
        income: summary.income,
        expense: summary.expense,
        incomeHeight: 0,
        expenseHeight: 0,
      });
    }
    const max = Math.max(...months.map((m) => Math.max(m.income, m.expense)), 1);
    return months.map((m) => ({
      ...m,
      incomeHeight: Math.round((m.income / max) * 100),
      expenseHeight: Math.round((m.expense / max) * 100),
    }));
  });

  hasTrendData = computed(() => this.trends().some((m) => m.income > 0 || m.expense > 0));

  // Yearly report: every month of the selected year + totals
  yearReport = computed(() => {
    const months: TrendMonth[] = [];
    for (let m = 1; m <= 12; m++) {
      const summary = this.transactionService.monthSummary(this.year(), m);
      months.push({
        label: new Date(this.year(), m - 1, 1)
          .toLocaleString(this.translate.locale(), { month: 'short' })
          .slice(0, 3),
        income: summary.income,
        expense: summary.expense,
        incomeHeight: 0,
        expenseHeight: 0,
      });
    }
    const max = Math.max(...months.map((m) => Math.max(m.income, m.expense)), 1);
    const totals = this.transactionService.yearSummary(this.year());
    return {
      months: months.map((m) => ({
        ...m,
        incomeHeight: Math.round((m.income / max) * 100),
        expenseHeight: Math.round((m.expense / max) * 100),
      })),
      income: totals.income,
      expense: totals.expense,
      net: totals.income - totals.expense,
      monthlyAvg: totals.expense / 12,
    };
  });

  // Awareness insights for the current month
  antExpenses = computed(() =>
    this.insights.antExpenses(this.now.getFullYear(), this.now.getMonth() + 1)
  );
  subscriptions = computed(() => this.insights.subscriptionCost());
  momChange = computed(() =>
    this.insights.momChange(this.now.getFullYear(), this.now.getMonth() + 1)
  );

  constructor(
    private translate: TranslateService,
    private insights: InsightsService,
    public transactionService: TransactionService,
    public categoryService: CategoryService,
    public accountService: AccountService,
    public settings: SettingsService
  ) {}

  abs(value: number): number {
    return Math.abs(value);
  }

  setType(type: TransactionType): void {
    this.type.set(type);
  }

  setMode(mode: 'month' | 'year'): void {
    this.mode.set(mode);
  }

  prev(): void {
    if (this.mode() === 'year') {
      this.year.update((y) => y - 1);
      return;
    }
    if (this.month() === 1) {
      this.month.set(12);
      this.year.update((y) => y - 1);
    } else {
      this.month.update((m) => m - 1);
    }
  }

  next(): void {
    if (this.mode() === 'year') {
      this.year.update((y) => y + 1);
      return;
    }
    if (this.month() === 12) {
      this.month.set(1);
      this.year.update((y) => y + 1);
    } else {
      this.month.update((m) => m + 1);
    }
  }
}
