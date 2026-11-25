// From what the model read (RawTransaction) to a draft. Pure. The model reads; this code decides:
// amounts and dates are converted here, accounts are resolved against the user's own data, and every
// doubt is recorded so the tray can highlight it. Nothing here writes a movement.
import { AccountModel } from '../../models/account.model';
import { CaptureDoubt, CaptureDraft, CaptureKind, CaptureLine, CaptureSource, MAX_LINES } from '../../models/capture-draft.model';
import { TransactionCurrency } from '../../models/transaction.model';
import { DEFAULT_LARGE_AMOUNT, parseAmount, parseMovementAmount } from './amount';
import { decideKind, isBankCharge, trimEllipsis } from './direction';
import { parseDate } from './dates';
import { dedupeKey } from './merchant';
import { last4Of, resolveAccount, resolveByName } from './resolve';
import { RawTransaction } from './schema';
import { amountAppearsIn } from './words';

export interface BuildContext {
  source: CaptureSource;
  today: string;
  nowIso: string;
  newId: () => string;
  accounts: readonly AccountModel[];
  bankNameOf: (a: AccountModel) => string;
  goals: readonly { id: string; name: string }[];
  loans: readonly { id: string; name: string }[];
  // learned rules and names of the user: merchant text -> category id / income source id
  categoryFor: (text: string) => string | undefined;
  categoryByName: (name: string) => string | undefined;
  incomeSourceFor: (text: string) => string | undefined;
  // the category the built-in knowledge of places proposes (merchant-categories.ts); the user's own rule always wins over it
  hintCategory?: (text: string, type: 'expense' | 'income') => string | undefined;
  // the usual amount of an income source, in minor units (its expected net, else its last deposit): only ever a suggestion
  usualIncomeMinor?: (sourceId: string) => number | undefined;
  bankIdOf?: (name: string | undefined) => string | undefined; // the bank of the catalog a screenshot names
  text?: string; // the text the items were read from (voice, email, pasted): enables the cross check
  fileFingerprint?: string;
  sender?: string;
  sentAt?: string;
  messageId?: string;
  largeAbove?: number;
}

const TEXT_MODES: readonly CaptureSource[] = ['voice', 'text', 'email', 'notification'];
const isCard = (a: AccountModel | undefined): boolean => a?.type === 'card' && a.cardKind === 'credit';

