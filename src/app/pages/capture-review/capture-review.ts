import { Component, computed, effect, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ACCOUNT_SETUP_TYPES, AccountSetupType, CAPTURE_KINDS, CaptureDoubt, CaptureDraft, CaptureKind } from '../../../shared/models/capture-draft.model';
import { BANKS_MOCK } from '../../../shared/data/banks';
import { TransactionCurrency } from '../../../shared/models/transaction.model';
import { majorOf, minorOf } from '../../../shared/domain/capture/amount';
import { bankBalanceOf, pendingEffect } from '../../../shared/domain/capture/balance-check';
import { MissingField, missingFor } from '../../../shared/domain/capture/plan';
import { subMoney } from '../../../shared/utils/money';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { AccountService } from '../../../shared/services/account.service';
import { whatOthersAdd } from '../../../shared/domain/capture/details';
import { CaptureService } from '../../../shared/services/capture.service';
import { CategoryService } from '../../../shared/services/category.service';
import { GoalService } from '../../../shared/services/goal.service';
import { IncomeSourceService } from '../../../shared/services/income-source.service';
import { LoanService } from '../../../shared/services/loan.service';
import { ReconciliationService } from '../../../shared/services/reconciliation.service';
import { TranslateService } from '../../../shared/services/translate.service';

const KIND_LABELS: Record<CaptureKind, string> = {
  expense: 'Expense',
  income: 'Income',
  card_payment: 'Card payment',
  internal_transfer: 'Transfer between my accounts',
  loan_payment: 'Loan payment',
  goal_contribution: 'Goal contribution',
  invoice_purchase: 'Invoice purchase',
  account_setup: 'New account',
  balance_check: 'Balance check',
  unknown: 'Not recognized',
};

const ACCOUNT_TYPE_LABELS: Record<AccountSetupType, string> = {
  checking: 'Checking account',
  savings: 'Savings account',
  payroll: 'Payroll account',
  credit_card: 'Credit card',
  debit_card: 'Debit card',
  other: 'Other account',
};

const DOUBT_LABELS: Record<CaptureDoubt, string> = {
  'amount-unverified': 'The amount is not in the original text: check it.',
  'amount-missing': 'The amount could not be read: enter it.',
  'amount-large': 'Unusually large amount: confirm it is right.',
  'currency-ambiguous': 'The currency is not clear: choose it.',
  'date-missing': 'No date was found: choose it.',
  'date-assumed': 'No date was found: today was assumed.',
  'date-future': 'The date is in the future: check it.',
  'account-ambiguous': 'More than one account could match: choose it.',
  'account-missing': 'No account matched: choose it.',
  'kind-unknown': 'The type was not recognized: choose it.',
  'sender-mismatch': 'The sender does not match your filter.',
  'possible-duplicate': 'This looks like something already registered.',
  'account-exists': 'You already have an account with these last 4 digits.',
  'balance-missing': 'The balance could not be read: enter it (0 is fine).',
  'direction-conflict': 'The sign or arrow says the money went the other way: choose the type.',
  'kind-inferred': 'The type was chosen from the sign and the wording: check it.',
  'transfer-pair': 'This looks like the other side of another capture: combine them as one transfer.',
  'amount-estimated': 'The notice shows no amount: this is your usual payroll. Check it against your bank.',
};

const MISSING_LABELS: Record<MissingField, string> = {
  kind: 'Choose the type.',
  amount: 'Enter the amount.',
  currency: 'Choose the currency.',
  date: 'Enter a valid date.',
  account: 'Choose the account.',
  'to-account': 'Choose the other account.',
  'same-account': 'The two accounts must be different.',
  category: 'Choose a category.',
  goal: 'Choose the goal.',
  loan: 'Choose the loan.',
  'currency-mismatch': 'The account does not hold that currency.',
  'currency-unsupported': 'Goals and the business are in RD$ only for now.',
  'confirm-large': 'Confirm the large amount.',
  'already-approved': 'Already approved.',
  'account-type': 'Choose the type of account.',
  'account-name': 'Give the account a name.',
  balance: 'Enter the opening balance (0 is fine).',
  'balance-account': 'Choose the account this balance is about.',
};

// The review tray: where every capture waits. The user edits, approves or rejects; there is no
// automatic approval and no "approve all" without marking the ones to approve.
@Component({
  selector: 'app-capture-review',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe],
  templateUrl: './capture-review.html',
  styleUrl: './capture-review.scss',
})
export class CaptureReviewComponent {
  kinds = CAPTURE_KINDS.filter((k) => k !== 'balance_check'); // only this device makes a balance check
  accountTypes = ACCOUNT_SETUP_TYPES;
  banks = BANKS_MOCK.filter((b) => b.id !== 'other');
  open = signal<string | null>(null);
  marked = signal<Set<string>>(new Set());
  message = signal('');
  notice = signal('');
  confirmLarge = signal<Set<string>>(new Set());
  showHistory = signal(false);

