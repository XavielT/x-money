import { Injectable } from '@angular/core';
import { TransactionService } from './transaction.service';
import { RecurringService } from './recurring.service';

export interface AntExpensesInsight {
  count: number;
  total: number;
  percent: number; // share of the month's expenses
  threshold: number;
}

export interface SubscriptionInsight {
  count: number;
  monthly: number;
  yearly: number;
}

export interface MomChangeInsight {
  current: number;
  previous: number;
  percentChange: number; // positive = spending more than last month
}

// Awareness helpers inspired by Fintonic/Rocket Money: small "ant expenses"
// that add up, the real cost of recurring services, and spending spikes.
// Everything works in the primary currency.
@Injectable({ providedIn: 'root' })
export class InsightsService {
  constructor(
    private transactionService: TransactionService,
    private recurringService: RecurringService
  ) {}

  // Small purchases (below ~2% of the month's spending, min 100) that in
  // volume become a meaningful share of the month
  antExpenses(year: number, month: number): AntExpensesInsight {
    const expenses = this.transactionService
      .forMonth(year, month)
      .filter((t) => t.type === 'expense' && this.transactionService.currencyOf(t) === 'DOP');
    const total = expenses.reduce((sum, t) => sum + t.amount, 0);
    if (!total) return { count: 0, total: 0, percent: 0, threshold: 0 };

    const threshold = Math.max(100, total * 0.02);
    const small = expenses.filter((t) => t.amount <= threshold);
    const smallTotal = small.reduce((sum, t) => sum + t.amount, 0);
    return {
      count: small.length,
      total: smallTotal,
      percent: Math.round((smallTotal / total) * 100),
      threshold,
    };
  }

  // What active recurring expense rules cost per month / per year
  subscriptionCost(): SubscriptionInsight {
    const factors: Record<string, number> = { daily: 30.44, weekly: 4.35, monthly: 1, yearly: 1 / 12 };
    let monthly = 0;
    let count = 0;
    for (const rule of this.recurringService.recurring()) {
      if (!rule.active || rule.type !== 'expense') continue;
      monthly += rule.amount * (factors[rule.frequency] ?? 1);
      count++;
    }
    return { count, monthly, yearly: monthly * 12 };
  }

  // Spending change vs the previous month (null until both months have data)
  momChange(year: number, month: number): MomChangeInsight | null {
    const current = this.transactionService.monthSummary(year, month).expense;
    const prevDate = new Date(year, month - 2, 1);
    const previous = this.transactionService.monthSummary(
      prevDate.getFullYear(),
      prevDate.getMonth() + 1
    ).expense;
    if (!previous || !current) return null;
    return {
      current,
      previous,
      percentChange: Math.round(((current - previous) / previous) * 100),
    };
  }
}
