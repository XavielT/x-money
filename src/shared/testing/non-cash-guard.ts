// Rule 4 hook: a snapshot of everything that means "money you have or can count on". Any
// feature that is NOT cash (non-monetary benefits today; whatever the loan module treats as
// non-cash later) must leave it exactly as it was. Prompt 08 reuses it to assert that benefits
// never enter the payment capacity.
import { TestBed } from '@angular/core/testing';
import { AccountService } from '../services/account.service';
import { IncomeService } from '../services/income.service';
import { NetWorthService } from '../services/net-worth.service';
import { TransactionService } from '../services/transaction.service';

export function cashSnapshot(year: number, month: number) {
  const transactions = TestBed.inject(TransactionService);
  const accounts = TestBed.inject(AccountService);
  const income = TestBed.inject(IncomeService);
  const netWorth = TestBed.inject(NetWorthService);
  return {
    transactionCount: transactions.transactions().length,
    totalBalance: transactions.totalBalance(),
    totalBalanceUsd: transactions.totalBalanceUsd(),
    balances: accounts.accounts().map((a) => [a.id, transactions.accountBalance(a.id, 'DOP'), transactions.accountBalance(a.id, 'USD')]),
    netWorth: netWorth.summary(),
    monthSummary: transactions.monthSummary(year, month),
    breakdown: income.monthBreakdown(year, month),
    capacity: income.capacity(),
  };
}