// A screenshot of a bank account or card: the account itself, not a movement. Only the last 4 digits are kept.
function buildAccountDraft(raw: RawTransaction, ctx: BuildContext): CaptureDraft {
  const doubts: CaptureDoubt[] = [];
  const balance = raw.balanceText ? parseAmount(raw.balanceText, raw.currencyHint, { largeAbove: ctx.largeAbove ?? DEFAULT_LARGE_AMOUNT }) : null;
  const limit = raw.creditLimitText ? parseAmount(raw.creditLimitText, raw.currencyHint) : null;
  let currency: TransactionCurrency | undefined = raw.currencyHint;
  if (balance && balance.ok) {
    currency = balance.currency ?? currency;
    if (balance.needsConfirm) doubts.push('amount-large');
  } else {
    doubts.push('balance-missing');
  }
  if (!currency && limit && limit.ok) currency = limit.currency ?? undefined;
  if (!currency) doubts.push('currency-ambiguous');
  if (!raw.accountType) doubts.push('kind-unknown');
  const last4 = last4Of(raw.accountLast4);
  const bankId = ctx.bankIdOf?.(raw.bankName);
  const twin = last4 ? ctx.accounts.find((a) => !a.archived && a.last4 === last4 && (!bankId || !a.bankId || a.bankId === bankId)) : undefined;
  if (twin) {
    // the balance of an account you already have is not a new account: it is a CHECK of your own numbers against the bank's
    const cur: TransactionCurrency | undefined = currency ?? (twin.currency === 'DOP' || twin.currency === 'USD' ? twin.currency : undefined);
    const check: CaptureDraft = {
      id: ctx.newId(),
      createdAt: ctx.nowIso,
      source: ctx.source,
      status: 'pending',
      kind: 'balance_check',
      currency: cur,
      occurredAt: ctx.today,
      bankName: raw.bankName,
      accountLast4: last4,
      accountType: raw.accountType ?? (twin.type === 'card' && twin.cardKind === 'credit' ? 'credit_card' : undefined),
      accountName: twin.name,
      balanceMinor: balance && balance.ok ? balance.minor : undefined,
      resolvedAccountId: twin.id,
      confidence: { ...raw.confidence },
      notes: raw.notes,
      // the day the screenshot was taken is not on it: today is assumed and the user can change it (an old screenshot shows an old balance)
      doubts: [...doubts.filter((d) => d !== 'kind-unknown' && (d !== 'currency-ambiguous' || !cur)), 'date-assumed'],
      fileFingerprint: ctx.fileFingerprint,
      sender: ctx.sender,
      sentAt: ctx.sentAt,
      messageId: ctx.messageId,
    };
    for (const k of Object.keys(check) as (keyof CaptureDraft)[]) if (check[k] === undefined) delete check[k];
    return check;
  }
  const draft: CaptureDraft = {
    id: ctx.newId(),
    createdAt: ctx.nowIso,
    source: ctx.source,
    status: 'pending',
    kind: 'account_setup',
    currency,
    bankName: raw.bankName,
    accountLast4: last4,
    accountType: raw.accountType,
    accountName: raw.accountName ?? raw.bankName,
    balanceMinor: balance && balance.ok ? balance.minor : undefined,
    creditLimitMinor: limit && limit.ok ? limit.minor : undefined,
    resolvedBankId: bankId,
    confidence: { ...raw.confidence },
    notes: raw.notes,
    doubts,
    fileFingerprint: ctx.fileFingerprint,
    sender: ctx.sender,
    sentAt: ctx.sentAt,
    messageId: ctx.messageId,
  };
  for (const k of Object.keys(draft) as (keyof CaptureDraft)[]) if (draft[k] === undefined) delete draft[k];
  return draft;
}

