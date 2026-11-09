import { Component, ElementRef, Signal, signal } from '@angular/core';
import { CommonModule, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AccountCurrency,
  AccountModel,
  AccountType,
  BankAccountKind,
  CardKind,
} from '../../../shared/models/account.model';
import { BankModel } from '../../../shared/models/bank.model';
import { BANKS_MOCK } from '../../../shared/data/banks';
import { BankBadge } from '../../../shared/ui/bank-badge/bank-badge';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { AccountService } from '../../../shared/services/account.service';
import { TransactionService } from '../../../shared/services/transaction.service';
import { SettingsService } from '../../../shared/services/settings.service';
import { TranslateService } from '../../../shared/services/translate.service';
import { bankById } from '../../../shared/data/banks';
import { NetWorthService } from '../../../shared/services/net-worth.service';
import { SuggestionsService } from '../../../shared/services/suggestions.service';
import { LoanService } from '../../../shared/services/loan.service';
import { CreditCardService } from '../../../shared/services/credit-card.service';
import { CardPaymentSuggestion } from '../../../shared/domain/card-payments';
import { isCreditCard } from '../../../shared/domain/cards';
import { NetWorth, defaultLiquid } from '../../../shared/domain/networth';
import { TransferSuggestion } from '../../../shared/domain/transfers';
import { Cadence, IncomePatternSuggestion } from '../../../shared/domain/income-patterns';
import { TxErrorCode } from '../../../shared/domain/validation';
import { balanceAfterOpeningChange } from '../../../shared/domain/opening-balance';
import { revealAndFocus } from '../../../shared/ui/reveal';

@Component({
  selector: 'app-accounts',
  standalone: true,
  imports: [CommonModule, FormsModule, NgTemplateOutlet, BankBadge, TranslatePipe],
  templateUrl: './accounts.html',
  styleUrl: './accounts.scss',
})
export class AccountsComponent {
  banks = BANKS_MOCK;
  accountTypes: { key: string; type: AccountType; cardKind?: CardKind; icon: string; label: string }[] = [
    { key: 'cash', type: 'cash', icon: '💵', label: 'Cash' },
    { key: 'bank', type: 'bank', icon: '🏦', label: 'Bank account' },
    { key: 'debit', type: 'card', cardKind: 'debit', icon: '💳', label: 'Debit card' },
    { key: 'credit', type: 'card', cardKind: 'credit', icon: '💳', label: 'Credit card' },
    { key: 'savings', type: 'savings', icon: '💰', label: 'Savings' },
    { key: 'other', type: 'other', icon: '🏷️', label: 'Other account' },
  ];

  bankKinds: { kind: BankAccountKind; label: string }[] = [
    { kind: 'checking', label: 'Checking account' },
    { kind: 'savings', label: 'Savings account' },
    { kind: 'payroll', label: 'Payroll account' },
  ];

  showForm = signal(false);
  // the account being edited (null = adding a new one); a signal so the form moves under the right card
  editing = signal<string | null>(null);
  get editingId(): string | null {
    return this.editing();
  }
  formTypeKey = signal('bank');
  formBankId = signal('');
  formBankKind = signal<BankAccountKind | ''>('');
  formCurrency = signal<AccountCurrency>('DOP');
  formLinkedId = signal('');
  formName = '';
  formLast4 = '';
  formBalance: number | null = 0;
  bankSearch = signal('');
  formIcon = '';
  formLiquid = true;
  showArchived = signal(false);
  message = signal('');

  netWorth: Signal<NetWorth>;
  transferSuggestions: Signal<TransferSuggestion[]>;
  incomeSuggestions: Signal<IncomePatternSuggestion[]>;
  cardPaymentSuggestions: Signal<CardPaymentSuggestion[]>;

  constructor(
    route: ActivatedRoute,
    private router: Router,
    private translate: TranslateService,
    public accountService: AccountService,
    public transactionService: TransactionService,
    public settings: SettingsService,
    private netWorthService: NetWorthService,
    private suggestions: SuggestionsService,
    public cardService: CreditCardService,
    public loanService: LoanService,
    private host: ElementRef<HTMLElement>
  ) {
    this.netWorth = netWorthService.summary;
    this.transferSuggestions = suggestions.transfers;
    this.incomeSuggestions = suggestions.incomes;
    this.cardPaymentSuggestions = suggestions.cardPayments;
    // the account detail sends the user here to edit: /accounts?edit=<id>
    const toEdit = this.accountService.byId(route.snapshot.queryParamMap.get('edit') ?? '');
    if (toEdit) this.openEdit(toEdit);
    // the get-started card sends the user here to add the first account: /accounts?new=1
    else if (route.snapshot.queryParamMap.get('new') === '1') this.openAdd();
  }

