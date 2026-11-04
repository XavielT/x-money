import { Injectable, computed } from '@angular/core';
import { AccountService } from './account.service';
import { AuditLogService } from './audit-log.service';
import { SettingsService } from './settings.service';
import { TransactionService } from './transaction.service';
import { TransferSuggestion, detectUnmarkedTransfers } from '../domain/transfers';
import { IncomePatternSuggestion, detectRecurringIncomes } from '../domain/income-patterns';
import { TxResult } from '../domain/validation';
import { CardPaymentSuggestion, detectCardPaymentExpenses } from '../domain/card-payments';
import { CreditCardService } from './credit-card.service';

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

  // Rule 3: expenses that look like the payment of a card statement
  cardPayments = computed<CardPaymentSuggestion[]>(() =>
    detectCardPaymentExpenses(
      this.transactions.transactions(),
      this.accounts.accounts(),
      this.cards.statements(),
      (s) => this.cards.paidAfterCut(s),
      this.settings.suggestions().transferDismissed
    )
  );

  constructor(
    private transactions: TransactionService,
    private accounts: AccountService,
    private settings: SettingsService,
    private audit: AuditLogService,
    private cards: CreditCardService
  ) {}

  // "Is this a transfer between your accounts?" -> yes
  convertTransfer(s: TransferSuggestion): TxResult {
    return this.transactions.convertToTransfer(s.expenseId, s.incomeId);
  }

  // "Was this the payment of your card?" -> yes: the expense becomes a payment to the card
  convertCardPayment(s: CardPaymentSuggestion): TxResult {
    return this.transactions.convertToCardPayment(s.expenseId, s.cardId);
  }

  dismissCardPayment(s: CardPaymentSuggestion): void {
    this.settings.dismissTransferSuggestion(s.key);
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
