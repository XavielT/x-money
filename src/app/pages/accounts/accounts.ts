import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AccountModel, AccountType } from '../../../shared/models/account.model';
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
  accountTypes: { type: AccountType; icon: string; label: string }[] = [
    { type: 'cash', icon: '💵', label: 'Cash' },
    { type: 'bank', icon: '🏦', label: 'Bank account' },
    { type: 'card', icon: '💳', label: 'Card' },
    { type: 'savings', icon: '💰', label: 'Savings' },
  ];

  showForm = signal(false);
  editingId: string | null = null;
  formType = signal<AccountType>('bank');
  formBankId = signal('');
  formName = '';
  formLast4 = '';
  formBalance: number | null = 0;

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

  typeLabel(type: AccountType): string {
    return this.translate.instant(this.accountTypes.find((t) => t.type === type)?.label ?? type);
  }

  balanceOf(id: string): number {
    return this.transactionService.accountBalance(id);
  }

  openAdd(): void {
    this.editingId = null;
    this.formType.set('bank');
    this.formBankId.set('');
    this.formName = '';
    this.formLast4 = '';
    this.formBalance = 0;
    this.showForm.set(true);
  }

  openEdit(account: AccountModel): void {
    this.editingId = account.id;
    this.formType.set(account.type);
    this.formBankId.set(account.bankId ?? '');
    this.formName = account.name;
    this.formLast4 = account.last4 ?? '';
    this.formBalance = account.initialBalance;
    this.showForm.set(true);
  }

  cancelForm(): void {
    this.showForm.set(false);
    this.editingId = null;
  }

  setType(type: AccountType): void {
    this.formType.set(type);
    if (type === 'cash') this.formBankId.set('');
  }

  selectBank(id: string): void {
    this.formBankId.set(id);
  }

  isValid(): boolean {
    if (!this.formName.trim()) return false;
    if (this.formType() !== 'cash' && !this.formBankId()) return false;
    if (this.formLast4 && !/^\d{4}$/.test(this.formLast4.trim())) return false;
    return true;
  }

  save(): void {
    if (!this.isValid()) return;
    const type = this.formType();
    const data = {
      name: this.formName.trim(),
      type,
      bankId: type === 'cash' ? undefined : this.formBankId() || undefined,
      last4: type === 'card' && this.formLast4.trim() ? this.formLast4.trim() : undefined,
      initialBalance: Number(this.formBalance) || 0,
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
