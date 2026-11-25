// 2.26.0: the places of one real month that were filed under "Other" (invented amounts, real kinds of places).
import { transaction } from '../testing/builders';
import { hintFor, normalizePlace } from './merchant-categories';
import { OTHER_EXPENSE_ID, otherGroups } from './other-review';

describe('what a place is known for (no AI)', () => {
  it('gas stations are Fuel, however the bank writes them', () => {
    for (const text of ['SHELL AV LUPERON', 'ESTACION TOTAL ENERGY CHA', 'TOTAL ENERGIES BELLA N~~SANTO DOMINGO~', 'Texaco Autopista', 'Gasolinera Rosa', 'COMBUSTIBLE']) {
      expect(hintFor(text)?.categoryId, text).toBe('cat-fuel');
    }
  });

  it('supermarkets, pharmacies, utilities, subscriptions and the bank\'s own charges', () => {
    expect(hintFor('JUMBO LUPERON')?.categoryId).toBe('cat-groceries');
    expect(hintFor('EXI HIPER OLE SAN ISIDRO BASE')?.categoryId).toBe('cat-groceries');
    expect(hintFor('SM BRAVO SAN ISIDRO II')?.categoryId).toBe('cat-groceries');
    expect(hintFor('Colmado Rosa')?.categoryId).toBe('cat-groceries');
    expect(hintFor('FARM HIDALGOS CEILO')?.categoryId).toBe('cat-health');
    expect(hintFor('Edeeste')?.categoryId).toBe('cat-electricity');
    expect(hintFor('APPLE.COM/BILL 866-712-7753 US')?.categoryId).toBe('cat-subscriptions');
    expect(hintFor('PAYPAL *SPOTIFY*P48B')?.categoryId).toBe('cat-subscriptions');
    expect(hintFor('PAGO IMPUESTO 0.20 DGII 2 TRANS POR $ 2,500.00')?.categoryId).toBe('cat-bank-fees');
    expect(hintFor('COMISION USO ATM')?.categoryId).toBe('cat-bank-fees');
    expect(hintFor('CORPORACION AAA PARKING')?.categoryId).toBe('cat-parking');
    expect(hintFor('CLARO RECAR 8099539782')?.categoryId).toBe('cat-phone');
    expect(hintFor('HOM LIQUOR 30 DE MAYO')?.categoryId).toBe('cat-going-out');
    expect(hintFor('DLO*TEMU.COM SANTO DOMINGO')?.categoryId).toBe('cat-shopping');
  });

  it('street food places are Food', () => {
    for (const text of ['AURELIA NABO', 'Naboa Aurelia', 'Chimi Don Pepe', 'Comedor Maria']) expect(hintFor(text)?.categoryId, text).toBe('cat-food');
  });

  it('the first rule wins: "uber eats" is delivery, plain "uber" is transport', () => {
    expect(hintFor('UBER*EATS SANTO DOMINGO')?.categoryId).toBe('cat-delivery');
    expect(hintFor('UBER TRIP')?.categoryId).toBe('cat-transport');
  });

  it('a transfer to a person is money sent, not a purchase', () => {
    for (const text of ['MB a 0842189607 Daisy', 'Pago ACH MB a 16024750017', 'Transferencia a Juan Perez']) expect(hintFor(text)?.categoryId, text).toBe('cat-sent-people');
  });

  it('an income says where it came from by its wording', () => {
    expect(hintFor('MB desde 840660534 felix yoser', 'income')?.categoryId).toBe('cat-received-people');
    expect(hintFor('TRANSFERENCIA ACH DE', 'income')?.categoryId).toBe('cat-received-people');
    expect(hintFor('Office reimbursement', 'income')?.categoryId).toBe('cat-reimbursements');
    expect(hintFor('PAGO NOMINA 1RA DE NOVIEMBRE', 'income')?.categoryId).toBe('cat-salary');
    expect(hintFor('PAYROLL deposit', 'income')?.categoryId).toBe('cat-salary');
  });

  it('what it does not know it leaves alone: never a guess', () => {
    for (const text of ['CIRASOL SANTO DOMINGO', 'Algo raro', '', undefined]) expect(hintFor(text)).toBeNull();
    expect(hintFor('Supermercado Shellfish')?.categoryId).toBe('cat-groceries'); // a word is a whole word: "shellfish" is not "shell"
    expect(hintFor('JUMBO', 'income')).toBeNull();
  });

  it('normalizes accents, symbols and case', () => {
    expect(normalizePlace('  Café*Ñandú, S.A. 123 ')).toBe('cafe nandu s a 123');
  });
});

describe('the expenses filed under "Other", by place', () => {
  const t = (note: string, amount: number, date: string, over = {}) => transaction({ type: 'expense', categoryId: OTHER_EXPENSE_ID, note, amount, date, ...over });
  const all = [
    t('SHELL AV LUPERON · ref 1', 400, '2026-11-18'),
    t('SHELL AV LUPERON · ref 2', 160, '2026-11-16'),
    t('ESTACION TOTAL ENERGY CHA', 1000, '2026-11-11'),
    t('CIRASOL SANTO DOMINGO', 330, '2026-11-19'),
    t('MB a 0842189607 Daisy', 500, '2026-11-06'),
    t('MB a 0842189607 Daisy', 1000, '2026-11-21'),
    t('JUMBO LUPERON', 183.68, '2026-11-18', { categoryId: 'cat-groceries' }), // already filed: not here
    t('SHELL REVERSED', 50, '2026-11-17', { status: 'reversed' }),
    t('Ajuste', 10, '2026-11-17', { origin: 'adjustment' }),
    t('', 20, '2026-11-17'), // no place: nothing to group by
  ];

  it('groups by place, newest first, biggest total first, with the built-in proposal', () => {
    const g = otherGroups(all);
    expect(g.map((x) => [x.label, x.count, x.total, x.suggestion])).toEqual([
      ['MB a 0842189607 Daisy', 2, 1500, 'cat-sent-people'],
      ['ESTACION TOTAL ENERGY CHA', 1, 1000, 'cat-fuel'],
      ['SHELL AV LUPERON', 2, 560, 'cat-fuel'],
      ['CIRASOL SANTO DOMINGO', 1, 330, undefined],
    ]);
    expect(g[2].ids).toHaveLength(2);
  });

  it('a proposal for a category that does not exist is not offered', () => {
    expect(otherGroups(all, (id) => id !== 'cat-fuel').find((x) => x.label.startsWith('SHELL'))?.suggestion).toBeUndefined();
  });

  it('RD$ and US$ are never in one group', () => {
    const g = otherGroups([t('SHELL AV LUPERON', 10, '2026-11-18'), t('SHELL AV LUPERON', 5, '2026-11-18', { currency: 'USD' })]);
    expect(g.map((x) => [x.currency, x.total]).sort()).toEqual([['DOP', 10], ['USD', 5]]);
  });
});
