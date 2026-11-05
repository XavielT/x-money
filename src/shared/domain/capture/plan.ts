// What approving a draft would do, as a list of operations the services run through the SAME
// functions as every other entry point (movements, card payments, goals, loans, business). Pure:
// no operation here touches storage, and a draft with an essential field empty or ambiguous gives no
// plan at all, so it can never be approved by accident (principle 1 and rule 11).
import { AccountModel, AccountType, BankAccountKind, CardKind } from '../../models/account.model';
import { CaptureDraft } from '../../models/capture-draft.model';
import { TransactionCurrency } from '../../models/transaction.model';
import { isValidIsoDate } from '../dates';
import { majorOf } from './amount';

export type MissingField =
  | 'kind'
  | 'amount'
  | 'currency'
  | 'date'
  | 'account'
  | 'to-account'
  | 'same-account'
  | 'category'
  | 'goal'
  | 'loan'
  | 'currency-mismatch'
  | 'currency-unsupported' // goals and the business module are RD$ only for now
  | 'confirm-large'
  | 'account-type'
  | 'account-name'
  | 'balance'
  | 'already-approved';

// The account a screenshot of a bank product creates. The balance is the OPENING balance: nothing is written
// as a movement, and every later balance still comes from the movements (rule 9).
export interface NewAccountSpec {
  name: string;
  type: AccountType;
  cardKind?: CardKind;
  bankKind?: BankAccountKind;
  bankId?: string;
  last4?: string;
  currency: TransactionCurrency;
  initialBalance: number; // a credit card holds what is OWED as a negative balance
  creditLimit?: number;
}

export function accountSpecOf(d: CaptureDraft): NewAccountSpec {
  const t = d.accountType ?? 'other';
  const type: AccountType = t === 'credit_card' || t === 'debit_card' ? 'card' : t === 'savings' ? 'savings' : t === 'other' ? 'other' : 'bank';
  const currency = d.currency ?? 'DOP';
  const balance = majorOf(d.balanceMinor ?? 0);
  const name = (d.accountName ?? '').trim() || [d.bankName, d.accountLast4 ? '·' + d.accountLast4 : ''].filter(Boolean).join(' ').trim();
  const spec: NewAccountSpec = {
    name: name.slice(0, 40),
    type,
    bankId: d.resolvedBankId,
    last4: d.accountLast4,
    currency,
    initialBalance: t === 'credit_card' ? -balance : balance,
  };
  if (t === 'credit_card') spec.cardKind = 'credit';
  if (t === 'debit_card') spec.cardKind = 'debit';
  if (t === 'checking' || t === 'payroll') spec.bankKind = t;
  if (t === 'credit_card' && d.creditLimitMinor) spec.creditLimit = majorOf(d.creditLimitMinor);
  return spec;
}

export type CaptureOp =
  | { t: 'new-account'; account: NewAccountSpec }
  | { t: 'transaction'; tx: { type: 'expense' | 'income' | 'transfer'; amount: number; accountId: string; toAccountId?: string; currency: TransactionCurrency; date: string; categoryId?: string; incomeSourceId?: string; note?: string } }
  | { t: 'card-payment'; cardId: string; fromAccountId: string; amount: number; date: string; currency: TransactionCurrency; note?: string }
  | { t: 'goal-entry'; goalId: string; amount: number; date: string; note?: string }
  | { t: 'loan-payment'; loanId: string; accountId: string; amount: number; date: string; note?: string }
  | { t: 'business-purchase'; name: string; totalCost: number; date: string; accountId: string; supplier?: string; notes?: string };

export interface PlanContext {
  accounts: readonly AccountModel[];
  defaultIncomeCategory: (sourceId: string | undefined) => string;
  confirmLarge?: boolean;
  largeAbove?: number;
}

const accepts = (a: AccountModel | undefined, c: TransactionCurrency): boolean => {
  const cur = a?.currency ?? 'DOP';
  return cur === 'dual' || cur === c;
};

// The note a movement gets: who, and the reference of the bank when there is one
export function noteOf(d: CaptureDraft): string | undefined {
  const who = (d.counterparty ?? d.description ?? '').trim();
  const ref = d.reference ? `ref ${d.reference}` : '';
  const note = [who, ref].filter(Boolean).join(' · ');
  return note ? note.slice(0, 120) : undefined;
}

