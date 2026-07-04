import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
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

@Component({
  selector: 'app-accounts',
  standalone: true,
  imports: [CommonModule, FormsModule, BankBadge, TranslatePipe],
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
  ];

  bankKinds: { kind: BankAccountKind; label: string }[] = [
    { kind: 'checking', label: 'Checking account' },
    { kind: 'savings', label: 'Savings account' },
    { kind: 'payroll', label: 'Payroll account' },
  ];

  showForm = signal(false);
  editingId: string | null = null;
  formTypeKey = signal('bank');
  formBankId = signal('');
  formBankKind = signal<BankAccountKind | ''>('');
  formCurrency = signal<AccountCurrency>('DOP');
  formLinkedId = signal('');
  formName = '';
  formLast4 = '';
  formBalance: number | null = 0;
  bankSearch = signal('');

  constructor(
    private router: Router,
    private translate: TranslateService,
    public accountService: AccountService,
    public transactionService: TransactionService,
    public settings: SettingsService
  ) {}

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
    const typeOrder: Record<AccountType, number> = { cash: 0, bank: 1, savings: 2, card: 3 };
    return [...this.accountService.accounts()].sort((a, b) => {
      const bankA = this.bankName(a.bankId);
      const bankB = this.bankName(b.bankId);
      if (bankA !== bankB) return bankA.localeCompare(bankB);
      const orderDiff = (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9);
      if (orderDiff !== 0) return orderDiff;
      return a.name.localeCompare(b.name);
    });
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
    this.editingId = null;
    this.formTypeKey.set('bank');
    this.formBankId.set('');
    this.formBankKind.set('');
    this.formCurrency.set('DOP');
    this.formLinkedId.set('');
    this.formName = '';
    this.formLast4 = '';
    this.formBalance = 0;
    this.bankSearch.set('');
    this.showForm.set(true);
  }

  openEdit(account: AccountModel): void {
    this.editingId = account.id;
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
    this.bankSearch.set('');
    this.showForm.set(true);
  }

  cancelForm(): void {
    this.showForm.set(false);
    this.editingId = null;
  }

  setTypeKey(key: string): void {
    this.formTypeKey.set(key);
    if (key === 'cash') this.formBankId.set('');
    if (key !== 'bank') this.formBankKind.set('');
    if (key !== 'credit' && this.formCurrency() === 'dual') this.formCurrency.set('DOP');
    if (key !== 'debit') this.formLinkedId.set('');
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
    if (!this.isCash() && !this.formBankId()) return false;
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
      bankId: selected.type === 'cash' ? undefined : this.formBankId() || undefined,
      bankKind: selected.type === 'bank' && this.formBankKind() ? (this.formBankKind() as BankAccountKind) : undefined,
      last4: selected.type === 'card' && this.formLast4.trim() ? this.formLast4.trim() : undefined,
      currency: this.formCurrency(),
      linkedAccountId: this.isDebit() && this.formLinkedId() ? this.formLinkedId() : undefined,
      // A linked debit card holds no money of its own
      initialBalance: this.isLinked() ? 0 : Number(this.formBalance) || 0,
    };
    if (this.editingId) {
      const existing = this.accountService.byId(this.editingId);
      if (existing) this.accountService.update({ ...existing, ...data });
    } else {
      this.accountService.add(data);
    }
    this.cancelForm();
  }

  delete(): void {
    if (!this.editingId) return;
    if (this.accountService.accounts().length <= 1) {
      alert(this.translate.instant('You need at least one account.'));
      return;
    }
    if (!confirm(this.translate.instant('Remove this account? Its transactions will keep showing as "Unknown" account.'))) return;
    this.accountService.remove(this.editingId);
    this.cancelForm();
  }

  viewTransactions(account: AccountModel, event: Event): void {
    event.stopPropagation();
    this.router.navigate(['/transactions'], { queryParams: { account: account.id } });
  }

  back(): void {
    history.back();
  }
}
