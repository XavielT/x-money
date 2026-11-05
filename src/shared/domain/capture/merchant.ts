// Merchant names and duplicate detection. Pure.
import { TransactionModel } from '../../models/transaction.model';
import { CaptureDraft } from '../../models/capture-draft.model';
import { daysBetween } from '../dates';

const LEGAL = /\b(s\.?\s?r\.?\s?l\.?|s\.?\s?a\.?\s?s?\.?|e\.?\s?i\.?\s?r\.?\s?l\.?|c\.?\s?x\.?\s?a\.?|srl|sa|eirl|cxa|ltd|inc|llc)\b/g;

// "SUPERMERCADO NACIONAL S.R.L. TERM 00123 #45" -> "supermercado nacional". Used for learned rules
// (merchant -> category) and for duplicate keys, so two readings of the same shop match.
export function normalizeMerchant(raw: string | undefined): string {
  return (raw ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(term(?:inal)?|pos|ref|aut|apr|no|nro|num)\b[\s.:#-]*[a-z0-9-]*\d[a-z0-9-]*/g, ' ')
    .replace(LEGAL, ' ')
    .replace(/[#*]+\s*\d+/g, ' ')
    .replace(/\d{3,}/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function dedupeKey(d: Pick<CaptureDraft, 'currency' | 'amountMinor' | 'occurredAt' | 'reference' | 'accountLast4' | 'counterparty'>): string | undefined {
  if (!d.amountMinor || !d.occurredAt) return undefined;
  const tail = (d.reference ?? '').replace(/\s/g, '').toLowerCase() || d.accountLast4 || '';
  return [d.currency ?? '?', d.amountMinor, d.occurredAt, tail, normalizeMerchant(d.counterparty)].join('|');
}

export type DuplicateMatch = { why: 'same-file' | 'same-transaction' | 'manual-entry' | 'existing-account'; of: { type: 'draft' | 'transaction' | 'account'; id: string } };

const WEIGHTLESS: ReadonlySet<string> = new Set(['rejected', 'failed']);

// 1) the same file, 2) the same transaction seen twice (also from two sources: they share the key),
// 3) a movement the user already wrote by hand (same amount and currency, within one day).
export function findDuplicate(draft: CaptureDraft, drafts: readonly CaptureDraft[], transactions: readonly TransactionModel[], accounts: readonly { id: string; last4?: string; bankId?: string; archived?: boolean }[] = []): DuplicateMatch | null {
  if (draft.kind === 'account_setup') {
    // the same bank account seen twice is not a second account: the twin (the same 4 digits, a compatible bank) must be decided
    const twin = draft.accountLast4 ? accounts.find((a) => !a.archived && a.last4 === draft.accountLast4 && (!draft.resolvedBankId || !a.bankId || a.bankId === draft.resolvedBankId)) : undefined;
    if (twin) return { why: 'existing-account', of: { type: 'account', id: twin.id } };
    const same = drafts.find((d) => d.id !== draft.id && d.kind === 'account_setup' && d.status !== 'rejected' && d.status !== 'failed' && d.status !== 'approved' && !!draft.accountLast4 && d.accountLast4 === draft.accountLast4 && d.resolvedBankId === draft.resolvedBankId);
    return same ? { why: 'same-transaction', of: { type: 'draft', id: same.id } } : null;
  }
  const others = drafts.filter((d) => d.id !== draft.id && !WEIGHTLESS.has(d.status));
  if (draft.fileFingerprint) {
    const same = others.find((d) => d.fileFingerprint === draft.fileFingerprint);
    if (same) return { why: 'same-file', of: { type: 'draft', id: same.id } };
  }
  if (draft.dedupeKey) {
    const same = others.find((d) => d.dedupeKey === draft.dedupeKey);
    if (same) return { why: 'same-transaction', of: { type: 'draft', id: same.id } };
  }
  if (draft.amountMinor && draft.occurredAt) {
    const currency = draft.currency ?? 'DOP';
    const hit = transactions.find(
      (t) =>
        t.status !== 'reversed' &&
        !t.reversalOf &&
        t.type !== 'transfer' === (draft.kind !== 'internal_transfer' && draft.kind !== 'card_payment') &&
        Math.round(t.amount * 100) === draft.amountMinor &&
        (t.currency ?? 'DOP') === currency &&
        Math.abs(daysBetween(t.date, draft.occurredAt!)) <= 1 &&
        (!draft.resolvedAccountId || t.accountId === draft.resolvedAccountId)
    );
    if (hit) return { why: 'manual-entry', of: { type: 'transaction', id: hit.id } };
  }
  return null;
}
