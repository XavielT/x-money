import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { CategoryService } from '../../../shared/services/category.service';
import { FixedExpenseService, Obligation } from '../../../shared/services/fixed-expense.service';
import { InsightsService } from '../../../shared/services/insights.service';
import { SettingsService } from '../../../shared/services/settings.service';

// Fixed expenses: the recurring obligations whose nature is fixed, with what they cost per month,
// per year (an estimate) and what is still to be paid this month.
@Component({
  selector: 'app-fixed-expenses',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe],
  templateUrl: './fixed-expenses.html',
  styleUrl: './fixed-expenses.scss',
})
export class FixedExpensesComponent {
  constructor(
    public fixed: FixedExpenseService,
    private categories: CategoryService,
    private insights: InsightsService,
    public settings: SettingsService
  ) {}

  subscriptions() {
    return this.insights.subscriptionCost();
  }

  name(o: Obligation): string {
    return o.rule.note || (o.categoryId ? this.categories.byId(o.categoryId)?.name : '') || '';
  }

  icon(o: Obligation): string {
    return (o.categoryId && this.categories.byId(o.categoryId)?.icon) || '📆';
  }

  frequency(o: Obligation): string {
    return { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' }[o.rule.frequency];
  }

  back(): void {
    history.back();
  }
}
