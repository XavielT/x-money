import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TransactionModel } from '../../../shared/models/transaction.model';
import { TransactionItem } from '../../../shared/components/transaction-item/transaction-item';
import { TransactionService } from '../../../shared/services/transaction.service';
import { SettingsService } from '../../../shared/services/settings.service';

interface DayGroup {
  date: string;
  label: string;
  total: number;
  items: TransactionModel[];
}

@Component({
  selector: 'app-transactions',
  standalone: true,
  imports: [CommonModule, RouterLink, TransactionItem],
  templateUrl: './transactions.html',
  styleUrl: './transactions.scss',
})
export class TransactionsComponent {
  private now = new Date();
  year = signal(this.now.getFullYear());
  month = signal(this.now.getMonth() + 1); // 1-12

  monthLabel = computed(() =>
    new Date(this.year(), this.month() - 1, 1).toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
    })
  );

  summary = computed(() => this.transactionService.monthSummary(this.year(), this.month()));

  net = computed(() => this.summary().income - this.summary().expense);

  abs(value: number): number {
    return Math.abs(value);
  }

  groups = computed<DayGroup[]>(() => {
    const byDay = new Map<string, TransactionModel[]>();
    for (const t of this.transactionService.forMonth(this.year(), this.month())) {
      const list = byDay.get(t.date) ?? [];
      list.push(t);
      byDay.set(t.date, list);
    }
    return [...byDay.entries()].map(([date, items]) => ({
      date,
      label: this.dayLabel(date),
      total: items.reduce((sum, t) => sum + (t.type === 'income' ? t.amount : -t.amount), 0),
      items,
    }));
  });

  constructor(
    public transactionService: TransactionService,
    public settings: SettingsService
  ) {}

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
    return new Date(y, m - 1, d).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }
}