export function buildDraft(raw: RawTransaction, ctx: BuildContext): CaptureDraft {
  if (raw.kind === 'account_setup') return buildAccountDraft(raw, ctx);
  const doubts: CaptureDoubt[] = [];
  const confidence: Record<string, number> = { ...raw.confidence };
  // the type is settled with the direction the document shows (sign, arrow): see direction.ts
  const decided = decideKind(raw);
  let kind: CaptureKind = decided.kind;
  const direction = decided.direction ?? undefined;
  if (decided.conflict) doubts.push('direction-conflict');
  if (kind === 'unknown') doubts.push('kind-unknown');
  else if (decided.inferred) doubts.push('kind-inferred');

  // ----- amount (the code converts, the model only transcribes). A printed sign is the direction, not a refusal.
  const parsed = raw.amountText ? parseMovementAmount(raw.amountText, raw.currencyHint, { largeAbove: ctx.largeAbove ?? DEFAULT_LARGE_AMOUNT }) : null;
  let amountMinor: number | undefined;
  let currency: TransactionCurrency | undefined;
  if (parsed && parsed.ok) {
    amountMinor = parsed.minor;
    currency = parsed.currency ?? undefined;
    if (parsed.needsConfirm) doubts.push('amount-large');
    // text modes: the amount must be in the text it was read from. Images and PDFs cannot be checked
    // this way; the tray shows the original next to the figure instead.
    if (TEXT_MODES.includes(ctx.source) && ctx.text && !amountAppearsIn(parsed.minor, ctx.text)) {
      doubts.push('amount-unverified');
      confidence['amount'] = Math.min(confidence['amount'] ?? 1, 0.2);
    }
  } else {
    doubts.push('amount-missing');
  }

  // ----- date
  const date = raw.dateText ? parseDate(raw.dateText, ctx.today) : null;
  let occurredAt = date?.iso;
  if (!date) {
    occurredAt = ctx.today; // never blank: the user sees and can change it
    if (!TEXT_MODES.includes(ctx.source) || ctx.source === 'email') doubts.push('date-assumed');
  } else if (date.doubt === 'future') {
    doubts.push('date-future');
  }

  // ----- accounts, resolved locally. Same rule everywhere: exactly one match, else the candidates.
  const hint = [raw.accountHint, raw.bankName].filter(Boolean).join(' ');
  const main = resolveAccount(ctx.accounts, raw.accountLast4 ?? last4Of(raw.accountLast4), currency ?? raw.currencyHint, hint || undefined, ctx.bankNameOf);
  const toHint = raw.toAccountHint;
  const mainAccount = main.status === 'resolved' ? ctx.accounts.find((x) => x.id === main.accountId) : undefined;
  // money that ENTERS a credit card is a payment (or a refund the user decides), never income
  if (isCard(mainAccount) && direction === 'in' && kind === 'income' && !decided.conflict) {
    kind = 'card_payment';
    if (!doubts.includes('kind-inferred')) doubts.push('kind-inferred');
  }
  const needsTo = kind === 'internal_transfer' || kind === 'card_payment';
  // the account of the screenshot RECEIVES the money of a transfer that entered it: it is the destination, the other one is the origin
  const receiving = kind === 'internal_transfer' && direction === 'in';
  let resolvedAccountId: string | undefined;
  let resolvedToAccountId: string | undefined;
  if (receiving) {
    if (main.status === 'resolved') resolvedToAccountId = main.accountId;
    else if (main.status === 'ambiguous') doubts.push('account-ambiguous');
    else doubts.push('account-missing');
    const from = resolveAccount(ctx.accounts.filter((a) => a.id !== resolvedToAccountId), raw.toAccountLast4, currency ?? raw.currencyHint, toHint, ctx.bankNameOf);
    if (from.status === 'resolved') resolvedAccountId = from.accountId;
    else if (from.status === 'ambiguous') doubts.push('account-ambiguous');
  } else {
    if (kind === 'card_payment' && !raw.toAccountLast4 && !toHint && main.status === 'resolved') {
      // the document names one account only: for a card payment it is the card
      if (isCard(mainAccount)) resolvedToAccountId = main.accountId;
      else resolvedAccountId = main.accountId;
    } else if (main.status === 'resolved') {
      resolvedAccountId = main.accountId;
    } else if (main.status === 'ambiguous') {
      doubts.push('account-ambiguous');
    }
    if (needsTo && !resolvedToAccountId) {
      const to = resolveAccount(ctx.accounts.filter((a) => a.id !== resolvedAccountId), raw.toAccountLast4, currency ?? raw.currencyHint, toHint, ctx.bankNameOf);
      if (to.status === 'resolved') resolvedToAccountId = to.accountId;
      else if (to.status === 'ambiguous') doubts.push('account-ambiguous');
    }
    if (!resolvedAccountId && main.status === 'none') doubts.push('account-missing');
  }

  // currency: named in the text, else the account's when it only has one, else the user chooses
  if (!currency) {
    const acc = ctx.accounts.find((a) => a.id === (resolvedAccountId ?? resolvedToAccountId));
    const c = acc?.currency;
    if (c === 'DOP' || c === 'USD') currency = c;
    else if (amountMinor) doubts.push('currency-ambiguous');
  }

  // ----- category, income source, goal, loan: the user's own words first, then the model's candidate
  const counterparty = trimEllipsis(raw.counterparty);
  const description = trimEllipsis(raw.description);
  const text = [counterparty, description].filter(Boolean).join(' ');
  let resolvedCategoryId: string | undefined;
  if (kind === 'expense' || kind === 'invoice_purchase') {
    // the user's own rule first, then what the place is known for (a gas station is Fuel), then the reader's guess
    resolvedCategoryId = (text && ctx.categoryFor(text)) || (text && ctx.hintCategory?.(text, 'expense')) || (raw.categoryCandidate ? ctx.categoryByName(raw.categoryCandidate) : undefined);
    // what the bank takes by itself (DGII 0.20%, commissions, monthly charges) is a bank fee, whatever the model guessed
    if (!resolvedCategoryId && isBankCharge(text)) resolvedCategoryId = ctx.categoryByName('Bank fees');
  }
  const resolvedIncomeSourceId = kind === 'income' && text ? ctx.incomeSourceFor(text) : undefined;
  // an income with no source of its own still gets the category its wording says (money from a person, a reimbursement)
  if (kind === 'income' && !resolvedIncomeSourceId && text) resolvedCategoryId = ctx.hintCategory?.(text, 'income');
  // "Payroll deposit credited to the account" says NO amount (the bank's notice never does): the usual payroll is proposed as an
  // ESTIMATE, marked so it is checked against the bank (rule 10), never as if the notice had said it
  if (amountMinor === undefined && kind === 'income' && resolvedIncomeSourceId) {
    const usual = ctx.usualIncomeMinor?.(resolvedIncomeSourceId);
    if (usual && usual > 0) {
      amountMinor = usual;
      const i = doubts.indexOf('amount-missing');
      if (i >= 0) doubts.splice(i, 1);
      doubts.push('amount-estimated');
      confidence['amount'] = 0.3;
    }
  }
  const resolvedGoalId = kind === 'goal_contribution' ? resolveByName(ctx.goals, raw.targetName ?? raw.description)?.id : undefined;
  const resolvedLoanId = kind === 'loan_payment' ? resolveByName(ctx.loans, raw.targetName ?? raw.description)?.id : undefined;

  // ----- invoice
  const lines: CaptureLine[] | undefined = raw.lines?.slice(0, MAX_LINES).map((l) => {
    const p = l.amountText ? parseAmount(l.amountText, currency) : null;
    return { description: l.description, quantity: l.quantity, amountMinor: p && p.ok ? p.minor : undefined };
  });
  const tax = raw.taxAmountText ? parseAmount(raw.taxAmountText, currency) : null;
  const sub = raw.subtotalText ? parseAmount(raw.subtotalText, currency) : null;
  // the bank's tax comes out of the account on top of the amount. A transfer to a third party is filed as an expense
  // and carries it too, but a plain purchase must never turn a receipt figure (the 18% ITBIS) into a "bank fee": for an
  // expense only a plausible bank tax is kept (DGII is 0.20%; up to 2% of the amount).
  const feeKind = kind === 'internal_transfer' || kind === 'card_payment' || kind === 'expense';
  let fee = feeKind && raw.bankFeeText ? parseMovementAmount(raw.bankFeeText, currency) : null;
  if (fee && fee.ok && kind === 'expense' && (amountMinor === undefined || fee.minor * 50 > amountMinor)) fee = null;

  const draft: CaptureDraft = {
    id: ctx.newId(),
    createdAt: ctx.nowIso,
    source: ctx.source,
    status: 'pending',
    kind,
    direction,
    amountMinor,
    currency,
    occurredAt,
    occurredTime: date?.time,
    counterparty,
    description,
    bankName: raw.bankName,
    accountLast4: raw.accountLast4,
    reference: raw.reference,
    categoryCandidate: raw.categoryCandidate,
    invoiceNumber: raw.invoiceNumber,
    taxId: raw.taxId,
    fiscalNumber: raw.fiscalNumber,
    taxAmountMinor: tax && tax.ok ? tax.minor : undefined,
    bankFeeMinor: fee && fee.ok && fee.minor > 0 ? fee.minor : undefined,
    subtotalMinor: sub && sub.ok ? sub.minor : undefined,
    lines: lines?.length ? lines : undefined,
    confidence,
    notes: raw.notes,
    doubts,
    resolvedAccountId,
    resolvedToAccountId,
    resolvedCategoryId,
    resolvedIncomeSourceId,
    resolvedGoalId,
    resolvedLoanId,
    fileFingerprint: ctx.fileFingerprint,
    sender: ctx.sender,
    sentAt: ctx.sentAt,
    messageId: ctx.messageId,
  };
  draft.dedupeKey = dedupeKey(draft);
  // drop the keys that carry nothing, so a synced draft stays small
  for (const k of Object.keys(draft) as (keyof CaptureDraft)[]) if (draft[k] === undefined) delete draft[k];
  return draft;
}
