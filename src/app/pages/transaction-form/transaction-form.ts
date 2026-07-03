import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TransactionCurrency, TransactionKind } from '../../../shared/models/transaction.model';
import { AccountModel } from '../../../shared/models/account.model';
import { RecurringFrequency } from '../../../shared/models/recurring.model';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { TransactionService } from '../../../shared/services/transaction.service';
import { CategoryService } from '../../../shared/services/category.service';
import { AccountService } from '../../../shared/services/account.service';
import { SettingsService } from '../../../shared/services/settings.service';
import { RecurringService } from '../../../shared/services/recurring.service';
import { TranslateService } from '../../../shared/services/translate.service';

@Component({
  selector: 'app-transaction-form',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './transaction-form.html',
  styleUrl: './transaction-form.scss',
})
export class TransactionFormComponent {
  editId: string | null = null;

  kind = signal<TransactionKind>('expense');
  categoryId = signal<string>('');
  txCurrency = signal<TransactionCurrency>('DOP');
  amount: number | null = null;
  fee: number | null = null;
  accountId = '';
  toAccountId = '';
  date = '';
  note = '';
  repeat: RecurringFrequency | 'none' = 'none';

  // Inline "new category" mini form
  showNewCategory = signal(false);
  newCatName = '';
  newCatIcon = '';
  newCatColor = '#ff7043';
  categoryColors = ['#ff7043', '#ffca28', '#66bb6a', '#26a69a', '#42a5f5', '#7e57c2', '#ec407a', '#8d6e63'];
  emojiSuggestions = ['🎨', '🛠️', '🎸', '☕', '🎬', '📱', '🧰', '⚽', '🌮', '💡'];

  categoriesForType = computed(() => {
    const kind = this.kind();
    return kind === 'transfer' ? [] : this.categoryService.ofType(kind);
  });

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private transactionService: TransactionService,
    private recurringService: RecurringService,
    private translate: TranslateService,
    public categoryService: CategoryService,
    public accountService: AccountService,
    public settings: SettingsService
  ) {
    this.date = this.todayIso();
    const accounts = this.accountService.accounts();
    this.accountId = accounts[0]?.id ?? '';
    this.toAccountId = accounts[1]?.id ?? accounts[0]?.id ?? '';

    this.editId = this.route.snapshot.paramMap.get('id');
    if (this.editId) {
      const existing = this.transactionService.byId(this.editId);
      if (existing) {
        this.kind.set(existing.type);
        this.categoryId.set(existing.categoryId ?? '');
        this.amount = existing.amount;
        this.accountId = existing.accountId;
        this.toAccountId = existing.toAccountId ?? this.toAccountId;
        this.txCurrency.set(existing.currency ?? 'DOP');
        this.fee = existing.fee ?? null;
        this.date = existing.date;
        this.note = existing.note ?? '';
      } else {
        this.editId = null;
      }
    }
    if (!this.editId) this.syncCurrencyToAccount();
  }

  setKind(kind: TransactionKind): void {
    if (this.kind() === kind) return;
    this.kind.set(kind);
    this.categoryId.set(''); // categories differ per type; transfers have none
    this.showNewCategory.set(false);
  }

  // ----- Currency handling -----

  private accountOf(id: string): AccountModel | undefined {
    return this.accountService.byId(id);
  }

  accountChanged(id: string): void {
    this.accountId = id;
    this.syncCurrencyToAccount();
  }

  private syncCurrencyToAccount(): void {
    const currency = this.accountOf(this.accountId)?.currency ?? 'DOP';
    if (currency === 'USD') this.txCurrency.set('USD');
    else if (currency === 'DOP') this.txCurrency.set('DOP');
    // dual: keep whatever the user picked
  }

  // Dual accounts let the user pick the currency per transaction
  showCurrencyToggle(): boolean {
    return (this.accountOf(this.accountId)?.currency ?? 'DOP') === 'dual';
  }

  setTxCurrency(currency: TransactionCurrency): void {
    this.txCurrency.set(currency);
  }

  // Fees apply to movements from bank accounts and cards, not cash
  showFeeField(): boolean {
    return (this.accountOf(this.accountId)?.type ?? 'cash') !== 'cash';
  }

  // DGII tax on bank transfers — rate is editable in Settings (0.20% today)
  applyDgiiFee(): void {
    if (this.amount == null || this.amount <= 0) return;
    const rate = this.settings.taxPercent() / 100;
    this.fee = Math.round(this.amount * rate * 100) / 100;
  }

  // An account can move money in a currency if it matches or is dual
  private accountAccepts(id: string, currency: TransactionCurrency): boolean {
    const accountCurrency = this.accountOf(id)?.currency ?? 'DOP';
    return accountCurrency === 'dual' || accountCurrency === currency;
  }

  selectCategory(id: string): void {
    this.categoryId.set(id);
  }

  toggleNewCategory(): void {
    this.showNewCategory.update((open) => !open);
  }

  createCategory(): void {
    const name = this.newCatName.trim();
    const icon = this.newCatIcon.trim() || '🏷️';
    const kind = this.kind();
    if (!name || kind === 'transfer') return;
    const category = this.categoryService.add(name, icon, this.newCatColor, kind);
    this.categoryId.set(category.id);
    this.newCatName = '';
    this.newCatIcon = '';
    this.showNewCategory.set(false);
  }

  isValid(): boolean {
    const base = this.amount != null && this.amount > 0 && !!this.accountId && !!this.date;
    if (!base) return false;
    if (!this.accountAccepts(this.accountId, this.txCurrency())) return false;
    if (this.kind() === 'transfer') {
      return (
        !!this.toAccountId &&
        this.toAccountId !== this.accountId &&
        this.accountAccepts(this.toAccountId, this.txCurrency())
      );
    }
    return !!this.categoryId();
  }

  save(): void {
    if (!this.isValid()) return;
    const isTransfer = this.kind() === 'transfer';
    const data = {
      type: this.kind(),
      amount: Number(this.amount),
      categoryId: isTransfer ? undefined : this.categoryId(),
      accountId: this.accountId,
      toAccountId: isTransfer ? this.toAccountId : undefined,
      currency: this.txCurrency(),
      fee: this.showFeeField() && this.fee && this.fee > 0 ? Number(this.fee) : undefined,
      date: this.date,
      note: this.note.trim() || undefined,
    };
    if (this.editId) {
      this.transactionService.update({ ...data, id: this.editId });
    } else if (this.repeat !== 'none') {
      // The recurring rule posts the first occurrence itself (if already due)
      const { date, ...rule } = data;
      this.recurringService.add({ ...rule, frequency: this.repeat, startDate: date });
    } else {
      this.transactionService.add(data);
    }
    this.router.navigate(['/transactions']);
  }

  delete(): void {
    if (!this.editId) return;
    if (!confirm(this.translate.instant('Delete this transaction?'))) return;
    this.transactionService.remove(this.editId);
    this.router.navigate(['/transactions']);
  }

  cancel(): void {
    history.back();
  }

  private todayIso(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;
  }
}
