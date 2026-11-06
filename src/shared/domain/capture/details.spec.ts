// What was bought stays with the movement (2.20.2). The case that started it: the bank's email and the
// receipt screenshot of the same purchase reached the tray as two drafts; the email has the amount and the
// card, the receipt has the items. Registering one and rejecting the other must not lose the items.
import { describe, expect, it } from 'vitest';
import { CaptureDraft } from '../../models/capture-draft.model';
import { cleanDetails, purchaseDetailsOf, samePurchase, whatOthersAdd } from './details';

const draft = (over: Partial<CaptureDraft>): CaptureDraft => ({ id: 'd', createdAt: '2026-11-06T12:00:00Z', source: 'email', status: 'pending', kind: 'expense', confidence: {}, doubts: [], amountMinor: 23913, currency: 'DOP', occurredAt: '2026-11-06', counterparty: 'JUMBO LUPERON', ...over });

const receipt = draft({
  id: 'r',
  source: 'image',
  kind: 'invoice_purchase',
  invoiceNumber: 'F-1001',
  fiscalNumber: 'B0100000123',
  taxId: '101019921',
  taxAmountMinor: 3647,
  subtotalMinor: 20266,
  lines: [
    { description: 'Leche 1L', quantity: 2, amountMinor: 9800 },
    { description: 'Pan sobao', quantity: 1, amountMinor: 10466 },
  ],
});
const email = draft({ id: 'e' });

describe('purchaseDetailsOf', () => {
  it('takes the draft\'s own items', () => {
    const d = purchaseDetailsOf(receipt)!;
    expect(d.lines).toEqual([
      { description: 'Leche 1L', quantity: 2, amount: 98 },
      { description: 'Pan sobao', quantity: 1, amount: 104.66 },
    ]);
    expect(d).toMatchObject({ invoiceNumber: 'F-1001', fiscalNumber: 'B0100000123', taxId: '101019921', tax: 36.47, subtotal: 202.66 });
  });

  it('a draft without items adopts those of the receipt of the SAME purchase, so rejecting the receipt loses nothing', () => {
    const d = purchaseDetailsOf(email, [receipt, email], (id) => (id === 'e' ? 'Gracias por utilizar su Tarjeta Debito terminada en 4237' : undefined))!;
    expect(d.lines).toHaveLength(2);
    expect(d.invoiceNumber).toBe('F-1001');
    expect(d.text).toContain('terminada en 4237'); // the bank's own words are kept too
    expect(d.origin).toBe('email');
  });

  it('does not adopt items from another amount, another day, another merchant or a rejected draft', () => {
    for (const other of [draft({ ...receipt, id: 'x', amountMinor: 23914 }), draft({ ...receipt, id: 'x', occurredAt: '2026-11-05' }), draft({ ...receipt, id: 'x', counterparty: 'SIRENA' }), draft({ ...receipt, id: 'x', status: 'rejected' })]) {
      expect(purchaseDetailsOf(email, [other])).toBeUndefined();
    }
  });

  it('a draft with nothing to keep has no details (not an empty object)', () => {
    expect(purchaseDetailsOf(email)).toBeUndefined();
    expect(purchaseDetailsOf(email, [])).toBeUndefined();
  });

  it('is the same purchase only with equal currency, amount and day', () => {
    expect(samePurchase(email, receipt)).toBe(true);
    expect(samePurchase(email, draft({ id: 'u', currency: 'USD' }))).toBe(false);
    expect(samePurchase(email, email)).toBe(false); // never itself
  });

  it('cuts the bank text to 1500 characters', () => {
    expect(purchaseDetailsOf(email, [], () => 'x'.repeat(5000))!.text).toHaveLength(1500);
  });
});

describe('each draft gives what the other lacks, field by field', () => {
  const bankEmail = draft({ id: 'e', source: 'email', reference: 'AP-778899' }); // the bank: reference, no items
  const store = draft({ id: 'r', source: 'image', kind: 'invoice_purchase', invoiceNumber: 'F-1001', fiscalNumber: 'B0100000123', lines: [{ description: 'Leche', amountMinor: 23913 }] }); // the store: items, no reference

  it('registering the bank email: it keeps its own reference and receives the items, invoice and NCF', () => {
    expect(purchaseDetailsOf(bankEmail, [store])).toMatchObject({ reference: 'AP-778899', invoiceNumber: 'F-1001', fiscalNumber: 'B0100000123', lines: [{ description: 'Leche', amount: 239.13 }] });
  });

  it('registering the store receipt instead: it receives the bank reference and the bank text', () => {
    const d = purchaseDetailsOf(store, [bankEmail], (id) => (id === 'e' ? 'Tarjeta terminada en 4237' : undefined))!;
    expect(d).toMatchObject({ reference: 'AP-778899', invoiceNumber: 'F-1001', text: 'Tarjeta terminada en 4237', origin: 'email' });
  });

  it('the own value of a draft always wins over the other one', () => {
    const mine = draft({ id: 'm', invoiceNumber: 'MINE' });
    expect(purchaseDetailsOf(mine, [store])!.invoiceNumber).toBe('MINE');
    expect(purchaseDetailsOf(mine, [store])!.fiscalNumber).toBe('B0100000123'); // but the gap is filled
  });

  it('says what the others would add, so the tray can show it before approving', () => {
    expect(whatOthersAdd(bankEmail, [store]).sort()).toEqual(['fiscalNumber', 'invoiceNumber', 'lines']);
    expect(whatOthersAdd(store, [bankEmail])).toEqual(['reference']);
    expect(whatOthersAdd(bankEmail, [draft({ id: 'z', amountMinor: 1 })])).toEqual([]);
  });
});

describe('cleanDetails (a synced or imported record is untrusted)', () => {
  it('keeps a good record as it is', () => {
    const good = { lines: [{ description: 'Leche', quantity: 2, amount: 98 }], invoiceNumber: 'F-1', tax: 1.5 };
    expect(cleanDetails(good)).toEqual(good);
  });

  it('drops what is not valid and cuts what is too long', () => {
    const lines = Array.from({ length: 50 }, (_, i) => ({ description: `item ${i}` }));
    const out = cleanDetails({ lines, tax: 'lots', text: 'y'.repeat(4000), origin: 'carrier-pigeon', extra: 1 })!;
    expect(out.lines).toHaveLength(30);
    expect(out.tax).toBeUndefined();
    expect(out.text).toHaveLength(1500);
    expect(out.origin).toBeUndefined();
    expect((out as unknown as Record<string, unknown>)['extra']).toBeUndefined();
  });

  it.each([null, undefined, 5, 'text', [], {}])('%s -> nothing', (v) => expect(cleanDetails(v)).toBeUndefined());
});
