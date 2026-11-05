import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AccountModel } from '../../../shared/models/account.model';
import { TransactionItem } from '../../../shared/components/transaction-item/transaction-item';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { BankBadge } from '../../../shared/ui/bank-badge/bank-badge';
import { AccountService } from '../../../shared/services/account.service';
import { SettingsService } from '../../../shared/services/settings.service';
import { TransactionService } from '../../../shared/services/transaction.service';
import { isCreditCard } from '../../../shared/domain/cards';
import { bankById } from '../../../shared/data/banks';

const RECENT = 30;

// One account: its balance, its latest movements (the ones that leave it and the ones that arrive) and what
// can be done with it. A credit card has its own page (statements, payments), so it is sent there.
@Component({
  selector: 'app-account-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe, BankBadge, TransactionItem],
  templateUrl: './account-detail.html',
  styleUrl: './account-detail.scss',
})
export class AccountDetailComponent {
  id: string;
  account = signal<AccountModel | undefined>(undefined);
  showAll = signal(false);

  // movements of this account, newest first: it is the origin or the destination of the movement
  movements = computed(() => this.transactions.sorted().filter((t) => t.accountId === this.id || t.toAccountId === this.id));
  recent = computed(() => (this.showAll() ? this.movements() : this.movements().slice(0, RECENT)));

  constructor(
    route: ActivatedRoute,
    private router: Router,
    public accounts: AccountService,
    public transactions: TransactionService,
    public settings: SettingsService
  ) {
    this.id = route.snapshot.paramMap.get('id') ?? '';
    const found = this.accounts.byId(this.id);
    if (found && isCreditCard(found)) {
      void this.router.navigate(['/card', found.id], { replaceUrl: true });
      return;
    }
    this.account.set(found);
  }

  bankName(): string {
    return bankById(this.account()?.bankId)?.name ?? '';
  }

  hasUsd(): boolean {
    const a = this.account();
    return !!a && (a.currency === 'USD' || a.currency === 'dual');
  }

  hasDop(): boolean {
    const a = this.account();
    return !!a && a.currency !== 'USD';
  }

  balance(currency: 'DOP' | 'USD'): number {
    return this.transactions.accountBalance(this.id, currency);
  }

  abs(value: number): number {
    return Math.abs(value);
  }

  back(): void {
    history.back();
  }
}
