import { describe, expect, it } from 'vitest';
import { GetStartedInput, getStarted, ownAccountCount } from './get-started';

const fresh: GetStartedInput = { accounts: 0, ownAccounts: 0, movements: 0, modulesTouched: false, skipped: false, hidden: false };

describe('getStarted', () => {
  it('a fresh install: visible, three pending steps', () => {
    const s = getStarted(fresh);
    expect(s.visible).toBe(true);
    expect(s.steps).toEqual([
      { id: 'account', done: false },
      { id: 'movement', done: false },
      { id: 'features', done: false },
    ]);
  });
  it('an account ticks the first step only', () => {
    expect(getStarted({ ...fresh, accounts: 1, ownAccounts: 1 }).steps.map((s) => s.done)).toEqual([true, false, false]);
  });
  it('touching a module switch or pressing Skip ticks the third', () => {
    expect(getStarted({ ...fresh, modulesTouched: true }).steps[2].done).toBe(true);
    expect(getStarted({ ...fresh, skipped: true }).steps[2].done).toBe(true);
  });
  it('an existing user (accounts and movements) never sees it', () => {
    expect(getStarted({ ...fresh, accounts: 3, ownAccounts: 3, movements: 200 }).visible).toBe(false);
  });
  it('movements without accounts (odd, but possible after an import) still shows it', () => {
    expect(getStarted({ ...fresh, movements: 2 }).visible).toBe(true);
  });
  it('hidden stays hidden', () => {
    expect(getStarted({ ...fresh, hidden: true }).visible).toBe(false);
  });
  it('with every step done it goes away by itself', () => {
    expect(getStarted({ accounts: 1, ownAccounts: 1, movements: 0, modulesTouched: true, skipped: false, hidden: false }).visible).toBe(true);
    expect(getStarted({ accounts: 1, ownAccounts: 1, movements: 1, modulesTouched: true, skipped: true, hidden: false }).visible).toBe(false);
  });
});

describe('ownAccountCount', () => {
  const starting = [
    { id: 'acc-cash', name: 'Cash', initialBalance: 0 },
    { id: 'acc-card', name: 'Card', initialBalance: 0 },
  ];
  it('the two starting accounts do not count', () => {
    expect(ownAccountCount(starting, starting)).toBe(0);
  });
  it('an added account counts', () => {
    expect(ownAccountCount([...starting, { id: 'x', name: 'Payroll', initialBalance: 0 }], starting)).toBe(1);
  });
  it('a starting account the user renamed or gave a balance counts as theirs', () => {
    expect(ownAccountCount([{ id: 'acc-cash', name: 'Wallet', initialBalance: 0 }, starting[1]], starting)).toBe(1);
    expect(ownAccountCount([{ id: 'acc-cash', name: 'Cash', initialBalance: 500 }, starting[1]], starting)).toBe(1);
  });
  it('no accounts at all', () => {
    expect(ownAccountCount([], starting)).toBe(0);
  });
});
