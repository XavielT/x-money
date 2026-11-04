import { addMoney, moneyEquals, round2, subMoney, sumMoney } from './money';

describe('money', () => {
  it('removes float ghost cents', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(addMoney(0.1, 0.2)).toBe(0.3);
  });

  it('rounds half away from zero to 2 decimals', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(-1.005)).toBe(-1.01);
    expect(round2(2.675)).toBe(2.68);
    expect(round2(10.004)).toBe(10);
  });

  it('handles zero and never returns -0', () => {
    expect(round2(0)).toBe(0);
    expect(Object.is(round2(-0.001), 0)).toBe(true);
    expect(Object.is(subMoney(0.3, 0.3), 0)).toBe(true);
  });

  it('handles negatives', () => {
    expect(subMoney(0.1, 0.3)).toBe(-0.2);
    expect(sumMoney([-0.1, -0.2])).toBe(-0.3);
  });

  it('sums lists, including empty ones', () => {
    expect(sumMoney([])).toBe(0);
    expect(sumMoney(Array(10).fill(0.1))).toBe(1);
    expect(sumMoney([1000.1, 2000.2, 3000.3])).toBe(6000.6);
  });

  it('compares at cent precision', () => {
    expect(moneyEquals(0.1 + 0.2, 0.3)).toBe(true);
    expect(moneyEquals(0.3, 0.31)).toBe(false);
  });

  it('propagates NaN and Infinity instead of hiding them', () => {
    expect(Number.isNaN(round2(NaN))).toBe(true);
    expect(round2(Infinity)).toBe(Infinity);
  });
});

import { equalsMoney as eq, formatMoney, percent } from './money';

describe('money (2.7.0 additions)', () => {
  it('percent rounds to cents', () => {
    expect(percent(1000, 0.2)).toBe(2);
    expect(percent(333.33, 0.15)).toBe(0.5);
    expect(percent(0, 5)).toBe(0);
    expect(percent(-100, 10)).toBe(-10);
  });

  it('equalsMoney tolerates half a cent', () => {
    expect(eq(10, 10.004)).toBe(true);
    expect(eq(10, 10.01)).toBe(false);
    expect(eq(0.1 + 0.2, 0.3)).toBe(true);
  });

  it('formatMoney formats safely', () => {
    expect(formatMoney(1234567.891, 'RD$')).toBe('RD$1,234,567.89');
    expect(formatMoney(-5, '$')).toBe('-$5.00');
    expect(formatMoney(0)).toBe('0.00');
    expect(formatMoney(NaN, '$')).toBe('—');
    expect(formatMoney(Infinity)).toBe('—');
  });
});
