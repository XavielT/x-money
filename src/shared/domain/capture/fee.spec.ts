// The bank's tax printed in its own notice is read from the text. The wording below follows a real Banreservas
// transfer email (2026-11-07) with INVENTED names, digits and numbers (this repository is public); a bank that
// words it differently is added here as a fixture.
import { describe, expect, it } from 'vitest';
import { bankTaxInText } from './fee';

const TRANSFER_EMAIL = '¡Transacción realizada! Te notificamos que la siguiente transacción fue realizada desde tu App Banreservas: Monto: DOP 2,000.00 Transacción: Transferencia a Tercero Origen: JUAN PEREZ, Cuenta de ahorro DOP ** - 1111 Destino: MARIA LOPEZ, Cuenta de ahorro DOP ** - 2222 Fecha de transacción: 7 de Noviembre de 2026 - 7:12 PM Impuestos: DOP 4.00 Número de transacción: 100000000001';

describe('bankTaxInText', () => {
  it('reads the tax of a Banreservas transfer email', () => expect(bankTaxInText(TRANSFER_EMAIL)).toBe('DOP 4.00'));

  it('works with line breaks, accents and other ways of printing it', () => {
    expect(bankTaxInText('Monto: DOP 500.00\nImpuestos:  DOP 1.00\nReferencia 5')).toBe('DOP 1.00');
    expect(bankTaxInText('Impuesto DGII 0.20%: RD$ 1.00')).toBe('RD$ 1.00');
    expect(bankTaxInText('IMPUESTOS DOP 1,250.50')).toBe('DOP 1,250.50');
    expect(bankTaxInText('Impuestos 4.00')).toBe('4.00');
  });

  it('says nothing when the text states no tax: a purchase notice, a deposit, an empty text', () => {
    expect(bankTaxInText('Gracias por utilizar su Tarjeta Debito terminada en 1234. Monto RD$239.13 SUPERMERCADO Aprobada')).toBeUndefined();
    expect(bankTaxInText('Se acreditó RD$ 45,000.00 en su cuenta terminada en 5678')).toBeUndefined();
    expect(bankTaxInText('')).toBeUndefined();
    expect(bankTaxInText(undefined)).toBeUndefined();
  });

  it('never reads the ITBIS of an invoice as the bank tax', () => {
    expect(bankTaxInText('Subtotal 202.66 ITBIS: RD$ 36.47 Total 239.13')).toBeUndefined();
    expect(bankTaxInText('Impuesto ITBIS 36.47')).toBeUndefined();
  });
});