  abs(value: number): number {
    return Math.abs(value);
  }

  bankName(bankId: string | undefined): string {
    return bankById(bankId)?.name ?? '';
  }

  typeLabel(account: AccountModel): string {
    // Bank accounts show their subtype the way banks name them
    if (account.type === 'bank' && account.bankKind) {
      const kind = this.bankKinds.find((k) => k.kind === account.bankKind);
      if (kind) return this.translate.instant(kind.label);
    }
    const entry =
      account.type === 'card'
        ? this.accountTypes.find((t) => t.type === 'card' && t.cardKind === (account.cardKind ?? 'debit'))
        : this.accountTypes.find((t) => t.type === account.type);
    return this.translate.instant(entry?.label ?? account.type);
  }

  private selectedType() {
    return this.accountTypes.find((t) => t.key === this.formTypeKey()) ?? this.accountTypes[1];
  }

  // Linked debit cards show the balance of the bank account they spend from
  balanceOf(account: AccountModel): number {
    return this.transactionService.accountBalance(
      this.accountService.effectiveOwnerId(account.id),
      'DOP'
    );
  }

  usdBalanceOf(account: AccountModel): number {
    return this.transactionService.accountBalance(
      this.accountService.effectiveOwnerId(account.id),
      'USD'
    );
  }

  showDop(account: AccountModel): boolean {
    return account.currency !== 'USD';
  }

  showUsd(account: AccountModel): boolean {
    return account.currency === 'USD' || account.currency === 'dual' || this.usdBalanceOf(account) !== 0;
  }

  currencyTag(account: AccountModel): string {
    if (account.currency === 'USD') return 'US$';
    if (account.currency === 'dual') return `${this.settings.currency()}+US$`;
    return this.settings.currency();
  }

  linkedName(account: AccountModel): string {
    return account.linkedAccountId
      ? this.accountService.byId(account.linkedAccountId)?.name ?? ''
      : '';
  }

  // Groups accounts by bank so cards/checking/savings of the same bank sit
  // together instead of a flat list in creation order
  sortedAccounts(): AccountModel[] {
    const typeOrder: Record<AccountType, number> = { cash: 0, bank: 1, savings: 2, card: 3, other: 4 };
    return [...this.accountService.activeAccounts()].sort((a, b) => {
      const bankA = this.bankName(a.bankId);
      const bankB = this.bankName(b.bankId);
      if (bankA !== bankB) return bankA.localeCompare(bankB);
      const orderDiff = (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9);
      if (orderDiff !== 0) return orderDiff;
      return a.name.localeCompare(b.name);
    });
  }

  archivedAccounts(): AccountModel[] {
    return this.accountService.accounts().filter((a) => a.archived);
  }

  accountName(id: string): string {
    return this.accountService.byId(id)?.name ?? '?';
  }

  cadenceLabel(c: Cadence): string {
    return c === 'weekly' ? 'Weekly' : c === 'biweekly' ? 'Every two weeks' : 'Monthly';
  }

  // Bank picker filtered by search text (accent/case-insensitive)
  filteredBanks(): BankModel[] {
    const query = this.normalize(this.bankSearch());
    if (!query) return this.banks;
    return this.banks.filter((bank) => this.normalize(bank.name).includes(query));
  }

  private normalize(text: string): string {
    return text
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  }

  openAdd(): void {
    if (this.showForm() && !this.editing()) {
      this.cancelForm(); // tapping "Add account" again closes the open new-account form
      return;
    }
    this.editing.set(null);
    this.formTypeKey.set('bank');
    this.formBankId.set('');
    this.formBankKind.set('');
    this.formCurrency.set('DOP');
    this.formLinkedId.set('');
    this.formName = '';
    this.formLast4 = '';
    this.formBalance = 0;
    this.formIcon = '';
    this.formLiquid = true;
    this.bankSearch.set('');
    this.showForm.set(true);
    this.reveal();
  }

  // tapping a row: the account's detail (balance, latest movements); a credit card has its own page
  openDetail(account: AccountModel): void {
    void this.router.navigate([isCreditCard(account) ? '/card' : '/account', account.id]);
  }

  edit(account: AccountModel, event: Event): void {
    event.stopPropagation();
    this.openEdit(account);
  }

