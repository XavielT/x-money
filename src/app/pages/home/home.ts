import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TransactionItem } from '../../../shared/components/transaction-item/transaction-item';
import { BankBadge } from '../../../shared/ui/bank-badge/bank-badge';
import { spentInCategory } from '../../../shared/domain/stats';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { TransactionService } from '../../../shared/services/transaction.service';
import { CategoryService } from '../../../shared/services/category.service';
import { SettingsService } from '../../../shared/services/settings.service';
import { BudgetService } from '../../../shared/services/budget.service';
import { AccountService } from '../../../shared/services/account.service';
import { InsightsService } from '../../../shared/services/insights.service';
import { TranslateService } from '../../../shared/services/translate.service';
import { CreditCardService } from '../../../shared/services/credit-card.service';
import { CardAlert, isCreditCard } from '../../../shared/domain/cards';
import { AccountModel } from '../../../shared/models/account.model';
import { BUCKET_LABELS } from '../../../shared/data/bucket-labels';
import { GoalService } from '../../../shared/services/goal.service';
import { LoanService } from '../../../shared/services/loan.service';
import { HomeInsightsComponent } from '../../../shared/components/home-insights/home-insights';
import { BucketKind } from '../../../shared/models/budget.model';
import { ExpectedIncomeComponent } from '../../../shared/components/expected-income/expected-income';
import { DashboardIndicatorsComponent } from '../../../shared/components/dashboard-indicators/dashboard-indicators';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterLink, TransactionItem, BankBadge, TranslatePipe, ExpectedIncomeComponent, DashboardIndicatorsComponent, HomeInsightsComponent],
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
  budgetAlerts = computed(() => {
    const rows = this.budgetService.categoryRows(this.year, this.month);
    return this.budgetService
      .budgets()
      .map((budget) => {
        const row = rows.find((r) => r.budget.id === budget.id)!;
        const percent = row.limit > 0 ? Math.round((row.spent / row.limit) * 100) : 0;
        return {
          category: this.categoryService.byId(budget.categoryId),
          percent,
          over: percent >= 100,
          risk: row.risk.status === 'risk' ? row.risk : null,
        };
      })
      .filter((alert) => alert.percent >= 90 || alert.risk);
  });

  // Blocks that, at this pace, will exceed their limit (an estimate)
  bucketAlerts = computed(() => this.budgetService.risks().filter((r) => r.kind === 'bucket'));

  // "At this pace you reach RD$X on day Y" (an estimate)
  riskText(r: { projected: number; hitDate: string | null }): string {
    const amount = `${this.settings.currency()}${Math.round(r.projected).toLocaleString('en-US')}`;
    return r.hitDate
      ? this.translate.instant('At this pace you reach the limit on {date} and end the month at {amount} (estimate)', { date: r.hitDate, amount })
      : this.translate.instant('At this pace you end the month at {amount} (estimate)', { amount });
  }

  bucketName(kind: string): string {
    return this.translate.instant(BUCKET_LABELS[kind as BucketKind] ?? kind);
  }

  hasTransactions = computed(() => this.transactionService.transactions().length > 0);

  // Cap the Home strip so a large account list doesn't become an endless
  // horizontal scroll; full management stays on the Accounts page
  private static readonly VISIBLE_ACCOUNTS = 6;
  visibleAccounts = computed(() =>
    this.accountService.accounts().slice(0, HomeComponent.VISIBLE_ACCOUNTS)
  );
  hiddenAccountsCount = computed(() =>
    Math.max(0, this.accountService.accounts().length - HomeComponent.VISIBLE_ACCOUNTS)
  );

  // Ant-expenses warning when small purchases are a big slice of the month
  antAlert = computed(() => {
    const insight = this.insights.antExpenses(this.year, this.month);
    return insight.count >= 8 && insight.percent >= 10 ? insight : null;
  });

  // Credit card cut / due alerts (nothing is shown for a paid statement) and cards to complete
  cardAlerts = computed(() => this.cardService.alerts().slice(0, 4));
  incompleteCards = computed(() => this.cardService.incompleteCards());
  goalReminders = computed(() => this.goals.reminders());
  loanAlerts = computed(() => this.loans.alerts().slice(0, 3));

  loanAlertText(a: { loanId: string; stage: string; daysLeft: number }): string {
    const name = this.loans.byId(a.loanId)?.name ?? '';
    const key = a.stage === 'overdue' ? 'The installment of {name} is {days} days overdue' : a.daysLeft <= 0 ? 'The installment of {name} is due today' : 'The installment of {name} is due in {days} days';
    return this.translate.instant(key, { name, days: String(Math.abs(a.daysLeft)) });
  }

  goalName(id: string): string {
    return this.goals.byId(id)?.name ?? '';
  }

  constructor(
    private budgetService: BudgetService,
    private insights: InsightsService,
    private translate: TranslateService,
    public transactionService: TransactionService,
    public categoryService: CategoryService,
    public accountService: AccountService,
    public settings: SettingsService,
    private cardService: CreditCardService,
    private goals: GoalService,
    private loans: LoanService
  ) {
    this.cardService.ensureStatements();
    this.monthLabel = this.today.toLocaleString(this.translate.locale(), { month: 'long' });
  }

  // Alert sentence. English phrases are the translation keys.
  alertText(a: CardAlert): string {
    const name = this.accountService.byId(a.accountId)?.name ?? '';
    const days = String(Math.abs(a.daysLeft));
    const t = (key: string) => this.translate.instant(key, { name, days });
    switch (a.stage) {
      case 'cut-today':
        return t('Today is the cut day of your {name} card');
      case 'cut-3':
        return t('Your {name} card cuts in {days} days');
      case 'overdue':
        return t('The payment of your {name} card is overdue');
      default:
        return a.daysLeft <= 0 ? t('The payment of your {name} card is due today') : a.daysLeft === 1 ? t('The payment of your {name} card is due tomorrow') : t('The payment of your {name} card is due in {days} days');
    }
  }

  alertSymbol(a: CardAlert): string {
    return a.currency === 'USD' ? 'US$' : this.settings.currency();
  }

  abs(value: number): number {
    return Math.abs(value);
  }

  // a tile opens the account's detail (a credit card, its own page)
  detailLink(acc: AccountModel): string[] {
    return [isCreditCard(acc) ? '/card' : '/account', acc.id];
  }

  // a credit card with a debt: the tile says what is owed instead of showing a negative balance
  isDebt(acc: AccountModel): boolean {
    return isCreditCard(acc) && this.transactionService.accountBalance(acc.id) < 0;
  }
}
