import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TransactionModel } from '../../../shared/models/transaction.model';
import { TransactionItem } from '../../../shared/components/transaction-item/transaction-item';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { TransactionService } from '../../../shared/services/transaction.service';
import { SettingsService } from '../../../shared/services/settings.service';
import { CategoryService } from '../../../shared/services/category.service';
import { AccountService } from '../../../shared/services/account.service';
import { TranslateService } from '../../../shared/services/translate.service';

interface DayGroup {
  date: string;
  label: string;
  total: number;
  items: TransactionModel[];
}

@Component({
  selector: 'app-transactions',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TransactionItem, TranslatePipe],
  templateUrl: './transactions.html',
  styleUrl: './transactions.scss',
})
export class TransactionsComponent {
  private now = new Date();
  year = signal(this.now.getFullYear());
  month = signal(this.now.getMonth() + 1); // 1-12

  // Filters (signals so the groups computed reacts in zoneless mode)
  searchText = signal('');
  filterCategoryId = signal('');
  filterAccountId = signal('');

  monthLabel = computed(() =>
    new Date(this.year(), this.month() - 1, 1).toLocaleString(this.translate.locale(), {
      month: 'long',
      year: 'numeric',
    })
  );

  summary = computed(() => this.transactionService.monthSummary(this.year(), this.month()));

  net = computed(() => this.summary().income - this.summary().expense);

  filtered = computed(() => {
    const text = this.searchText().trim().toLowerCase();
    const categoryId = this.filterCategoryId();
    const accountId = this.filterAccountId();
    return this.transactionService.forMonth(this.year(), this.month()).filter((t) => {
      if (categoryId && t.categoryId !== categoryId) return false;
      if (accountId && t.accountId !== accountId && t.toAccountId !== accountId) return false;
      if (text) {
        const categoryName = t.categoryId
          ? this.categoryService.byId(t.categoryId)?.name.toLowerCase() ?? ''
          : '';
        const note = t.note?.toLowerCase() ?? '';
        if (!categoryName.includes(text) && !note.includes(text)) return false;
      }
      return true;
    });
  });

  groups = computed<DayGroup[]>(() => {
    const byDay = new Map<string, TransactionModel[]>();
    for (const t of this.filtered()) {
      const list = byDay.get(t.date) ?? [];
      list.push(t);
      byDay.set(t.date, list);
    }
    return [...byDay.entries()].map(([date, items]) => ({
      date,
      label: this.dayLabel(date),
      // Transfers move money between accounts: excluded from the day net
      total: items.reduce((sum, t) => {
        if (t.type === 'income') return sum + t.amount;
        if (t.type === 'expense') return sum - t.amount;
        return sum;
      }, 0),
      items,
    }));
  });

  constructor(
    private translate: TranslateService,
    public transactionService: TransactionService,
    public categoryService: CategoryService,
    public accountService: AccountService,
    public settings: SettingsService
  ) {}

  abs(value: number): number {
    return Math.abs(value);
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

  private dayLabel(date: string): string {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(this.translate.locale(), {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }
}
