import { Injectable } from '@angular/core';
import { TransactionCurrency } from '../models/transaction.model';
import { AccountService } from './account.service';
import { AuditLogService } from './audit-log.service';
import { TransactionService } from './transaction.service';
import { ReconcileView, adjustmentFor, reconcileView } from '../domain/reconcile';
import { TxResult } from '../domain/validation';

export const ADJUSTMENT_CATEGORY = 'cat-recon-adjustment';

// Reconciliation of an account against its bank statement. A difference is never adjusted
// silently: the user sees it, can review movements, or create a visible, audited adjustment.
@Injectable({ providedIn: 'root' })
export class ReconciliationService {
  constructor(
    private accounts: AccountService,
    private transactions: TransactionService,
    private audit: AuditLogService
  ) {}

  view(accountId: string, currency: TransactionCurrency, date: string, bankBalance: number): ReconcileView {
    const account = this.accounts.byId(accountId);
    return reconcileView(this.accounts.accounts(), this.transactions.transactions(), accountId, currency, date, bankBalance, account?.reconciledAt);
  }

  // Creates the adjustment movement for a difference. It is excluded from income/expense
  // statistics (origin 'adjustment') but it is a real movement: balances include it.
  createAdjustment(accountId: string, currency: TransactionCurrency, date: string, difference: number): TxResult | null {
    const adjustment = adjustmentFor(difference);
    if (!adjustment) return null;
    const result = this.transactions.add({
      type: adjustment.type,
      amount: adjustment.amount,
      accountId,
      currency,
      date,
      categoryId: ADJUSTMENT_CATEGORY,
      note: 'Reconciliation adjustment',
      origin: 'adjustment',
    });
    if (result.ok) {
      this.audit.log({
        type: 'balance-adjustment',
        entity: 'transaction',
        entityId: result.id,
        accountId,
        after: { difference, type: adjustment.type, amount: adjustment.amount, date },
        origin: 'reconciliation',
      });
    }
    return result;
  }

  // Marks the ticked movements as seen on the statement and stamps the account
  complete(accountId: string, date: string, markedIds: readonly string[], bankBalance: number, difference: number): void {
    this.transactions.setReconciled(markedIds, true);
    this.accounts.setReconciledAt(accountId, date);
    this.audit.log({
      type: 'reconcile',
      entity: 'account',
      entityId: accountId,
      accountId,
      after: { date, bankBalance, difference, marked: markedIds.length },
      origin: 'reconciliation',
    });
  }
}