  openEdit(account: AccountModel): void {
    if (this.showForm() && this.editing() === account.id) {
      this.cancelForm(); // "Edit" on the account already open closes its form
      return;
    }
    this.editing.set(account.id);
    this.formTypeKey.set(
      account.type === 'card' ? (account.cardKind === 'credit' ? 'credit' : 'debit') : account.type
    );
    this.formBankId.set(account.bankId ?? '');
    this.formBankKind.set(account.bankKind ?? '');
    this.formCurrency.set(account.currency ?? 'DOP');
    this.formLinkedId.set(account.linkedAccountId ?? '');
    this.formName = account.name;
    this.formLast4 = account.last4 ?? '';
    this.formBalance = account.initialBalance;
    this.formIcon = account.type === 'other' ? account.icon : '';
    this.formLiquid = account.liquid ?? defaultLiquid(account.type);
    this.bankSearch.set('');
    this.showForm.set(true);
    this.reveal();
  }

  // the form is rendered under its account (or under "Add account"): bring it into view and focus the name
  private reveal(): void {
    setTimeout(() => revealAndFocus(this.host.nativeElement.querySelector<HTMLElement>('.accounts-form'), 'input[name="formName"]'));
  }

  // after closing, return the view to the row of the account that was being edited
  private backToRow(id: string | null): void {
    if (!id) return;
    setTimeout(() => {
      const row = this.host.nativeElement.querySelector<HTMLElement>(`[data-account-id="${id}"]`);
      if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
    });
  }

  cancelForm(): void {
    const was = this.editing();
    this.showForm.set(false);
    this.editing.set(null);
    this.backToRow(was);
  }

  // ----- opening balance: a change moves the whole history, so it is shown and confirmed first

  private editedAccount(): AccountModel | undefined {
    const id = this.editing();
    return id ? this.accountService.byId(id) : undefined;
  }

  // the currency the edited account started in (a dual card starts in RD$)
  private startCurrency(a: AccountModel): 'DOP' | 'USD' {
    return a.currency === 'USD' ? 'USD' : 'DOP';
  }

  // the balance now, in the currency the account started in (shown under the opening-balance field)
  currentBalanceText(): string {
    const a = this.editedAccount();
    if (!a) return '';
    const c = this.startCurrency(a);
    return this.money(c, c === 'USD' ? this.usdBalanceOf(a) : this.balanceOf(a));
  }

