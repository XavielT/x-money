// From what the model read (RawTransaction) to a draft. Pure. The model reads; this code decides:
// amounts and dates are converted here, accounts are resolved against the user's own data, and every
// doubt is recorded so the tray can highlight it. Nothing here writes a movement.
import { AccountModel } from '../../models/account.model';
import { CaptureDoubt, CaptureDraft, CaptureKind, CaptureLine, CaptureSource, MAX_LINES } from '../../models/capture-draft.model';
import { TransactionCurrency } from '../../models/transaction.model';
import { DEFAULT_LARGE_AMOUNT, parseAmount } from './amount';
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
  text?: string; // the text the items were read from (voice, email, pasted): enables the cross check
  fileFingerprint?: string;
  sender?: string;
  sentAt?: string;
  messageId?: string;
  largeAbove?: number;
}

const TEXT_MODES: readonly CaptureSource[] = ['voice', 'text', 'email'];
const isCard = (a: AccountModel | undefined): boolean => a?.type === 'card' && a.cardKind === 'credit';

export function buildDraft(raw: RawTransaction, ctx: BuildContext): CaptureDraft {
  const doubts: CaptureDoubt[] = [];
  const confidence: Record<string, number> = { ...raw.confidence };
  const kind: CaptureKind = raw.kind;
  if (kind === 'unknown') doubts.push('kind-unknown');

  // ----- amount (the code converts, the model only transcribes)
  const parsed = raw.amountText ? parseAmount(raw.amountText, raw.currencyHint, { largeAbove: ctx.largeAbove ?? DEFAULT_LARGE_AMOUNT }) : null;
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
  const needsTo = kind === 'internal_transfer' || kind === 'card_payment';
  let resolvedAccountId: string | undefined;
  let resolvedToAccountId: string | undefined;
  if (kind === 'card_payment' && !raw.toAccountLast4 && !toHint && main.status === 'resolved') {
    // the document names one account only: for a card payment it is the card
    const a = ctx.accounts.find((x) => x.id === main.accountId);
    if (isCard(a)) resolvedToAccountId = main.accountId;
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

  // currency: named in the text, else the account's when it only has one, else the user chooses
  if (!currency) {
    const acc = ctx.accounts.find((a) => a.id === (resolvedAccountId ?? resolvedToAccountId));
    const c = acc?.currency;
    if (c === 'DOP' || c === 'USD') currency = c;
    else if (amountMinor) doubts.push('currency-ambiguous');
  }

  // ----- category, income source, goal, loan: the user's own words first, then the model's candidate
  const text = [raw.counterparty, raw.description].filter(Boolean).join(' ');
  let resolvedCategoryId: string | undefined;
  if (kind === 'expense' || kind === 'invoice_purchase') {
    resolvedCategoryId = (text && ctx.categoryFor(text)) || (raw.categoryCandidate ? ctx.categoryByName(raw.categoryCandidate) : undefined);
  }
  const resolvedIncomeSourceId = kind === 'income' && text ? ctx.incomeSourceFor(text) : undefined;
  const resolvedGoalId = kind === 'goal_contribution' ? resolveByName(ctx.goals, raw.targetName ?? raw.description)?.id : undefined;
  const resolvedLoanId = kind === 'loan_payment' ? resolveByName(ctx.loans, raw.targetName ?? raw.description)?.id : undefined;

  // ----- invoice
  const lines: CaptureLine[] | undefined = raw.lines?.slice(0, MAX_LINES).map((l) => {
    const p = l.amountText ? parseAmount(l.amountText, currency) : null;
    return { description: l.description, quantity: l.quantity, amountMinor: p && p.ok ? p.minor : undefined };
  });
  const tax = raw.taxAmountText ? parseAmount(raw.taxAmountText, currency) : null;
  const sub = raw.subtotalText ? parseAmount(raw.subtotalText, currency) : null;

  const draft: CaptureDraft = {
    id: ctx.newId(),
    createdAt: ctx.nowIso,
    source: ctx.source,
    status: 'pending',
    kind,
    amountMinor,
    currency,
    occurredAt,
    occurredTime: date?.time,
    counterparty: raw.counterparty,
    description: raw.description,
    bankName: raw.bankName,
    accountLast4: raw.accountLast4,
    reference: raw.reference,
    categoryCandidate: raw.categoryCandidate,
    invoiceNumber: raw.invoiceNumber,
    taxId: raw.taxId,
    fiscalNumber: raw.fiscalNumber,
    taxAmountMinor: tax && tax.ok ? tax.minor : undefined,
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
