// A transfer between two of the user's accounts shows up TWICE when both accounts are captured: as money leaving one and as
// money entering the other (and a card payment as "PAGO TARJETA" on the account and "PAGO RECIBIDO" on the card). Registered
// as they come, they become an expense plus an income, which breaks rule 1 (a transfer is neither). This finds the two
// drafts that are the same transfer so the user can combine them into ONE. It only proposes: exactly one candidate, never the
// closest one, and nothing is combined without the user's tap. Pure.
import { CaptureDraft } from '../../models/capture-draft.model';
import { daysBetween } from '../dates';

const flat = (s: string | undefined): string => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const MOVE_WORDS = /\b(transferencia|transf|ach|traspaso|propia|pago\s+recibido|pago\s+tarj|pagos?\s+al\s+instante|mb\s+(?:a|desde)|deposito\s+de\s+cuenta)\b/;
const TRANSFERISH: readonly CaptureDraft['kind'][] = ['internal_transfer', 'card_payment'];
const SIDES: readonly CaptureDraft['kind'][] = ['expense', 'income', 'unknown', 'internal_transfer', 'card_payment'];

export const MAX_PAIR_DAYS = 2;

const looksLikeTransfer = (d: CaptureDraft): boolean => TRANSFERISH.includes(d.kind) || MOVE_WORDS.test(flat([d.counterparty, d.description].filter(Boolean).join(' ')));

// the account the screenshot itself is about: the destination for money that entered by a transfer or a card payment
export function ownAccountOf(d: CaptureDraft): string | undefined {
  if (d.direction === 'in' && TRANSFERISH.includes(d.kind)) return d.resolvedToAccountId ?? d.resolvedAccountId;
  return d.resolvedAccountId;
}

export function couldBePair(a: CaptureDraft, b: CaptureDraft): boolean {
  if (a.id === b.id || a.status !== 'pending' || b.status !== 'pending') return false;
  if (a.notPairedWith?.includes(b.id) || b.notPairedWith?.includes(a.id)) return false;
  if (!SIDES.includes(a.kind) || !SIDES.includes(b.kind)) return false;
  if (!a.amountMinor || a.amountMinor !== b.amountMinor) return false;
  if (!a.currency || a.currency !== b.currency) return false;
  if (!a.direction || !b.direction || a.direction === b.direction) return false; // one leaves, the other enters
  if (!a.occurredAt || !b.occurredAt || Math.abs(daysBetween(a.occurredAt, b.occurredAt)) > MAX_PAIR_DAYS) return false;
  const accA = ownAccountOf(a);
  const accB = ownAccountOf(b);
  if (accA && accB && accA === accB) return false; // the same account cannot send money to itself
  // a purchase that happens to have the same amount as a deposit is not a transfer: at least one side must say it is one
  return looksLikeTransfer(a) || looksLikeTransfer(b);
}

// The ONE draft that is the other side of `draft`, or null when there is none or more than one
export function findTransferPair(draft: CaptureDraft, drafts: readonly CaptureDraft[]): CaptureDraft | null {
  const candidates = drafts.filter((d) => couldBePair(draft, d));
  if (candidates.length !== 1) return null;
  // and it must be mutual: no other draft claims the same partner
  const back = drafts.filter((d) => couldBePair(candidates[0], d));
  return back.length === 1 ? candidates[0] : null;
}

// The patch that turns the OUT side into the one transfer (or card payment) and the id of the side that is absorbed
export function combinePatch(a: CaptureDraft, b: CaptureDraft): { keep: string; absorb: string; patch: Partial<CaptureDraft> } | null {
  if (!couldBePair({ ...a, status: 'pending' }, { ...b, status: 'pending' })) return null;
  const out = a.direction === 'out' ? a : b;
  const inn = out === a ? b : a;
  const from = ownAccountOf(out);
  const to = ownAccountOf(inn);
  const card = out.kind === 'card_payment' || inn.kind === 'card_payment';
  const keepFee = out.bankFeeMinor ?? inn.bankFeeMinor;
  const doubts = out.doubts.filter((x) => x !== 'transfer-pair' && x !== 'kind-unknown' && x !== 'kind-inferred' && x !== 'direction-conflict' && x !== 'account-missing' && x !== 'account-ambiguous');
  return {
    keep: out.id,
    absorb: inn.id,
    patch: {
      kind: card ? 'card_payment' : 'internal_transfer',
      direction: 'out',
      resolvedAccountId: from,
      resolvedToAccountId: to,
      resolvedCategoryId: undefined,
      resolvedIncomeSourceId: undefined,
      reference: out.reference ?? inn.reference,
      bankFeeMinor: keepFee,
      pairedWith: undefined,
      doubts: [...doubts, ...(from && to ? [] : (['account-missing'] as const))],
    },
  };
}
