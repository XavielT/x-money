// Smart capture (2.18.0). A capture NEVER writes a movement: it produces a draft that waits in the
// review tray until the user approves it (rule 11). Everything in a draft came from an untrusted
// document, a transcript or an email, so it is only ever a proposal.
import { TransactionCurrency } from './transaction.model';

export type CaptureSource = 'image' | 'pdf' | 'voice' | 'text' | 'email';
export type CaptureStatus = 'queued' | 'pending' | 'approved' | 'rejected' | 'duplicate' | 'failed';
export type CaptureKind = 'expense' | 'income' | 'card_payment' | 'internal_transfer' | 'loan_payment' | 'goal_contribution' | 'invoice_purchase' | 'unknown';

export const CAPTURE_KINDS: readonly CaptureKind[] = ['expense', 'income', 'card_payment', 'internal_transfer', 'loan_payment', 'goal_contribution', 'invoice_purchase', 'unknown'];

// Why a field is highlighted in the tray
export type CaptureDoubt =
  | 'amount-unverified' // text modes: the amount is not in the text it was read from
  | 'amount-missing'
  | 'amount-large' // above the confirmation threshold
  | 'currency-ambiguous'
  | 'date-missing'
  | 'date-assumed'
  | 'date-future'
  | 'account-ambiguous'
  | 'account-missing'
  | 'kind-unknown'
  | 'sender-mismatch' // email whose sender is not in the user's filter
  | 'possible-duplicate';

export interface CaptureLine {
  description: string;
  quantity?: number;
  amountMinor?: number;
}

export interface CaptureDraft {
  id: string;
  createdAt: string;
  source: CaptureSource;
  status: CaptureStatus;
  kind: CaptureKind;

  // proposed fields (the user can edit all of them)
  amountMinor?: number; // whole cents, calculated here from the text the model read
  currency?: TransactionCurrency;
  occurredAt?: string; // ISO yyyy-MM-dd
  occurredTime?: string; // HH:mm when the document shows one
  counterparty?: string; // merchant or whoever deposited
  description?: string;
  bankName?: string;
  accountLast4?: string; // only 4 digits are ever kept
  reference?: string;
  categoryCandidate?: string;
  invoiceNumber?: string;
  taxId?: string; // RNC
  fiscalNumber?: string; // NCF
  taxAmountMinor?: number; // ITBIS: data, not another expense
  subtotalMinor?: number;
  lines?: CaptureLine[]; // at most 30
  confidence: Record<string, number>; // per field, 0 to 1
  notes?: string; // what the reader could not read
  doubts: CaptureDoubt[];

  // resolved locally against the user's own data
  resolvedAccountId?: string;
  resolvedToAccountId?: string; // destination of a transfer, the card of a card payment
  resolvedCategoryId?: string;
  resolvedIncomeSourceId?: string;
  resolvedGoalId?: string;
  resolvedLoanId?: string;
  asBusiness?: boolean; // invoice purchase of inventory for the business module (06)

  // duplicate control
  dedupeKey?: string;
  fileFingerprint?: string;
  duplicateOf?: { type: 'draft' | 'transaction'; id: string };

  // email only: who sent it and when (shown next to the draft), and the message id for the cursor
  sender?: string;
  sentAt?: string;
  messageId?: string;

  // outcome
  createdMovementIds?: string[];
  reviewedAt?: string;
  failure?: string; // short code of the failure, never the content
  hasReceipt?: boolean; // a local thumbnail was kept (device only, never synced)
}

export const MAX_LINES = 30;
export const MAX_DRAFTS_PER_CAPTURE = 20;
