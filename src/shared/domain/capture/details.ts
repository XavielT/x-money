// What was bought, taken from an approved draft so that it stays with the movement. Pure.
// A bank notice or an email carries the amount and the card but usually not the items; the receipt (a screenshot,
// an invoice) carries the items. When the same purchase reached the tray twice, each draft may hold what the other
// lacks: the movement that is registered keeps both, so rejecting the other one loses nothing.
import { CaptureDraft } from '../../models/capture-draft.model';
import { PurchaseDetails, PurchaseLine } from '../../models/transaction.model';
import { MAX_LINES } from '../../models/capture-draft.model';
import { MAX_DETAIL_TEXT } from './clean-details';
import { normalizeMerchant } from './merchant';

export { cleanDetails } from './clean-details';

const major = (minor: number | undefined): number | undefined => (minor === undefined ? undefined : Math.round(minor) / 100);

// The same purchase: same currency, amount and day, and the same merchant when both name one
export function samePurchase(a: CaptureDraft, b: CaptureDraft): boolean {
  if (a.id === b.id || a.amountMinor === undefined || a.amountMinor !== b.amountMinor) return false;
  if ((a.currency ?? '') !== (b.currency ?? '') || !a.occurredAt || a.occurredAt !== b.occurredAt) return false;
  const ma = normalizeMerchant(a.counterparty ?? a.description);
  const mb = normalizeMerchant(b.counterparty ?? b.description);
  return !ma || !mb || ma === mb;
}

function fromItems(d: CaptureDraft): Pick<PurchaseDetails, 'lines' | 'invoiceNumber' | 'fiscalNumber' | 'taxId' | 'subtotal' | 'tax' | 'reference'> {
  const lines: PurchaseLine[] | undefined = d.lines
    ?.slice(0, MAX_LINES)
    .filter((l) => l.description?.trim())
    .map((l) => {
      const line: PurchaseLine = { description: l.description.trim().slice(0, 120) };
      if (l.quantity !== undefined) line.quantity = l.quantity;
      if (l.amountMinor !== undefined) line.amount = major(l.amountMinor);
      return line;
    });
  const out: Pick<PurchaseDetails, 'lines' | 'invoiceNumber' | 'fiscalNumber' | 'taxId' | 'subtotal' | 'tax' | 'reference'> = {};
  if (lines?.length) out.lines = lines;
  if (d.invoiceNumber) out.invoiceNumber = d.invoiceNumber;
  if (d.fiscalNumber) out.fiscalNumber = d.fiscalNumber;
  if (d.taxId) out.taxId = d.taxId;
  if (d.subtotalMinor !== undefined) out.subtotal = major(d.subtotalMinor);
  if (d.taxAmountMinor !== undefined) out.tax = major(d.taxAmountMinor);
  if (d.reference) out.reference = d.reference;
  return out;
}

type Piece = Pick<PurchaseDetails, 'lines' | 'invoiceNumber' | 'fiscalNumber' | 'taxId' | 'subtotal' | 'tax' | 'reference'>;
const PIECES: readonly (keyof Piece)[] = ['lines', 'invoiceNumber', 'fiscalNumber', 'taxId', 'subtotal', 'tax', 'reference'];

// Other drafts of the SAME purchase that still count (a rejected or failed one never gives anything)
export const siblingsOf = (d: CaptureDraft, others: readonly CaptureDraft[]): CaptureDraft[] => others.filter((o) => o.status !== 'rejected' && o.status !== 'failed' && samePurchase(d, o));

// What the draft has that the others of the same purchase lack, and the other way round: for every piece of
// information the draft's own value wins and a gap is filled from the first other draft that has it. The bank's
// email brings the amount and the card, the store's receipt brings the items: the movement keeps both.
// `textOf`: the reduced text a draft was read from, when it was text (the bank's own words).
export function purchaseDetailsOf(d: CaptureDraft, others: readonly CaptureDraft[] = [], textOf: (id: string) => string | undefined = () => undefined): PurchaseDetails | undefined {
  const siblings = siblingsOf(d, others);
  const details: PurchaseDetails = { ...fromItems(d) };
  const filledFrom: CaptureDraft[] = [];
  for (const o of siblings) {
    const theirs = fromItems(o);
    let gave = false;
    for (const key of PIECES) {
      if (details[key] === undefined && theirs[key] !== undefined) {
        (details as Record<string, unknown>)[key] = theirs[key];
        gave = true;
      }
    }
    if (gave) filledFrom.push(o);
  }
  const own = (textOf(d.id) ?? '').trim();
  const borrowed = siblings.map((o) => ({ o, t: (textOf(o.id) ?? '').trim() })).find((x) => x.t);
  const text = own || borrowed?.t || '';
  if (text) {
    details.text = text.slice(0, MAX_DETAIL_TEXT);
    details.origin = own ? d.source : borrowed!.o.source;
  } else if (filledFrom.length) {
    details.origin = filledFrom[0].source;
  }
  return Object.keys(details).length ? details : undefined;
}

// What a draft would receive from the others of its purchase (for the tray to say so before approving)
export function whatOthersAdd(d: CaptureDraft, others: readonly CaptureDraft[]): (keyof Piece)[] {
  const mine = fromItems(d);
  const found = new Set<keyof Piece>();
  for (const o of siblingsOf(d, others)) {
    const theirs = fromItems(o);
    for (const key of PIECES) if (mine[key] === undefined && theirs[key] !== undefined) found.add(key);
  }
  return [...found];
}
