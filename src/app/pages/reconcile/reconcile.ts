import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AccountModel } from '../../../shared/models/account.model';
import { TransactionCurrency } from '../../../shared/models/transaction.model';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { AccountService } from '../../../shared/services/account.service';
import { CategoryService } from '../../../shared/services/category.service';
import { ReconciliationService } from '../../../shared/services/reconciliation.service';
import { SettingsService } from '../../../shared/services/settings.service';
import { localIso } from '../../../shared/domain/dates';
import { adjustmentFor } from '../../../shared/domain/reconcile';

// Reconcile one account with its bank statement. The app never adjusts a difference on its
// own: it shows it, lets you tick the movements that appear on the statement, and only
// creates an adjustment (visible, audited, outside income/expense) when you ask for it.
@Component({
  selector: 'app-reconcile',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './reconcile.html',
  styleUrl: './reconcile.scss',
})
export class ReconcileComponent {
  account: AccountModel | undefined;
  currency = signal<TransactionCurrency>('DOP');
  bankBalance = signal<number | null>(null);
  date = signal(localIso(new Date()));
  marked = signal<ReadonlySet<string>>(new Set());
  done = signal(false);

  view = computed(() => {
    const balance = this.bankBalance();
    if (!this.account || balance === null || !Number.isFinite(balance)) return null;
    return this.reconciliation.view(this.account.id, this.currency(), this.date(), balance);
  });

  canAdjust = computed(() => !!this.view() && !!adjustmentFor(this.view()!.difference));

  constructor(
    route: ActivatedRoute,
    private reconciliation: ReconciliationService,
    public accountService: AccountService,
    public categoryService: CategoryService,
    public settings: SettingsService
  ) {
    this.account = this.accountService.byId(route.snapshot.paramMap.get('id') ?? '');
    if (this.account?.currency === 'USD') this.currency.set('USD');
  }

  isDual(): boolean {
    return this.account?.currency === 'dual';
  }

  symbol(): string {
    return this.currency() === 'USD' ? 'US$' : this.settings.currency();
  }

  toggle(id: string): void {
    const next = new Set(this.marked());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.marked.set(next);
  }

  // Creates the visible adjustment; the view recalculates and the difference drops to zero
  adjust(): void {
    const v = this.view();
    if (!this.account || !v) return;
    this.reconciliation.createAdjustment(this.account.id, this.currency(), this.date(), v.difference);
  }

  finish(): void {
    const v = this.view();
    if (!this.account || !v) return;
    this.reconciliation.complete(this.account.id, this.date(), [...this.marked()], this.bankBalance()!, v.difference);
    this.done.set(true);
  }

  back(): void {
    history.back();
  }

  label(t: { categoryId?: string; type: string }): string {
    return t.type === 'transfer' ? '🔁' : this.categoryService.byId(t.categoryId ?? '')?.name ?? '?';
  }

  accountName(id: string | undefined): string {
    return (id && this.accountService.byId(id)?.name) || '?';
  }
}
