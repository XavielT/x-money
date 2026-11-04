import { TransactionCurrency } from './transaction.model';

// Closed billing period of a credit card (one per card, currency and cut date). The open
// period is never stored: it is "not yet billed". Amounts are what the app calculated from
// the movements when it closed the period; the bank figures, when the user types them, win.
// What has been paid is NOT stored: it is derived from the card payments, so reversing a
// payment puts the statement back by itself.
export interface CardStatementModel {
  id: string; // stmt-<accountId>-<currency>-<cutDate>: the same on every device
  accountId: string;
  currency: TransactionCurrency;
  periodStart: string; // ISO yyyy-MM-dd, first day of the period
  periodEnd: string; // last day that belongs to it
  cutDate: string; // the cut itself (equals periodEnd unless purchases on the cut day go to the next one)
  dueDate: string;
  previousBalance: number; // owed at the start
  purchases: number;
  charges: number; // interest, fees and cash advances
  payments: number;
  credits: number; // refunds
  calculatedBalance: number; // owed at the end of the period, from the movements (can be < 0: balance in your favor)
  calculatedMinimum: number; // from the card's minimum-payment rule: an estimate
  bankBalance?: number; // typed by the user from the real statement
  bankMinimum?: number;
  interestTxId?: string; // expense registered for "the bank charged more than I recorded"
  generatedAt: string; // ISO timestamp
}

// 'open' (the period still running) is shown by the screens, never stored
export type StatementStatus = 'closed' | 'partial' | 'paid' | 'overdue';
