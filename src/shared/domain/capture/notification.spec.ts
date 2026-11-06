// Bank-app notifications read on the device. The wordings below are REPRESENTATIVE of Dominican bank
// notices, not captured from a bank: the reader is tolerant by design and anything it cannot read is left
// for the user in the tray. A real notification that is read wrong must be added here as a fixture.
import { describe, expect, it } from 'vitest';
import { BankNotification, cardDigitsIn, localDateOf, readBankNotification } from './notification';

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
