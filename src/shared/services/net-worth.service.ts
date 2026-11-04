import { Injectable, computed } from '@angular/core';
import { AccountService } from './account.service';
import { TransactionService } from './transaction.service';
import { NetWorth, netWorth } from '../domain/networth';

// Liquid net worth (cash + bank + savings by default) and net worth (minus credit card
// debt), per currency, with the breakdown of what adds up and what does not.
@Injectable({ providedIn: 'root' })
export class NetWorthService {
  summary = computed<NetWorth>(() => netWorth(this.accounts.accounts(), this.transactions.transactions()));

  constructor(
    private accounts: AccountService,
    private transactions: TransactionService
  ) {}
}
