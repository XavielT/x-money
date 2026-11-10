import { Component, ElementRef, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CategoryModel } from '../../../shared/models/category.model';
import { BudgetModel } from '../../../shared/models/budget.model';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { BudgetService } from '../../../shared/services/budget.service';
import { CategoryService } from '../../../shared/services/category.service';
import { TransactionService } from '../../../shared/services/transaction.service';
import { SettingsService } from '../../../shared/services/settings.service';
import { BudgetRisk } from '../../../shared/domain/budget';
import { BudgetSuggestion, suggestBudgetLimit } from '../../../shared/domain/budget-suggestion';
import { localIso } from '../../../shared/domain/dates';
import { revealAndFocus } from '../../../shared/ui/reveal';
import { RouterLink } from '@angular/router';
import { TranslateService } from '../../../shared/services/translate.service';

interface BudgetRow {
  budget: BudgetModel;
  category: CategoryModel | undefined;
  spent: number;
  limit: number; // the monthly limit with what moved in or out this month
  left: number; // what is left of the limit (negative when over)
  risk: BudgetRisk;
  percent: number; // capped at 100 for the bar width
  status: 'ok' | 'warn' | 'over';
}

interface Option {
  id: string;
  label: string;
}

@Component({
  selector: 'app-budgets',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe],
  templateUrl: './budgets.html',
  styleUrl: './budgets.scss',
})
export class BudgetsComponent {
  private now = new Date();
  year = this.now.getFullYear();
  month = this.now.getMonth() + 1;
  monthLabel = '';

  // The form is hidden until the user asks for it: "Create your first budget" / "New budget"
  creating = signal(false);
  // A budget being edited opens its form right under its row (one at a time)
  editingId = signal<string | null>(null);

  selectedCategoryId = '';
  limit: number | null = null;
  // The amount the form was filled with from the user's own history (an estimate; only the input holds it until Save)
  suggestion = signal<BudgetSuggestion | null>(null);

  rows = computed<BudgetRow[]>(() =>
    this.budgetService.categoryRows(this.year, this.month).map(({ budget, limit, spent, risk, remaining }) => {
      const ratio = limit > 0 ? spent / limit : 0;
      return {
        budget,
        category: this.categoryService.byId(budget.categoryId),
        spent,
        limit,
        left: remaining,
        risk,
        percent: Math.min(100, Math.round(ratio * 100)),
        status: ratio >= 1 ? 'over' : ratio >= 0.7 ? 'warn' : 'ok',
      };
    })
  );

  // Categories and their subcategories that can still get a budget, the ones with movements first
  newOptions = computed<{ used: Option[]; other: Option[] }>(() => {
    const budgeted = new Set(this.budgetService.budgets().map((b) => b.categoryId));
    const used = new Set<string>();
    for (const t of this.transactionService.transactions()) {
      if (t.type !== 'expense' || t.status === 'reversed') continue;
      if (t.categoryId) used.add(t.categoryId);
      if (t.subcategoryId) used.add(t.subcategoryId);
    }
    const all = this.categoryService
      .expenseCategories()
      .flatMap((c) => [{ id: c.id, label: `${c.icon} ${c.name}` }, ...this.categoryService.children(c.id).map((s) => ({ id: s.id, label: `${s.icon} ${s.name} · ${c.name}` }))])
      .filter((o) => !budgeted.has(o.id));
    return { used: all.filter((o) => used.has(o.id)), other: all.filter((o) => !used.has(o.id)) };
  });

  // "At this pace you reach RD$X on day Y" (an estimate)
  riskText(row: BudgetRow): string {
    const r = row.risk;
    const amount = `${this.settings.currency()}${Math.round(r.projected).toLocaleString('en-US')}`;
    if (r.hitDate) return this.translate.instant('At this pace you reach the limit on {date} and end the month at {amount} (estimate)', { date: r.hitDate, amount });
    return this.translate.instant('At this pace you end the month at {amount} (estimate)', { amount });
  }

  constructor(
    private translate: TranslateService,
    private host: ElementRef<HTMLElement>,
    public budgetService: BudgetService,
    public categoryService: CategoryService,
    public transactionService: TransactionService,
    public settings: SettingsService
  ) {
    this.monthLabel = this.now.toLocaleString(this.translate.locale(), {
      month: 'long',
      year: 'numeric',
    });
  }

  abs(value: number): number {
    return Math.abs(value);
  }

  // ----- create

  startCreate(): void {
    this.editingId.set(null);
    this.selectedCategoryId = '';
    this.limit = null;
    this.suggestion.set(null);
    this.creating.set(true);
    setTimeout(() => revealAndFocus(this.host.nativeElement.querySelector<HTMLElement>('.budgets-form'), 'select'));
  }

  cancelCreate(): void {
    this.creating.set(false);
  }

  // Choosing a category fills the amount with the average of the last months (editable, never saved on its own)
  onCategory(id: string): void {
    this.selectedCategoryId = id;
    const found = id ? suggestBudgetLimit(this.transactionService.transactions(), id, localIso(this.now)) : null;
    this.suggestion.set(found);
    this.limit = found ? found.amount : null;
    // no history: the empty amount takes the keyboard
    if (!found) setTimeout(() => this.host.nativeElement.querySelector<HTMLInputElement>('.budgets-form input[name="limit"]')?.focus());
  }

  suggestionText(): string {
    const s = this.suggestion();
    return s ? this.translate.instant('Suggested: your average over the last {n} month(s). It is an estimate; change it if you want.', { n: String(s.months) }) : '';
  }

  saveBudget(): void {
    if (!this.selectedCategoryId || this.limit == null || this.limit <= 0) return;
    this.budgetService.upsert(this.selectedCategoryId, Number(this.limit));
    this.selectedCategoryId = '';
    this.limit = null;
    this.suggestion.set(null);
    this.creating.set(false);
  }

  // ----- edit in place

  startEdit(row: BudgetRow): void {
    if (this.editingId() === row.budget.id) {
      this.editingId.set(null);
      return;
    }
    this.creating.set(false);
    this.limit = row.budget.monthlyLimit;
    this.editingId.set(row.budget.id);
    setTimeout(() => revealAndFocus(this.host.nativeElement.querySelector<HTMLElement>('.budgets-edit'), 'input'));
  }

  saveEdit(row: BudgetRow): void {
    if (this.limit == null || this.limit <= 0) return;
    this.budgetService.upsert(row.budget.categoryId, Number(this.limit));
    this.editingId.set(null);
    this.limit = null;
  }

  removeBudget(id: string): void {
    if (!confirm(this.translate.instant('Remove this budget?'))) return;
    this.budgetService.remove(id);
    this.editingId.set(null);
  }
}
