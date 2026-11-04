import { Injectable } from '@angular/core';
import { TransactionCurrency } from '../models/transaction.model';
import { ownerId } from '../domain/ledger';
import { SmallPurchases, smallPurchases } from '../domain/small-purchases';
import { isCounted } from '../domain/stats';
import { AccountService } from './account.service';
import { TransactionService } from './transaction.service';
import { RecurringService } from './recurring.service';

export type AntExpensesInsight = SmallPurchases;

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
// Everything works in the primary currency unless told otherwise.
@Injectable({ providedIn: 'root' })
export class InsightsService {
  constructor(
    private transactionService: TransactionService,
    private recurringService: RecurringService,
    private accountService: AccountService
  ) {}

  // Small purchases (below ~2% of the month's spending, min 100) that in
  // volume become a meaningful share of the month
  antExpenses(year: number, month: number): AntExpensesInsight {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    return this.antExpensesFor({ from: `${prefix}-01`, to: `${prefix}-31` });
  }

  // The same rule for one account (a credit card, for instance) and any period, inclusive
  antExpensesFor(options: { accountId?: string; from: string; to: string; currency?: TransactionCurrency; ceiling?: number }): AntExpensesInsight {
    const currency = options.currency ?? 'DOP';
    const accounts = this.accountService.accounts();
    const amounts = this.transactionService
      .transactions()
      .filter(
        (t) =>
          t.type === 'expense' &&
          isCounted(t) &&
          this.transactionService.currencyOf(t) === currency &&
          t.date >= options.from &&
          t.date <= options.to &&
          (options.accountId === undefined || ownerId(accounts, t.accountId) === options.accountId)
      )
      .map((t) => t.amount);
    return smallPurchases(amounts, options.ceiling);
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