  private money(currency: 'DOP' | 'USD', value: number): string {
    const sym = currency === 'USD' ? 'US$' : this.settings.currency();
    const n = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${value < 0 ? '-' : ''}${sym}${n}`;
  }

  // null when the opening balance did not change (nothing to ask)
  openingChange(): { currency: 'DOP' | 'USD'; before: number; after: number } | null {
    const a = this.editedAccount();
    if (!a || this.isLinked()) return null;
    const currency = this.startCurrency(a);
    const current = currency === 'USD' ? this.usdBalanceOf(a) : this.balanceOf(a);
    const change = balanceAfterOpeningChange(current, a.initialBalance, Number(this.formBalance) || 0);
    return change.changed ? { currency, before: change.before, after: change.after } : null;
  }

  setTypeKey(key: string): void {
    this.formTypeKey.set(key);
    if (key === 'cash') this.formBankId.set('');
    if (key !== 'bank') this.formBankKind.set('');
    if (key !== 'credit' && this.formCurrency() === 'dual') this.formCurrency.set('DOP');
    if (key !== 'debit') this.formLinkedId.set('');
    this.formLiquid = defaultLiquid(this.selectedType().type); // the usual default of each kind, editable
  }

  isOther(): boolean {
    return this.selectedType().type === 'other';
  }

  isBank(): boolean {
    return this.selectedType().type === 'bank';
  }

  setCurrency(currency: AccountCurrency): void {
    this.formCurrency.set(currency);
  }

  isCash(): boolean {
    return this.selectedType().type === 'cash';
  }

  isCard(): boolean {
    return this.selectedType().type === 'card';
  }

  isDebit(): boolean {
    return this.formTypeKey() === 'debit';
  }

  isCredit(): boolean {
    return this.formTypeKey() === 'credit';
  }

  isLinked(): boolean {
    return this.isDebit() && !!this.formLinkedId();
  }

  selectBank(id: string): void {
    this.formBankId.set(id);
  }

  isValid(): boolean {
    if (!this.formName.trim()) return false;
    if (!this.isCash() && !this.isOther() && !this.formBankId()) return false;
    if (this.formLast4 && !/^\d{4}$/.test(this.formLast4.trim())) return false;
    return true;
  }

  save(): void {
    if (!this.isValid()) return;
    const selected = this.selectedType();
    const data = {
      name: this.formName.trim(),
      type: selected.type,
      cardKind: selected.cardKind,
      bankId: selected.type === 'cash' || selected.type === 'other' ? undefined : this.formBankId() || undefined,
      icon: selected.type === 'other' ? this.formIcon.trim() || undefined : undefined,
      liquid: this.formLiquid,
      bankKind: selected.type === 'bank' && this.formBankKind() ? (this.formBankKind() as BankAccountKind) : undefined,
      last4: selected.type === 'card' && this.formLast4.trim() ? this.formLast4.trim() : undefined,
      currency: this.formCurrency(),
      linkedAccountId: this.isDebit() && this.formLinkedId() ? this.formLinkedId() : undefined,
      // A linked debit card holds no money of its own
      initialBalance: this.isLinked() ? 0 : Number(this.formBalance) || 0,
    };
    if (this.editingId) {
      const change = this.openingChange();
      if (change) {
        const text = `${this.translate.instant('Balance now')} ${this.money(change.currency, change.before)} → ${this.money(change.currency, change.after)}. ${this.translate.instant('Change the opening balance?')}`;
        if (!confirm(text)) return;
      }
      const existing = this.accountService.byId(this.editingId);
      if (existing) this.accountService.update({ ...existing, ...data, icon: data.icon ?? existing.icon });
    } else {
      this.accountService.add(data);
    }
    this.cancelForm();
  }

  // Accounts with movements are archived, never deleted; an empty one can be deleted
  delete(): void {
    if (!this.editingId) return;
    if (this.accountService.accounts().length <= 1) {
      alert(this.translate.instant('You need at least one account.'));
      return;
    }
    if (!this.transactionService.canDeleteAccount(this.editingId)) {
      alert(this.translate.instant('This account has movements, so it cannot be deleted. Archive it instead: it disappears from lists and totals and keeps its history.'));
      return;
    }
    if (!confirm(this.translate.instant('Delete this empty account?'))) return;
    this.accountService.remove(this.editingId);
    this.cancelForm();
  }

  archive(): void {
    if (!this.editingId) return;
    if (this.accountService.activeAccounts().length <= 1) {
      alert(this.translate.instant('You need at least one account.'));
      return;
    }
    if (!confirm(this.translate.instant('Archive this account? It disappears from lists and totals and keeps its history.'))) return;
    this.accountService.setArchived(this.editingId, true);
    this.cancelForm();
  }

  unarchive(account: AccountModel): void {
    this.accountService.setArchived(account.id, false);
  }

  reconcile(account: AccountModel, event: Event): void {
    event.stopPropagation();
    this.router.navigate(['/reconcile', account.id]);
  }

  // ----- suggestions (nothing happens until the user confirms)

  isCreditCard(account: AccountModel): boolean {
    return isCreditCard(account);
  }

  openCard(account: AccountModel, event: Event): void {
    event.stopPropagation();
    this.router.navigate(['/card', account.id]);
  }

  convertCardPayment(s: CardPaymentSuggestion): void {
    const result = this.suggestions.convertCardPayment(s);
    this.message.set(this.translate.instant(result.ok ? 'Converted to a card payment. You can undo it in Settings → Change history.' : this.errorKey(result.error)));
  }

  dismissCardPayment(s: CardPaymentSuggestion): void {
    this.suggestions.dismissCardPayment(s);
  }

  describeExpense(id: string): string {
    const t = this.transactionService.byId(id);
    return t ? this.accountName(t.accountId) : '';
  }

  convertTransfer(s: TransferSuggestion): void {
    const result = this.suggestions.convertTransfer(s);
    this.message.set(result.ok ? this.translate.instant('Converted to a transfer. You can undo it in Settings → Change history.') : this.translate.instant(this.errorKey(result.error)));
  }

  dismissTransfer(s: TransferSuggestion): void {
    this.suggestions.dismissTransfer(s);
  }

  confirmIncome(s: IncomePatternSuggestion): void {
    this.suggestions.confirmIncome(s);
  }

  dismissIncome(s: IncomePatternSuggestion): void {
    this.suggestions.dismissIncome(s);
  }

  private errorKey(code: TxErrorCode): string {
    return code === 'reconciled' ? 'This movement is reconciled with your bank statement.' : 'These movements cannot be converted.';
  }

  viewTransactions(account: AccountModel, event: Event): void {
    event.stopPropagation();
    this.router.navigate(['/transactions'], { queryParams: { account: account.id } });
  }

  back(): void {
    history.back();
  }
}
