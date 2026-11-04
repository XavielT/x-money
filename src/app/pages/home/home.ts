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
import { CardAlert } from '../../../shared/domain/cards';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterLink, TransactionItem, BankBadge, TranslatePipe],
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
  budgetAlerts = computed(() =>
    this.budgetService
      .budgets()
      .map((budget) => {
        const spent = spentInCategory(this.transactionService.forMonth(this.year, this.month), budget.categoryId);
        const percent = budget.monthlyLimit > 0 ? Math.round((spent / budget.monthlyLimit) * 100) : 0;
        return {
          category: this.categoryService.byId(budget.categoryId),
          percent,
          over: percent >= 100,
        };
      })
      .filter((alert) => alert.percent >= 90)
  );

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

  constructor(
    private budgetService: BudgetService,
    private insights: InsightsService,
    private translate: TranslateService,
    public transactionService: TransactionService,
    public categoryService: CategoryService,
    public accountService: AccountService,
    public settings: SettingsService,
    private cardService: CreditCardService
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
}