export function missingFor(d: CaptureDraft, ctx: Pick<PlanContext, 'accounts' | 'confirmLarge' | 'largeAbove'>): MissingField[] {
  const out: MissingField[] = [];
  if (d.status === 'approved') return ['already-approved'];
  if (d.kind === 'account_setup') {
    // an account needs its type, its currency, its name and an opening balance (0 is fine, but it must be said)
    if (!d.accountType) out.push('account-type');
    if (!d.currency) out.push('currency');
    if (!((d.accountName ?? '').trim() || d.bankName)) out.push('account-name');
    if (d.balanceMinor === undefined || d.balanceMinor < 0) out.push('balance');
    if (d.balanceMinor !== undefined && majorOf(d.balanceMinor) > (ctx.largeAbove ?? 50_000_000) && !ctx.confirmLarge) out.push('confirm-large');
    return out;
  }
  if (d.kind === 'unknown') out.push('kind');
  if (!d.amountMinor || d.amountMinor <= 0) out.push('amount');
  if (!d.currency) out.push('currency');
  if (!d.occurredAt || !isValidIsoDate(d.occurredAt)) out.push('date');
  if (d.amountMinor && majorOf(d.amountMinor) > (ctx.largeAbove ?? 50_000_000) && !ctx.confirmLarge) out.push('confirm-large');

  const byId = (id: string | undefined) => ctx.accounts.find((a) => a.id === id && !a.archived);
  const from = byId(d.resolvedAccountId);
  const to = byId(d.resolvedToAccountId);
  const needsFrom = d.kind !== 'unknown' && d.kind !== 'goal_contribution';
  if (needsFrom && !from) out.push('account');
  if ((d.kind === 'internal_transfer' || d.kind === 'card_payment') && !to) out.push('to-account');
  if (from && to && from.id === to.id) out.push('same-account');
  if (d.currency) {
    if (from && !accepts(from, d.currency)) out.push('currency-mismatch');
    if (to && !accepts(to, d.currency) && !out.includes('currency-mismatch')) out.push('currency-mismatch');
    if ((d.kind === 'goal_contribution' || d.asBusiness) && d.currency !== 'DOP') out.push('currency-unsupported');
  }
  if ((d.kind === 'expense' || d.kind === 'invoice_purchase') && !d.resolvedCategoryId && !d.asBusiness) out.push('category');
  if (d.kind === 'goal_contribution' && !d.resolvedGoalId) out.push('goal');
  if (d.kind === 'loan_payment' && !d.resolvedLoanId) out.push('loan');
  return out;
}

export function planApproval(d: CaptureDraft, ctx: PlanContext): { ok: true; ops: CaptureOp[] } | { ok: false; missing: MissingField[] } {
  const missing = missingFor(d, ctx);
  if (missing.length) return { ok: false, missing };
  if (d.kind === 'account_setup') return { ok: true, ops: [{ t: 'new-account', account: accountSpecOf(d) }] };
  const amount = majorOf(d.amountMinor!);
  const currency = d.currency!;
  const date = d.occurredAt!;
  const note = noteOf(d);
  const accountId = d.resolvedAccountId!;

  switch (d.kind) {
    case 'expense':
      return { ok: true, ops: [{ t: 'transaction', tx: { type: 'expense', amount, accountId, currency, date, categoryId: d.resolvedCategoryId, note } }] };
    case 'income':
      return {
        ok: true,
        ops: [{ t: 'transaction', tx: { type: 'income', amount, accountId, currency, date, categoryId: d.resolvedCategoryId ?? ctx.defaultIncomeCategory(d.resolvedIncomeSourceId), incomeSourceId: d.resolvedIncomeSourceId, note } }],
      };
    case 'internal_transfer':
      return { ok: true, ops: [{ t: 'transaction', tx: { type: 'transfer', amount, accountId, toAccountId: d.resolvedToAccountId, currency, date, note } }] };
    case 'card_payment':
      return { ok: true, ops: [{ t: 'card-payment', cardId: d.resolvedToAccountId!, fromAccountId: accountId, amount, date, currency, note }] };
    case 'goal_contribution':
      return { ok: true, ops: [{ t: 'goal-entry', goalId: d.resolvedGoalId!, amount, date, note }] };
    case 'loan_payment':
      return { ok: true, ops: [{ t: 'loan-payment', loanId: d.resolvedLoanId!, accountId, amount, date, note }] };
    case 'invoice_purchase':
      // one expense for the TOTAL (the tax stays as data, never a second expense). Marked as the
      // business's: it goes through the inventory purchase of the business module instead.
      if (d.asBusiness) return { ok: true, ops: [{ t: 'business-purchase', name: (d.counterparty ?? d.description ?? 'Invoice').slice(0, 60), totalCost: amount, date, accountId, supplier: d.counterparty, notes: note }] };
      return { ok: true, ops: [{ t: 'transaction', tx: { type: 'expense', amount, accountId, currency, date, categoryId: d.resolvedCategoryId, note } }] };
    default:
      return { ok: false, missing: ['kind'] };
  }
}
