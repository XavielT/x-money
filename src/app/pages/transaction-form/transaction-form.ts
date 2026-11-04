import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TransactionCurrency, TransactionKind } from '../../../shared/models/transaction.model';
import { AccountModel } from '../../../shared/models/account.model';
import { RecurringFrequency } from '../../../shared/models/recurring.model';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { NewTransaction, TransactionService } from '../../../shared/services/transaction.service';
import { CategoryService } from '../../../shared/services/category.service';
import { AccountService } from '../../../shared/services/account.service';
import { SettingsService } from '../../../shared/services/settings.service';
import { RecurringService } from '../../../shared/services/recurring.service';
import { TranslateService } from '../../../shared/services/translate.service';
import { TxErrorCode, TxResult } from '../../../shared/domain/validation';
import { TX_ERROR_TEXT } from '../../../shared/ui/tx-error-text';
import { IncomeSourceService } from '../../../shared/services/income-source.service';
import { IncomeService } from '../../../shared/services/income.service';
import { isCommercialKind } from '../../../shared/models/income-source.model';
import { saleBenefit } from '../../../shared/domain/income';
import { round2, sumMoney } from '../../../shared/utils/money';

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

  // income details (2.9.0)
  sourceId = '';
  grossAmount: number | null = null;
  deductions: { name: string; amount: number | null }[] = [];
  costBasis: number | null = null;
  saleExpenses: number | null = null;
  error = signal<TxErrorCode | ''>('');

  private static readonly ERRORS = TX_ERROR_TEXT;

  errorText(): string {
    const code = this.error();
    return code ? this.translate.instant(TransactionFormComponent.ERRORS[code]) : '';
  }

  // Accounts the movement can use: the active ones, plus the current one if it was archived since
  selectableAccounts(): AccountModel[] {
    const active = this.accountService.activeAccounts();
    const current = this.editId ? this.transactionService.byId(this.editId)?.accountId : undefined;
    const archived = current ? this.accountService.byId(current) : undefined;
    return archived?.archived ? [...active, archived] : active;
  }

  // Paying a credit card is a transfer to it: as an expense it would be counted twice
  showCardHint(): boolean {
    return this.kind() !== 'transfer' && this.accountService.activeAccounts().some((a) => a.type === 'card' && a.cardKind === 'credit');
  }

  isReversible(): boolean {
    const tx = this.editId ? this.transactionService.byId(this.editId) : undefined;
    return !!tx && tx.status !== 'reversed' && tx.origin !== 'reversal';
  }

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
    public incomeSources: IncomeSourceService,
    private incomeService: IncomeService,
    private translate: TranslateService,
    public categoryService: CategoryService,
    public accountService: AccountService,
    public settings: SettingsService
  ) {
    this.date = this.todayIso();
    const accounts = this.accountService.activeAccounts();
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
        this.sourceId = existing.incomeSourceId ?? '';
        this.grossAmount = existing.grossAmount ?? null;
        this.deductions = (existing.deductions ?? []).map((d) => ({ ...d }));
        this.costBasis = existing.costBasis ?? null;
        this.saleExpenses = existing.saleExpenses ?? null;
      } else {
        this.editId = null;
      }
    }
    if (!this.editId) this.syncCurrencyToAccount();

    // "Did it arrive?" opens the form preloaded with the source and the expected date
    const query = this.route.snapshot.queryParamMap;
    if (!this.editId && query.get('kind') === 'income') {
      this.kind.set('income');
      const date = query.get('date');
      if (date) this.date = date;
      const source = query.get('source');
      if (source) this.sourceChanged(source);
    }
  }

  // ----- income source (optional): fills the usual account, category and expected amounts

  activeSources() {
    return this.incomeSources.active();
  }

  sourceChanged(id: string): void {
    this.sourceId = id;
    const s = this.incomeSources.byId(id);
    if (!s) return;
    const usable = s.defaultAccountId && this.accountService.byId(s.defaultAccountId)?.archived !== true ? s.defaultAccountId : undefined;
    const preferred = usable ?? this.accountService.activeAccounts().find((a) => (s.method === 'cash' ? a.type === 'cash' : a.type === 'bank'))?.id;
    if (preferred) this.accountChanged(preferred);
    if (!this.categoryId()) this.categoryId.set(this.incomeService.categoryFor(s.kind));
    if (this.amount == null && s.expectedNet) this.amount = s.expectedNet;
    if (this.grossAmount == null && s.expectedGross) this.grossAmount = s.expectedGross;
  }

  sourceIsCommercial(): boolean {
    const s = this.incomeSources.byId(this.sourceId);
    return !!s && isCommercialKind(s.kind);
  }

  addDeduction(): void {
    this.deductions = [...this.deductions, { name: '', amount: null }];
  }

  removeDeduction(i: number): void {
    this.deductions = this.deductions.filter((_, idx) => idx !== i);
  }

  // gross - deductions - net: what the declared figures leave unexplained (shown, never forced)
  deductionsGap(): number | null {
    if (this.grossAmount == null || this.amount == null || !this.deductions.length) return null;
    return round2(Number(this.grossAmount) - sumMoney(this.deductions.map((d) => Number(d.amount) || 0)) - Number(this.amount));
  }

  // price - cost - expenses of a sale; null until a cost is entered (the price alone says nothing)
  saleBenefitPreview(): number | null {
    if (this.costBasis == null || this.amount == null) return null;
    return saleBenefit({ amount: Number(this.amount), costBasis: Number(this.costBasis), saleExpenses: Number(this.saleExpenses) || 0 }) ?? null;
  }

  setKind(kind: TransactionKind): void {
    if (this.kind() === kind) return;
    this.kind.set(kind);
    this.categoryId.set(''); // categories differ per type; transfers have none
    if (kind !== 'income') this.sourceId = '';
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
    this.error.set('');
    this.finish(this.attempt(this.buildData(), false));
  }

  private attempt(data: NewTransaction, confirmFarFuture: boolean): TxResult {
    const options = { confirmFarFuture };
    if (this.editId) {
      const result = this.transactionService.update({ ...data, id: this.editId }, options);
      if (!result.ok && result.error === 'reconciled') {
        // already on a bank statement: the correction is a reversal plus a new movement
        if (!confirm(this.translate.instant('This movement is already reconciled with your bank statement. The correction reverses it and adds a new movement. Continue?'))) {
          return { ok: false, error: 'reconciled' };
        }
        return this.transactionService.correct(this.editId, data, { ...options, confirmReconciled: true });
      }
      return result;
    }
    if (this.repeat !== 'none') {
      // The recurring rule posts the first occurrence itself (if already due)
      const error = this.transactionService.check(data, options);
      if (error) return { ok: false, error };
      const { date, ...rule } = data;
      this.recurringService.add({ ...rule, frequency: this.repeat, startDate: date });
      return { ok: true, id: '' };
    }
    return this.transactionService.add(data, options);
  }

  private finish(result: TxResult): void {
    if (!result.ok && result.error === 'date-far-future') {
      if (confirm(this.translate.instant('This date is more than a year ahead. Save anyway?'))) {
        this.error.set('');
        this.finish(this.attempt(this.buildData(), true));
      }
      return;
    }
    if (!result.ok) {
      this.error.set(result.error);
      return;
    }
    this.router.navigate(['/transactions']);
  }

  private buildData(): NewTransaction {
    const isTransfer = this.kind() === 'transfer';
    return {
      type: this.kind(),
      amount: Number(this.amount),
      categoryId: isTransfer ? undefined : this.categoryId(),
      accountId: this.accountId,
      toAccountId: isTransfer ? this.toAccountId : undefined,
      currency: this.txCurrency(),
      fee: this.showFeeField() && this.fee && this.fee > 0 ? Number(this.fee) : undefined,
      date: this.date,
      note: this.note.trim() || undefined,
      ...this.incomeFields(),
    };
  }

  private incomeFields(): Partial<NewTransaction> {
    if (this.kind() !== 'income') return {};
    const deductions = this.deductions.filter((d) => d.name.trim() || d.amount).map((d) => ({ name: d.name.trim(), amount: Number(d.amount) || 0 }));
    return {
      incomeSourceId: this.sourceId || undefined,
      grossAmount: this.grossAmount ? Number(this.grossAmount) : undefined,
      deductions: deductions.length ? deductions : undefined,
      costBasis: this.costBasis != null && String(this.costBasis) !== '' ? Number(this.costBasis) : undefined,
      saleExpenses: this.saleExpenses ? Number(this.saleExpenses) : undefined,
    };
  }

  delete(): void {
    if (!this.editId) return;
    if (!confirm(this.translate.instant('Delete this transaction?'))) return;
    const result = this.transactionService.remove(this.editId);
    if (!result.ok) {
      this.error.set(result.error);
      return;
    }
    this.router.navigate(['/transactions']);
  }

  // Cancels the movement without deleting anything: an inverse movement is added and both stay visible
  reverse(): void {
    if (!this.editId) return;
    if (!confirm(this.translate.instant('Reverse this movement? An inverse movement is added and both stay in the history. Nothing is deleted.'))) return;
    const result = this.transactionService.reverse(this.editId);
    if (!result.ok) {
      this.error.set(result.error);
      return;
    }
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
