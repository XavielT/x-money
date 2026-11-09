import { describe, expect, it } from 'vitest';
import { balanceAfterOpeningChange } from './opening-balance';

describe('balanceAfterOpeningChange', () => {
  it('no change: nothing to confirm and the balance is the same', () => {
    expect(balanceAfterOpeningChange(9966.98, 7727.48, 7727.48)).toEqual({ changed: false, before: 9966.98, after: 9966.98 });
  });
  it('a rounding-only difference is not a change', () => {
    expect(balanceAfterOpeningChange(100, 50.001, 50).changed).toBe(false);
  });
  it('a higher opening balance raises the balance by the same amount', () => {
    expect(balanceAfterOpeningChange(9966.98, 7727.48, 8000)).toEqual({ changed: true, before: 9966.98, after: 10239.5 });
  });
  it('a lower one lowers it, even below zero', () => {
    expect(balanceAfterOpeningChange(100, 500, 0)).toEqual({ changed: true, before: 100, after: -400 });
  });
  it('decimals do not drift (0.1 + 0.2 style)', () => {
    expect(balanceAfterOpeningChange(0.1, 0, 0.2).after).toBe(0.3);
    expect(balanceAfterOpeningChange(1.1, 0.1, 0.2).after).toBe(1.2);
  });
  it('a credit card with debt keeps its sign: paying less opening debt-offset changes the debt', () => {
    expect(balanceAfterOpeningChange(-2500, 0, -1000)).toEqual({ changed: true, before: -2500, after: -3500 });
    expect(balanceAfterOpeningChange(-2500, -1000, 0).after).toBe(-1500);
  });
  it('a USD account works in its own currency (same arithmetic, never mixed with RD$)', () => {
    expect(balanceAfterOpeningChange(250.5, 100, 150.25)).toEqual({ changed: true, before: 250.5, after: 300.75 });
  });
  it('zero everywhere', () => {
    expect(balanceAfterOpeningChange(0, 0, 0)).toEqual({ changed: false, before: 0, after: 0 });
  });
});
