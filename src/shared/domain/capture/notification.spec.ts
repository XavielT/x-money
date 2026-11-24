// Bank-app notifications read on the device. The wordings below are REPRESENTATIVE of Dominican bank
// notices, not captured from a bank: the reader is tolerant by design and anything it cannot read is left
// for the user in the tray. A real notification that is read wrong must be added here as a fixture.
import { describe, expect, it } from 'vitest';
import { BankNotification, bankOfSender, cardDigitsIn, localDateOf, readBankNotification, readBankText } from './notification';

const POPULAR = 'com.popular.app.android';
const BR = 'com.banreservas.tubancoappmobile';
const at = new Date(2026, 10, 6, 15, 12).getTime(); // 6 Nov 2026, local time

const n = (pkg: string, title: string, text: string): BankNotification => ({ pkg, title, text, postedAt: at });

describe('readBankNotification', () => {
  it('reads a debit card purchase: amount, currency, card digits, merchant, day', () => {
    const r = readBankNotification(n(POPULAR, 'Popular', 'Compra por RD$1,250.50 con su tarjeta de débito terminada en 4237 en SUPERMERCADO NACIONAL.'))!;
    expect(r.kind).toBe('expense');
    expect(r.amountText).toBe('RD$1,250.50');
    expect(r.currencyHint).toBe('DOP');
    expect(r.accountLast4).toBe('4237');
    expect(r.counterparty).toBe('SUPERMERCADO NACIONAL');
    expect(r.bankName).toBe('Banco Popular');
    expect(r.dateText).toBe('2026-11-06');
  });

  it('prefers the date printed in the notice over the day it arrived', () => {
    const r = readBankNotification(n(BR, 'Banreservas', 'Consumo de RD$ 500.00 con tarjeta ****4237 en FARMACIA CAROL el 05/11/2026 08:15 PM'))!;
    expect(r.dateText).toBe('05/11/2026');
    expect(r.counterparty).toBe('FARMACIA CAROL');
  });

  it('keeps US$ separate from RD$', () => {
    const r = readBankNotification(n(POPULAR, 'Popular', 'Consumo por US$ 12.99 con su tarjeta terminada en 4237 en NETFLIX.COM'))!;
    expect(r.currencyHint).toBe('USD');
    expect(r.amountText).toBe('US$ 12.99');
  });

  it('skips the balance and takes the movement amount', () => {
    const r = readBankNotification(n(POPULAR, 'Popular', 'Balance disponible RD$ 85,000.00. Compra de RD$ 300.00 con tarjeta terminada en 4237'))!;
    expect(r.amountText).toBe('RD$ 300.00');
  });

  it('reads a deposit as income', () => {
    const r = readBankNotification(n(BR, 'Banreservas', 'Se acreditó RD$ 45,000.00 en su cuenta terminada en 6770'))!;
    expect(r.kind).toBe('income');
    expect(r.accountLast4).toBe('6770');
  });

  it('leaves refunds, sent transfers and card payments for the user to classify', () => {
    expect(readBankNotification(n(POPULAR, 'Popular', 'Devolución de RD$ 100.00 a su tarjeta terminada en 4237'))!.kind).toBe('unknown');
    expect(readBankNotification(n(POPULAR, 'Popular', 'Transferencia por RD$ 2,000.00 desde su cuenta terminada en 6770'))!.kind).toBe('unknown');
    expect(readBankNotification(n(POPULAR, 'Popular', 'Pago de su tarjeta por RD$ 5,000.00'))!.kind).toBe('unknown');
  });

  it('never makes a draft out of notices that are not movements', () => {
    expect(readBankNotification(n(POPULAR, 'Popular', 'Tu código de verificación es 482913'))).toBeNull();
    expect(readBankNotification(n(POPULAR, 'Popular', 'Aprovecha: préstamo desde RD$ 50,000'))).toBeNull(); // an amount but no movement word
    expect(readBankNotification(n(POPULAR, 'Popular', 'Compra aprobada con su tarjeta terminada en 4237'))).toBeNull(); // no amount
  });

  it('only reads the bank apps it knows', () => {
    expect(readBankNotification(n('com.whatsapp', 'Mamá', 'Compra de RD$ 500.00'))).toBeNull();
  });
});