  list = computed(() => [...this.capture.drafts.pending()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  queued = computed(() => this.capture.drafts.queued());
  stale = computed(() => this.capture.drafts.stale().length);

  constructor(
    public capture: CaptureService,
    public accounts: AccountService,
    public categories: CategoryService,
    public sources: IncomeSourceService,
    public goals: GoalService,
    public loans: LoanService,
    private translate: TranslateService,
    private reconciliation: ReconciliationService
  ) {
    // when the tray opens, and whenever the user's accounts change (a card added after its notice arrived),
    // drafts that were waiting for an account that did not exist get it
    effect(() => {
      this.accounts.accounts();
      untracked(() => this.capture.rematch());
    });
    // and when the user creates or edits an income source, the payroll notices that wait for it get their usual amount (an estimate)
    effect(() => {
      this.sources.active();
      untracked(() => this.capture.estimateWaitingIncome());
    });
  }

  t(key: string): string {
    return this.translate.instant(key);
  }

  // keep each card's DOM while its draft is edited (every edit makes a new object): the field being typed in keeps its focus
  trackById(_: number, d: CaptureDraft): string {
    return d.id;
  }

  // What the other drafts of the same purchase would add to this one when it is registered (items, invoice, ...)
  addsText(d: CaptureDraft): string {
    const labels: Record<string, string> = { lines: 'Items', invoiceNumber: 'Invoice', fiscalNumber: 'NCF', taxId: 'RNC', subtotal: 'Subtotal', tax: 'ITBIS', reference: 'Reference' };
    return whatOthersAdd(d, this.capture.drafts.pending())
      .map((k) => this.t(labels[k]))
      .join(', ');
  }

  // the way a capture came in, in words (never the internal value)
  sourceLabel(s: string): string {
    const labels: Record<string, string> = { image: 'Photo or screenshot', pdf: 'PDF', voice: 'Voice', text: 'Text', email: 'Email', notification: 'Bank app notice' };
    return labels[s] ?? 'Capture';
  }

  kindLabel(k: CaptureKind): string {
    return KIND_LABELS[k];
  }

  doubtLabel(d: CaptureDoubt): string {
    return DOUBT_LABELS[d];
  }

  // major units for the input; empty when unknown
  amountOf(d: CaptureDraft): number | null {
    return d.amountMinor ? majorOf(d.amountMinor) : null;
  }

  // the amount as shown in the list: the symbol only when the currency is known, a question mark when there is no amount
  accountTypeLabel(t: AccountSetupType): string {
    return ACCOUNT_TYPE_LABELS[t];
  }

  // "Banreservas · ····7107 · Checking account": enough to tell two accounts of the same bank apart
  accountSub(d: CaptureDraft): string {
    const bank = d.resolvedBankId ? this.banks.find((b) => b.id === d.resolvedBankId)?.name : undefined;
    return [bank, d.accountLast4 ? '····' + d.accountLast4 : undefined, d.accountType ? this.t(ACCOUNT_TYPE_LABELS[d.accountType]) : this.t('New account')].filter(Boolean).join(' · ');
  }

  // the balance of an account, in major units for the input
  balanceOf(d: CaptureDraft): number | null {
    return d.balanceMinor === undefined ? null : d.balanceMinor / 100;
  }

  setBalance(d: CaptureDraft, value: number | string | null): void {
    const n = Number(value);
    this.capture.edit(d.id, { balanceMinor: value !== null && value !== '' && Number.isFinite(n) && n >= 0 ? minorOf(n) : undefined });
  }

  setLimit(d: CaptureDraft, value: number | string | null): void {
    const n = Number(value);
    this.capture.edit(d.id, { creditLimitMinor: Number.isFinite(n) && n > 0 ? minorOf(n) : undefined });
  }

  setLast4(d: CaptureDraft, value: string): void {
    const digits = (value ?? '').replace(/\D/g, '').slice(-4);
    this.capture.edit(d.id, { accountLast4: digits.length === 4 ? digits : undefined });
  }

  // Bank balance against the app's own, as of the day the balance was true. `left` is what would still differ once the captures
  // that wait in this tray are approved (a transfer or a purchase not registered yet explains part of any difference).
  check(d: CaptureDraft): { bank: number; app: number; difference: number; waiting: number; left: number; currency: TransactionCurrency } | null {
    const acc = this.accounts.byId(d.resolvedAccountId ?? '');
    const bank = bankBalanceOf(d, acc);
    if (!acc || bank === null || !d.currency || !d.occurredAt) return null;
    const v = this.reconciliation.view(acc.id, d.currency, d.occurredAt, bank);
    const waiting = pendingEffect(this.capture.drafts.pending(), acc.id, d.currency);
    return { bank, app: v.calculated, difference: v.difference, waiting, left: subMoney(v.difference, waiting), currency: d.currency };
  }

  money(v: number, c: TransactionCurrency | undefined): string {
    return (c === 'USD' ? 'US$' : 'RD$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  amountLabel(d: CaptureDraft): string {
    if (d.kind === 'account_setup' || d.kind === 'balance_check') {
      if (d.balanceMinor === undefined) return '?';
      const sym = d.currency === 'USD' ? 'US$' : d.currency === 'DOP' ? 'RD$' : '';
      return sym + (d.balanceMinor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (!d.amountMinor) return '?';
    const symbol = d.currency === 'USD' ? 'US$' : d.currency === 'DOP' ? 'RD$' : '';
    return symbol + (d.amountMinor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  missing(d: CaptureDraft): MissingField[] {
    return missingFor(d, { accounts: this.accounts.accounts(), confirmLarge: this.confirmLarge().has(d.id) });
  }

  missingLabel(m: MissingField): string {
    return MISSING_LABELS[m];
  }

  isLarge(d: CaptureDraft): boolean {
    return this.missing(d).includes('confirm-large');
  }

  toggleOpen(id: string): void {
    this.open.set(this.open() === id ? null : id);
  }

  toggleMark(id: string): void {
    const next = new Set(this.marked());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.marked.set(next);
  }

  setLargeConfirmed(id: string, on: boolean): void {
    const next = new Set(this.confirmLarge());
    if (on) next.add(id);
    else next.delete(id);
    this.confirmLarge.set(next);
  }

  // ----- editing: every change is saved at once; a field the user fixed is no longer in doubt

  setAmount(d: CaptureDraft, value: number | string | null): void {
    const n = Number(value);
    this.capture.edit(d.id, { amountMinor: Number.isFinite(n) && n > 0 ? minorOf(n) : undefined });
  }

  setBankFee(d: CaptureDraft, value: number | string | null): void {
    const n = Number(value);
    this.capture.edit(d.id, { bankFeeMinor: value !== null && value !== '' && Number.isFinite(n) && n > 0 ? minorOf(n) : undefined });
  }

  setField(d: CaptureDraft, patch: Partial<CaptureDraft>): void {
    this.capture.edit(d.id, patch);
    // the account chosen for one row of a screenshot is the account of the rest of its rows
    if (patch.resolvedAccountId) this.capture.applyAccountToSiblings(d.id);
  }

  setCurrency(d: CaptureDraft, c: TransactionCurrency): void {
    this.capture.edit(d.id, { currency: c });
  }

  // ----- decisions

  approve(d: CaptureDraft): void {
    this.message.set('');
    this.notice.set('');
    const r = this.capture.approve(d.id, { confirmLarge: this.confirmLarge().has(d.id) });
    if (r.ok) {
      this.notice.set(this.t(d.kind === 'balance_check' ? 'Done. If there was a difference, it is an adjustment you can see in the history.' : d.kind === 'account_setup' ? 'Account created. Its balance is the opening balance: you can edit or archive it in Accounts.' : 'Registered. You can reverse it from the history like any movement.'));
      this.open.set(null);
    } else if ('missing' in r) this.message.set(r.missing.map((m) => this.t(MISSING_LABELS[m])).join(' '));
    else this.message.set(this.t(r.error === 'duplicate-decision' ? 'Decide first about the possible duplicate.' : 'It could not be registered: check the fields.'));
  }

  approveMarked(): void {
    const ids = [...this.marked()];
    if (!ids.length) return;
    const r = this.capture.approveMany(ids);
    this.marked.set(new Set());
    this.notice.set(this.t('{n} registered.').replace('{n}', String(r.approved.length)));
    this.message.set(r.blocked.length ? this.t('{n} could not be approved: open them and complete the highlighted fields.').replace('{n}', String(r.blocked.length)) : '');
  }

  reject(d: CaptureDraft): void {
    this.capture.reject(d.id);
    this.open.set(null);
  }

  registerAnyway(d: CaptureDraft): void {
    this.capture.registerAnyway(d.id);
  }

  // the other side of the same transfer, to show next to the button
  pairLabel(d: CaptureDraft): string {
    const o = d.pairedWith ? this.capture.drafts.byId(d.pairedWith) : undefined;
    if (!o) return '';
    return [o.counterparty || o.description || this.kindLabel(o.kind), o.occurredAt, o.amountMinor ? (o.amountMinor / 100).toFixed(2) : ''].filter(Boolean).join(' · ');
  }

  combine(d: CaptureDraft): void {
    this.capture.combineAsTransfer(d.id);
    this.open.set(d.id);
  }

  notSame(d: CaptureDraft): void {
    this.capture.unpair(d.id);
  }

  duplicateOfLabel(d: CaptureDraft): string {
    return d.duplicateOf?.type === 'account' ? this.t('an account you already have') : d.duplicateOf?.type === 'transaction' ? this.t('a movement you already have') : this.t('an earlier capture');
  }
}
