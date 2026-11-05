import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ACCOUNT_SETUP_TYPES, AccountSetupType, CAPTURE_KINDS, CaptureDoubt, CaptureDraft, CaptureKind } from '../../../shared/models/capture-draft.model';
import { BANKS_MOCK } from '../../../shared/data/banks';
import { TransactionCurrency } from '../../../shared/models/transaction.model';
import { majorOf, minorOf } from '../../../shared/domain/capture/amount';
import { MissingField, missingFor } from '../../../shared/domain/capture/plan';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { AccountService } from '../../../shared/services/account.service';
import { CaptureService } from '../../../shared/services/capture.service';
import { CategoryService } from '../../../shared/services/category.service';
import { GoalService } from '../../../shared/services/goal.service';
import { IncomeSourceService } from '../../../shared/services/income-source.service';
import { LoanService } from '../../../shared/services/loan.service';
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
  kinds = CAPTURE_KINDS;
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
    private translate: TranslateService
  ) {}

  t(key: string): string {
    return this.translate.instant(key);
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

  amountLabel(d: CaptureDraft): string {
    if (d.kind === 'account_setup') {
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

  setField(d: CaptureDraft, patch: Partial<CaptureDraft>): void {
    this.capture.edit(d.id, patch);
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
      this.notice.set(this.t(d.kind === 'account_setup' ? 'Account created. Its balance is the opening balance: you can edit or archive it in Accounts.' : 'Registered. You can reverse it from the history like any movement.'));
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

  duplicateOfLabel(d: CaptureDraft): string {
    return d.duplicateOf?.type === 'account' ? this.t('an account you already have') : d.duplicateOf?.type === 'transaction' ? this.t('a movement you already have') : this.t('an earlier capture');
  }
}