describe('cardDigitsIn', () => {
  it.each([
    ['tarjeta de débito terminada en 4237', '4237'],
    ['con tarjeta ****4237', '4237'],
    ['terminación 4237', '4237'],
    ['cuenta XXXXXX6770', '6770'],
    ['su tarjeta 4237 de la cuenta 6770', '4237'], // the card wins over the account
  ])('%s', (text, want) => expect(cardDigitsIn(text)).toBe(want));

  it('does not take part of a longer number or a plain amount', () => {
    expect(cardDigitsIn('Compra por RD$1,250.50')).toBeUndefined();
    expect(cardDigitsIn('referencia 123456789')).toBeUndefined();
  });
});

describe('localDateOf', () => {
  it('uses the phone calendar day', () => expect(localDateOf(at)).toBe('2026-11-06'));
});

describe('the amount printed after its currency (2.25.0)', () => {
  const note = (text: string) => ({ pkg: 'com.popular.app.android', title: 'Popular', text, postedAt: Date.parse('2026-11-13T09:00:00') });

  it('"14,113.50 pesos" is read, and the payroll deposit is income', () => {
    const r = readBankNotification(note('Se acredito la nomina por 14,113.50 pesos en su cuenta.'));
    expect(r).toMatchObject({ kind: 'income', amountText: '14,113.50 pesos', currencyHint: 'DOP' });
  });

  it('a balance printed that way is still not the movement', () => {
    expect(readBankNotification(note('Deposito acreditado. Balance disponible 9,000.00 pesos'))).toBeNull();
  });
});

// 2.25.1: what the offline reader did to real bank e-mails (card ending, phone number, day and reference read as amounts, one
// draft per line). The wordings are invented; only their SHAPE comes from the phone.
describe('a bank e-mail is ONE movement, read by its currency (2.25.1)', () => {
  const popular = 'Gracias por utilizar su Tarjeta Debito Digital/QR, terminada en 4237.\nRD$160.00 Peso dominicano 13/11/2026 SHELL AV LUPERON...\nPara mas informacion llamando al 809-000-0000.';
  const banreservas = 'JUAN PEREZ, Cuenta de ahorro DOP ** - 1234\n19 de Noviembre de 2026 - 2:52 PM\nCobro impuesto DGII 0.20% DOP 3.90\nReferencia 243521559489';

  it('a debit card notice: the amount is the one next to RD$, never the card ending or the phone number', () => {
    const r = readBankText({ text: popular, bankName: 'Banco Popular', dateIso: '2026-11-18' })!;
    expect(r).toMatchObject({ kind: 'expense', amountText: 'RD$160.00', currencyHint: 'DOP', accountLast4: '4237', dateText: '13/11/2026', counterparty: 'SHELL AV LUPERON' });
  });

  it('a bank charge: amount with DOP, the printed long date, and no digits of the account or the reference as an amount', () => {
    const r = readBankText({ text: banreservas, bankName: 'Banreservas', dateIso: '2026-11-24' })!;
    expect(r).toMatchObject({ kind: 'expense', amountText: 'DOP 3.90', dateText: '19 de Noviembre de 2026' });
    expect(r.description).not.toMatch(/PEREZ/); // the holder's name is not a description
  });

  it('a text with no movement wording is not a draft, and a notice with no amount waits with the amount empty', () => {
    expect(readBankText({ text: 'Llame al 809-000-0000 para mas informacion', dateIso: '2026-11-18' })).toBeNull();
    const r = readBankText({ text: 'Se realizo una transferencia desde su cuenta terminada en 1234', dateIso: '2026-11-18' })!;
    expect(r.amountText).toBeUndefined();
  });

  it('the bank is named by the sender domain', () => {
    expect(bankOfSender('notificaciones@banreservas.com')).toBe('Banreservas');
    expect(bankOfSender('<notificaciones@popularenlinea.com>')).toBe('Banco Popular');
    expect(bankOfSender('promo@example.com')).toBeUndefined();
  });
});
