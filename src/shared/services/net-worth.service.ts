import { Injectable, computed } from '@angular/core';
import { AccountService } from './account.service';
import { TransactionService } from './transaction.service';
import { NetWorth, netWorth } from '../domain/networth';
import { BusinessService } from './business.service';
import { LoanService } from './loan.service';
import { round2 } from '../utils/money';

// Liquid net worth (cash + bank + savings by default) and net worth (minus credit card
// debt), per currency, with the breakdown of what adds up and what does not.
@Injectable({ providedIn: 'root' })
export class NetWorthService {
  summary = computed<NetWorth>(() => netWorth(this.accounts.accounts(), this.transactions.transactions(), { DOP: this.loans.totalOwed(), USD: 0 }));

  constructor(
    private accounts: AccountService,
    private transactions: TransactionService,
    private business: BusinessService,
    private loans: LoanService
  ) {}

  // Personal net worth and the commercial capital (inventory at cost) on SEPARATE lines; the
  // consolidated total adds them with the breakdown visible (rule 6). The inventory is never
  // mixed into the personal figure.
  consolidated = computed(() => {
    const personal = this.summary().net.DOP;
    const commercial = this.business.inventory().cost;
    return { personal, commercialCapital: commercial, total: round2(personal + commercial) };
  });
}
