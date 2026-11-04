import { Injectable, computed } from '@angular/core';
import { AccountService } from './account.service';
import { AuditLogService } from './audit-log.service';
import { SettingsService } from './settings.service';
import { TransactionService } from './transaction.service';
import { TransferSuggestion, detectUnmarkedTransfers } from '../domain/transfers';
import { IncomePatternSuggestion, detectRecurringIncomes } from '../domain/income-patterns';
import { TxResult } from '../domain/validation';

// Suggestions are computed from the data on every change and only ever ACT after the user
// confirms: nothing is converted or tagged on its own.
@Injectable({ providedIn: 'root' })
export class SuggestionsService {
  transfers = computed<TransferSuggestion[]>(() =>
    detectUnmarkedTransfers(this.transactions.transactions(), this.accounts.accounts(), this.settings.suggestions().transferDismissed)
  );

  incomes = computed<IncomePatternSuggestion[]>(() => {
    const memory = this.settings.suggestions();
    return detectRecurringIncomes(this.transactions.transactions(), this.accounts.accounts(), [...memory.incomeDismissed, ...memory.incomeConfirmed]);
  });

  constructor(
    private transactions: TransactionService,
    private accounts: AccountService,
    private settings: SettingsService,
    private audit: AuditLogService
  ) {}

  // "Is this a transfer between your accounts?" -> yes
  convertTransfer(s: TransferSuggestion): TxResult {
    return this.transactions.convertToTransfer(s.expenseId, s.incomeId);
  }

  dismissTransfer(s: TransferSuggestion): void {
    this.settings.dismissTransferSuggestion(s.key);
  }

  // "Looks like a recurring income (payroll?)" -> yes: tag it so prompt 03 can link it to a source
  confirmIncome(s: IncomePatternSuggestion): void {
    this.transactions.tagIncomePattern(s.txIds, s.key);
    this.settings.confirmIncomeSuggestion(s.key);
    this.audit.log({
      type: 'income-pattern',
      entity: 'account',
      entityId: s.accountId,
      accountId: s.accountId,
      after: { key: s.key, cadence: s.cadence, amount: s.amount, count: s.count },
    });
  }

  dismissIncome(s: IncomePatternSuggestion): void {
    this.settings.dismissIncomeSuggestion(s.key);
  }
}
