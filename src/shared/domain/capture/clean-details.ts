// Whatever reaches storage is cut to the same limits as a capture (a synced or imported record is untrusted).
// Kept apart from details.ts on purpose: the transaction service needs only this, not the merchant matching.
import { MAX_LINES } from '../../models/capture-draft.model';
import { PurchaseDetails, PurchaseLine } from '../../models/transaction.model';

export const MAX_DETAIL_TEXT = 1500;

export function cleanDetails(raw: unknown): PurchaseDetails | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : undefined);
  const out: PurchaseDetails = {};
  if (Array.isArray(r['lines'])) {
    const lines: PurchaseLine[] = [];
    for (const l of r['lines'].slice(0, MAX_LINES)) {
      if (!l || typeof l !== 'object') continue;
      const lr = l as Record<string, unknown>;
      const description = str(lr['description'], 120);
      if (!description) continue;
      const line: PurchaseLine = { description };
      const q = num(lr['quantity']);
      const a = num(lr['amount']);
      if (q !== undefined) line.quantity = q;
      if (a !== undefined) line.amount = a;
      lines.push(line);
    }
    if (lines.length) out.lines = lines;
  }
  const invoiceNumber = str(r['invoiceNumber'], 40);
  const fiscalNumber = str(r['fiscalNumber'], 20);
  const taxId = str(r['taxId'], 20);
  const reference = str(r['reference'], 40);
  const text = str(r['text'], MAX_DETAIL_TEXT);
  const subtotal = num(r['subtotal']);
  const tax = num(r['tax']);
  if (invoiceNumber) out.invoiceNumber = invoiceNumber;
  if (fiscalNumber) out.fiscalNumber = fiscalNumber;
  if (taxId) out.taxId = taxId;
  if (reference) out.reference = reference;
  if (text) out.text = text;
  if (subtotal !== undefined) out.subtotal = subtotal;
  if (tax !== undefined) out.tax = tax;
  const origin = r['origin'];
  if (origin === 'image' || origin === 'pdf' || origin === 'voice' || origin === 'text' || origin === 'email' || origin === 'notification') out.origin = origin;
  return Object.keys(out).length ? out : undefined;
}
