// 2.26.1: a reader that skips a row of a long list must not do it silently. Synthetic text only.
import { amountsIn, unreadAmounts } from './unread';

describe('the amounts that are in a text', () => {
  it('finds money, not dates, phones, references, percentages or balances', () => {
    const text = 'Corriente 6770 | 2026-11-14 + DOP 2,500.00 MB desde 840660534 felix | 2026-11-20 - DOP 5.00 PAGO IMPUESTO 0.20 DGII | Balance disponible DOP 7,608.94 | llamar 809-544-5555 ref 243537925783';
    expect(amountsIn(text)).toEqual([250000, 500]);
  });

  it('counts each amount once, and ignores anything under 1.00', () => {
    expect(amountsIn('DOP 6,000.00 y otra vez DOP 6,000.00; fee 0.50')).toEqual([600000]);
  });

  it('reads the two decimal shapes', () => {
    expect(amountsIn('RD$ 1.250,50 y RD$ 1,250.50')).toEqual([125050]);
  });
});

describe('what a reader left out', () => {
  const text = 'DOP 2,500.00 felix | DOP 1,000.00 Daisy | DOP 6,000.00 ACH';

  it('lists the amounts of the text that no draft carries', () => {
    expect(unreadAmounts(text, [{ amountMinor: 250000 }])).toEqual([100000, 600000]);
  });

  it('an amount that is a draft\'s bank tax, tax or line is not "missing"', () => {
    expect(unreadAmounts(text, [{ amountMinor: 250000, bankFeeMinor: 100000 }, { amountMinor: 1, lines: [{ description: 'x', amountMinor: 600000 }] }])).toEqual([]);
  });

  it('nothing is missing when every amount was read', () => {
    expect(unreadAmounts(text, [{ amountMinor: 250000 }, { amountMinor: 100000 }, { amountMinor: 600000 }])).toEqual([]);
  });
});
