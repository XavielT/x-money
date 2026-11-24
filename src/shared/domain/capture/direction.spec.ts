// Lists of movements read from a bank app (2.25.0). Everything here is SYNTHETIC: invented descriptions, references and
// digits that only copy the SHAPE of what two Dominican bank apps print (a sign on every amount in one, no sign on money
// that enters in the other, a reference number under each description, one row per transfer on each of its two accounts).
import { account, transaction } from '../../testing/builders';
import { CaptureDraft } from '../../models/capture-draft.model';
import { parseMovementAmount, signOf } from './amount';
import { BuildContext, buildDraft } from './build';
import { decideKind, foldBankCharges, parentReference, trimEllipsis } from './direction';
import { findDuplicate } from './merchant';
import { bankBalanceOf, pendingEffect } from './balance-check';
import { combinePatch, findTransferPair } from './transfer-pair';
import { missingFor } from './plan';
import { RawTransaction } from './schema';

const TODAY = '2026-11-24';

describe('an amount printed on a movement row: the sign is the direction, never a reason to lose the amount', () => {
  it('"- DOP 540.00" keeps its amount and leaves the account; "+ DOP 1,000.00" enters it', () => {
    expect(parseMovementAmount('- DOP 540.00')).toMatchObject({ ok: true, minor: 54000, currency: 'DOP', direction: 'out' });
    expect(parseMovementAmount('+ DOP 1,000.00')).toMatchObject({ ok: true, minor: 100000, currency: 'DOP', direction: 'in' });
    expect(parseMovementAmount('-RD$500.00')).toMatchObject({ ok: true, minor: 50000, direction: 'out' });
    expect(parseMovementAmount('RD$ -2,000.00')).toMatchObject({ ok: true, minor: 200000, direction: 'out' });
    expect(parseMovementAmount('RD$-1.00')).toMatchObject({ ok: true, minor: 100, direction: 'out' });
    expect(parseMovementAmount('(500.00)')).toMatchObject({ ok: true, minor: 50000, direction: 'out' });
    expect(parseMovementAmount('- DOP 0.02')).toMatchObject({ ok: true, minor: 2, direction: 'out' });
  });

  it('an amount with no sign states no direction (one bank prints none on incoming money)', () => {
    expect(parseMovementAmount('RD$14,113.50')).toMatchObject({ ok: true, minor: 1411350, currency: 'DOP', direction: null });
    expect(signOf('RD$1,500.00')).toBeNull();
  });

  it('a hyphen inside a reference is not a minus', () => {
    expect(signOf('REF-1234 RD$ 500.00')).toBeNull();
  });

  it('a bank reference is never an amount, and zero or nothing is still refused', () => {
    expect(parseMovementAmount('243345091375')).toEqual({ ok: false, reason: 'reference' });
    expect(parseMovementAmount('9243435424047')).toEqual({ ok: false, reason: 'reference' });
    expect(parseMovementAmount('RD$ 0.00')).toEqual({ ok: false, reason: 'zero' });
    expect(parseMovementAmount('')).toEqual({ ok: false, reason: 'empty' });
    expect(parseMovementAmount('abc')).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('the type follows the evidence: sign, arrow and wording', () => {
  const row = (over: Partial<RawTransaction>): RawTransaction => ({ kind: 'unknown', confidence: {}, ...over });

  it('no type but a direction: money out is an expense, money in is income, and the tray says it was inferred', () => {
    expect(decideKind(row({ amountText: '- DOP 64.98', description: 'COMISION USO ATM' }))).toMatchObject({ kind: 'expense', direction: 'out', inferred: true, conflict: false });
    expect(decideKind(row({ amountText: 'RD$6,000.00', direction: 'in', description: 'TRANSFERENCIA ACH DE ABC' }))).toMatchObject({ kind: 'income', direction: 'in', inferred: true });
  });

  it('no type and no direction stays unknown: the app never guesses', () => {
    expect(decideKind(row({ amountText: 'RD$500.00', description: 'MOVIMIENTO' }))).toMatchObject({ kind: 'unknown', direction: null, conflict: false });
  });

  it('the printed sign wins over what the model says it saw in the arrow', () => {
    expect(decideKind(row({ kind: 'expense', amountText: '+ DOP 1,000.00', direction: 'out' })).conflict).toBe(true); // the sign says in, the type says expense
    expect(decideKind(row({ kind: 'income', amountText: '- DOP 1,000.00' }))).toMatchObject({ kind: 'unknown', conflict: true });
  });

  it('payroll is income, unless the money left', () => {
    expect(decideKind(row({ kind: 'unknown', amountText: 'RD$14,113.50', direction: 'in', description: 'PAGO NOMINA 1RA DE NOVIEMBRE' }))).toMatchObject({ kind: 'income', inferred: true });
    expect(decideKind(row({ kind: 'income', amountText: 'RD$14,113.50', direction: 'in', description: 'PAGO NOMINA 1RA' }))).toMatchObject({ kind: 'income', inferred: false });
    expect(decideKind(row({ kind: 'expense', amountText: '- RD$14,113.50', description: 'DEVOLUCION NOMINA' })).kind).toBe('unknown'); // a refund is the user's call
  });

  it('money between the user\'s own accounts is a transfer, never income or expense (rule 1)', () => {
    expect(decideKind(row({ kind: 'income', amountText: '+ DOP 1,000.00', description: 'TRANSFERENCIA PROPIA' }))).toMatchObject({ kind: 'internal_transfer', inferred: true, conflict: false });
    expect(decideKind(row({ kind: 'expense', amountText: '- DOP 2,870.00', description: 'TRANSFERENCIA PROPIA' })).kind).toBe('internal_transfer');
  });

  it('paying a card from an account is a card payment', () => {
    expect(decideKind(row({ kind: 'expense', amountText: '- DOP 1,500.00', description: 'PAGO TARJETA 7108' })).kind).toBe('card_payment');
  });

  it('a type that already agrees with the evidence is left alone', () => {
    expect(decideKind(row({ kind: 'expense', amountText: '-RD$550.00', description: 'HOM LIQUOR' }))).toMatchObject({ kind: 'expense', inferred: false, conflict: false });
    expect(decideKind(row({ kind: 'loan_payment', amountText: '- DOP 5,000.00' })).kind).toBe('loan_payment');
  });
});

describe('the bank\'s own tax row belongs to the movement it was charged on', () => {
  const tx = (over: Partial<RawTransaction>): RawTransaction => ({ kind: 'expense', confidence: {}, ...over });

  it('the same reference with a leading 9 is the tax of that movement: folded, not a second expense', () => {
    const rows = [
      tx({ description: 'TRANSFERENCIA A JUAN', amountText: '- DOP 500.00', reference: '243435424047' }),
      tx({ description: 'COBRO IMP DGII 0.20%', amountText: '- DOP 1.00', reference: '9243435424047' }),
      tx({ description: 'JUMBO', amountText: '- DOP 200.84', reference: '559146' }),
    ];
    const out = foldBankCharges(rows);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ description: 'TRANSFERENCIA A JUAN', bankFeeText: 'DOP 1.00' });
    expect(out[1].bankFeeText).toBeUndefined();
  });

  it('a tax with no parent, or with two possible parents, stays as its own row', () => {
    expect(foldBankCharges([tx({ description: 'PAGO IMPUESTO 0.20 DGII', amountText: '-RD$1.00' })])).toHaveLength(1);
    const two = [
      tx({ description: 'A', amountText: '- DOP 500.00', reference: '243435424047' }),
      tx({ description: 'B', amountText: '- DOP 700.00', reference: '243435424047' }),
      tx({ description: 'COBRO IMP DGII 0.20%', amountText: '- DOP 1.00', reference: '9243435424047' }),
    ];
    expect(foldBankCharges(two)).toHaveLength(3);
  });

  it('a charge is never folded into money that ENTERED', () => {
    const rows = [
      tx({ kind: 'income', description: 'TRANSFERENCIA ACH DE X', amountText: '+ DOP 500.00', reference: '243435424047' }),
      tx({ description: 'COBRO IMP DGII 0.20%', amountText: '- DOP 1.00', reference: '9243435424047' }),
    ];
    expect(foldBankCharges(rows)).toHaveLength(2);
  });

  it('parentReference only strips the leading digit of a long reference', () => {
    expect(parentReference('9243435424047')).toBe('243435424047');
    expect(parentReference('243435424047')).toBeNull();
    expect(parentReference('559146')).toBeNull();
  });

  it('text cut by the app loses its dots, nothing else', () => {
    expect(trimEllipsis('TRANSFERENCIA A ABC...')).toBe('TRANSFERENCIA A ABC');
    expect(trimEllipsis('JUMBO LUPERON…')).toBe('JUMBO LUPERON');
    expect(trimEllipsis('MI GU')).toBe('MI GU');
    expect(trimEllipsis('...')).toBeUndefined();
  });
});

function ctx(over: Partial<BuildContext> = {}): BuildContext {
  return {
    source: 'image',
    today: TODAY,
    nowIso: '2026-11-24T10:00:00.000Z',
    newId: (() => { let n = 0; return () => `id-${++n}`; })(),
    accounts: [
      account({ id: 'chk', name: 'Cuenta corriente', type: 'bank', last4: '1111' }),
      account({ id: 'sav', name: 'Cuenta de ahorro', type: 'savings', last4: '2222' }),
      account({ id: 'visa', name: 'Visa', type: 'card', cardKind: 'credit', last4: '7108' }),
    ],
    bankNameOf: () => '',
    goals: [],
    loans: [],
    categoryFor: () => undefined,
    categoryByName: (n) => (n === 'Bank fees' ? 'cat-bank-fees' : undefined),
    incomeSourceFor: (t) => (/nomina/i.test(t) ? 'src-payroll' : undefined),
    ...over,
  };
}

describe('buildDraft from a movement list', () => {
  it('an expense printed with a minus keeps its amount (it used to arrive with the amount empty)', () => {
    const d = buildDraft({ kind: 'expense', amountText: '- DOP 540.00', dateText: 'Agosto 31, 2026', description: 'SUPER COMPRA', accountLast4: '1111', confidence: {} }, ctx());
    expect(d).toMatchObject({ kind: 'expense', amountMinor: 54000, currency: 'DOP', direction: 'out', occurredAt: '2026-08-31', resolvedAccountId: 'chk' });
    expect(d.doubts).not.toContain('amount-missing');
  });

  it('the payroll deposit with no sign: the amount is kept, it is income, and its source is found', () => {
    const d = buildDraft({ kind: 'unknown', amountText: 'RD$14,113.50', direction: 'in', dateText: '13 nov 2026', description: 'PAGO NOMINA 1RA DE...', accountLast4: '1111', confidence: {} }, ctx());
    expect(d).toMatchObject({ kind: 'income', amountMinor: 1411350, direction: 'in', occurredAt: '2026-11-13', resolvedAccountId: 'chk', resolvedIncomeSourceId: 'src-payroll', description: 'PAGO NOMINA 1RA DE' });
    expect(d.doubts).toEqual(['kind-inferred']);
    expect(missingFor(d, { accounts: ctx().accounts })).toEqual([]);
  });

  it('a reference read as the amount is not an amount: the user enters it', () => {
    const d = buildDraft({ kind: 'expense', amountText: '243345091375', description: 'X', confidence: {} }, ctx());
    expect(d.amountMinor).toBeUndefined();
    expect(d.doubts).toContain('amount-missing');
  });

  it('a contradiction cannot be approved until the user chooses the type', () => {
    const d = buildDraft({ kind: 'income', amountText: '- DOP 2,000.00', dateText: '13 nov 2026', description: 'X', accountLast4: '1111', confidence: {} }, ctx());
    expect(d.kind).toBe('unknown');
    expect(d.doubts).toEqual(expect.arrayContaining(['direction-conflict', 'kind-unknown']));
    expect(missingFor(d, { accounts: ctx().accounts })).toContain('kind');
  });

  it('money that entered a credit card is a card payment, never income', () => {
    const d = buildDraft({ kind: 'income', amountText: '+ DOP 2,000.00', dateText: 'Noviembre 02, 2026', description: 'PAGO RECIBIDO VIA TUBANCO', accountLast4: '7108', confidence: {} }, ctx());
    expect(d).toMatchObject({ kind: 'card_payment', resolvedToAccountId: 'visa', direction: 'in' });
    expect(d.doubts).toContain('kind-inferred');
  });

  it('a transfer that ENTERED the account of the screenshot makes that account the destination', () => {
    const d = buildDraft({ kind: 'income', amountText: '+ DOP 1,000.00', dateText: 'Octubre 29, 2026', description: 'TRANSFERENCIA PROPIA', accountLast4: '1111', confidence: {} }, ctx());
    expect(d).toMatchObject({ kind: 'internal_transfer', resolvedToAccountId: 'chk', direction: 'in' });
    expect(d.resolvedAccountId).toBeUndefined(); // the origin is the other account: the user (or the pairing) says which
  });

  it('a transfer that LEFT keeps the account of the screenshot as the origin', () => {
    const d = buildDraft({ kind: 'expense', amountText: '- DOP 2,870.00', dateText: 'Noviembre 02, 2026', description: 'TRANSFERENCIA PROPIA', accountLast4: '1111', toAccountLast4: '2222', confidence: {} }, ctx());
    expect(d).toMatchObject({ kind: 'internal_transfer', resolvedAccountId: 'chk', resolvedToAccountId: 'sav', direction: 'out' });
  });

  it('a bank charge that has no parent is an expense in Bank fees', () => {
    const d = buildDraft({ kind: 'unknown', amountText: '-RD$1.00', dateText: '13 nov 2026', description: 'PAGO IMPUESTO 0.20 DGII', accountLast4: '1111', confidence: {} }, ctx());
    expect(d).toMatchObject({ kind: 'expense', amountMinor: 100, resolvedCategoryId: 'cat-bank-fees' });
  });

  it('the answer of the model keeps the direction and drops an invented one', () => {
    // direction travels through the same sanitizing as every field
    const raw = { kind: 'expense', direction: 'sideways', confidence: {} } as unknown as RawTransaction;
    expect(decideKind(raw).direction).toBeNull();
  });
});

describe('the two sides of one transfer', () => {
  const d = (over: Partial<CaptureDraft>): CaptureDraft => ({ id: 'x', createdAt: '2026-11-24T10:00:00Z', source: 'image', status: 'pending', kind: 'unknown', confidence: {}, doubts: [], currency: 'DOP', ...over });

  const out = d({ id: 'out', kind: 'expense', direction: 'out', amountMinor: 600000, occurredAt: '2026-11-20', description: 'Pago ACH MB a 96072', resolvedAccountId: 'chk', bankFeeMinor: 1200 });
  const inn = d({ id: 'in', kind: 'income', direction: 'in', amountMinor: 600000, occurredAt: '2026-11-20', description: 'TRANSFERENCIA ACH DE', resolvedAccountId: 'sav' });

  it('same amount, opposite directions, same days, and the wording of a transfer: they are the same transfer', () => {
    expect(findTransferPair(out, [out, inn])?.id).toBe('in');
    expect(findTransferPair(inn, [out, inn])?.id).toBe('out');
  });

  it('a purchase that happens to share the amount of a deposit is not a transfer', () => {
    const shop = d({ id: 'shop', kind: 'expense', direction: 'out', amountMinor: 600000, occurredAt: '2026-11-20', description: 'JUMBO LUPERON' });
    const gift = d({ id: 'gift', kind: 'income', direction: 'in', amountMinor: 600000, occurredAt: '2026-11-20', description: 'DEPOSITO' });
    expect(findTransferPair(shop, [shop, gift])).toBeNull();
  });

  it('two possible partners is ambiguity: nothing is proposed', () => {
    const twin = { ...inn, id: 'in2' };
    expect(findTransferPair(out, [out, inn, twin])).toBeNull();
  });

  it('different amounts, the same direction, far dates, another currency or the same account never pair', () => {
    expect(findTransferPair(out, [out, { ...inn, amountMinor: 600100 }])).toBeNull();
    expect(findTransferPair(out, [out, { ...inn, direction: 'out' }])).toBeNull();
    expect(findTransferPair(out, [out, { ...inn, occurredAt: '2026-11-24' }])).toBeNull();
    expect(findTransferPair(out, [out, { ...inn, currency: 'USD' }])).toBeNull();
    expect(findTransferPair(out, [out, { ...inn, resolvedAccountId: 'chk' }])).toBeNull();
    expect(findTransferPair(out, [out, { ...inn, status: 'approved' }])).toBeNull();
  });

  it('"not the same" is remembered', () => {
    expect(findTransferPair(out, [{ ...out, notPairedWith: ['in'] }, inn])).toBeNull();
  });

  it('combining makes ONE transfer from the origin to the destination, keeps the bank tax and absorbs the other side', () => {
    const plan = combinePatch(out, inn);
    expect(plan).toMatchObject({ keep: 'out', absorb: 'in' });
    expect(plan!.patch).toMatchObject({ kind: 'internal_transfer', resolvedAccountId: 'chk', resolvedToAccountId: 'sav', bankFeeMinor: 1200 });
    // it works the same from either side
    expect(combinePatch(inn, out)).toMatchObject({ keep: 'out', absorb: 'in' });
  });

  it('a card payment (PAGO TARJETA on the account, PAGO RECIBIDO on the card) combines into a card payment', () => {
    const pay = d({ id: 'pay', kind: 'card_payment', direction: 'out', amountMinor: 150000, occurredAt: '2026-11-13', description: 'PAGO TARJETA 7108', resolvedAccountId: 'sav', resolvedToAccountId: 'visa' });
    const recv = d({ id: 'recv', kind: 'card_payment', direction: 'in', amountMinor: 150000, occurredAt: '2026-11-13', description: 'PAGO RECIBIDO VIA TUBANCO', resolvedToAccountId: 'visa' });
    expect(findTransferPair(pay, [pay, recv])?.id).toBe('recv');
    expect(combinePatch(pay, recv)!.patch).toMatchObject({ kind: 'card_payment', resolvedAccountId: 'sav', resolvedToAccountId: 'visa' });
  });
});

describe('a transfer the user already registered is not registered again from one of its legs', () => {
  const t = transaction({ id: 't1', type: 'transfer', amount: 6000, date: '2026-11-20', accountId: 'chk', toAccountId: 'sav' });
  const leg = (over: Partial<CaptureDraft>): CaptureDraft => ({ id: 'd', createdAt: '2026-11-24T10:00:00Z', source: 'image', status: 'pending', kind: 'income', confidence: {}, doubts: [], currency: 'DOP', amountMinor: 600000, occurredAt: '2026-11-20', ...over });

  it('the entering leg and the leaving leg are both that transfer', () => {
    expect(findDuplicate(leg({ direction: 'in', resolvedAccountId: 'sav' }), [], [t])).toEqual({ why: 'transfer-leg', of: { type: 'transaction', id: 't1' } });
    expect(findDuplicate(leg({ kind: 'expense', direction: 'out', resolvedAccountId: 'chk' }), [], [t])).toEqual({ why: 'transfer-leg', of: { type: 'transaction', id: 't1' } });
  });

  it('the wrong side, another amount, a reversed transfer or an old one are not', () => {
    expect(findDuplicate(leg({ direction: 'in', resolvedAccountId: 'chk' }), [], [t])).toBeNull(); // money entering the ORIGIN is not that transfer
    expect(findDuplicate(leg({ amountMinor: 600100, direction: 'in', resolvedAccountId: 'sav' }), [], [t])).toBeNull();
    expect(findDuplicate(leg({ direction: 'in', resolvedAccountId: 'sav' }), [], [{ ...t, status: 'reversed' }])).toBeNull();
    expect(findDuplicate(leg({ occurredAt: '2026-11-01', direction: 'in', resolvedAccountId: 'sav' }), [], [t])).toBeNull();
  });
});

describe('balance-check: the pending captures explain part of a difference (2.25.0)', () => {
  const dr = (over: Partial<CaptureDraft>): CaptureDraft => ({ id: 'x', createdAt: '2026-11-24T10:00:00Z', source: 'image', status: 'pending', kind: 'expense', confidence: {}, doubts: [], currency: 'DOP', amountMinor: 10000, ...over });

  it('a credit card figure is what is owed: the app holds it as negative', () => {
    expect(bankBalanceOf({ balanceMinor: 120000, accountType: 'credit_card' }, undefined)).toBe(-1200);
    expect(bankBalanceOf({ balanceMinor: 120000 }, { type: 'card', cardKind: 'credit' })).toBe(-1200);
    expect(bankBalanceOf({ balanceMinor: 120000, accountType: 'checking' }, { type: 'bank' })).toBe(1200);
    expect(bankBalanceOf({}, undefined)).toBeNull();
  });

  it('sums what approving the waiting drafts would do to one account, fees included', () => {
    const drafts = [
      dr({ id: '1', resolvedAccountId: 'a', amountMinor: 50000 }), // -500
      dr({ id: '2', kind: 'income', resolvedAccountId: 'a', amountMinor: 200000 }), // +2000
      dr({ id: '3', kind: 'internal_transfer', resolvedAccountId: 'a', resolvedToAccountId: 'b', amountMinor: 100000, bankFeeMinor: 200 }), // -1002
      dr({ id: '4', kind: 'internal_transfer', resolvedAccountId: 'b', resolvedToAccountId: 'a', amountMinor: 30000 }), // +300
      dr({ id: '5', resolvedAccountId: 'b', amountMinor: 99900 }), // another account
      dr({ id: '6', resolvedAccountId: 'a', amountMinor: 70000, status: 'rejected' }), // not waiting
      dr({ id: '7', resolvedAccountId: 'a', amountMinor: 70000, currency: 'USD' }), // another currency
      dr({ id: '8', resolvedAccountId: 'a', amountMinor: undefined }), // no amount: counts as nothing
    ];
    expect(pendingEffect(drafts, 'a', 'DOP')).toBe(798);
  });
});
