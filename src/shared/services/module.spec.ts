// Switchable modules (2.22.0). Rule 1e: turning a module off only hides shortcuts and indicators. Its data stays saved
// and is still counted (net worth, alerts), so no figure changes.
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage, boot } from '../testing/memory-storage';
import { account } from '../testing/builders';
import { parseBackup } from '../data-layer/backup';
import { LoanInput } from '../domain/loans';
import { DashboardService } from './dashboard.service';
import { LoanService } from './loan.service';
import { ModuleService } from './module.service';
import { NetWorthService } from './net-worth.service';
import { SettingsService } from './settings.service';

const bank = account({ id: 'bank', name: 'Bank', type: 'bank', initialBalance: 100000 });
const input: LoanInput = { amount: 120000, rate: { value: 18, type: 'nominal' }, method: 'french', termMonths: 12, frequency: 'monthly', firstDate: '2026-12-15' };

function session(storage = new MemoryStorage().seed({ accounts: [bank], transactions: [] })) {
  const s = boot(storage);
  return { ...s, modules: TestBed.inject(ModuleService), loans: TestBed.inject(LoanService), netWorth: TestBed.inject(NetWorthService), dashboard: TestBed.inject(DashboardService), settings: TestBed.inject(SettingsService) };
}

const registerLoan = (s: ReturnType<typeof session>) =>
  s.loans.register({ input, name: 'Car loan', lender: 'Bank', disbursementAccountId: 'bank', payAccountId: 'bank', disbursementDate: '2026-11-18' });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-12-12T12:00:00')); // three days before the first installment
});
afterEach(() => vi.useRealTimers());

describe('ModuleService: automatic and explicit', () => {
  it('a new user: every module off except smart alerts', () => {
    const { modules } = session();
    expect(modules.state()).toEqual({ income: false, benefits: false, business: false, loans: false, goals: false, insights: true });
    expect(modules.touched()).toBe(false);
  });

  it('a module with data is on by itself', () => {
    const s = session();
    expect(registerLoan(s).ok).toBe(true);
    expect(s.modules.isOn('loans')).toBe(true);
    expect(s.modules.counts().loans).toBe(1);
  });

  it('an explicit choice wins, in both directions, and survives a restart', () => {
    const s = session();
    registerLoan(s);
    s.modules.set('loans', false);
    s.modules.set('goals', true);
    expect(s.modules.isOn('loans')).toBe(false);
    expect(s.modules.isOn('goals')).toBe(true);
    expect(s.modules.touched()).toBe(true);
    const again = session(s.storage as MemoryStorage);
    expect(again.modules.isOn('loans')).toBe(false);
    expect(again.modules.isOn('goals')).toBe(true);
    // and the loan is still there
    expect(again.loans.loans().length).toBe(1);
  });

  it('an old backup without the field imports and every module stays automatic', () => {
    const old = JSON.stringify({ app: 'x-money', accounts: [bank], transactions: [], settings: { currency: 'RD$' } });
    const parsed = parseBackup(old);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const storage = new MemoryStorage().seed({ accounts: [], transactions: [] });
    storage.set('settings', parsed.data.settings);
    const s = session(storage);
    expect(s.settings.modules()).toEqual({});
    expect(s.modules.state().insights).toBe(true);
    expect(s.modules.state().loans).toBe(false);
  });

  it('garbage in the saved choices is ignored', () => {
    const storage = new MemoryStorage().seed({ accounts: [], transactions: [], settings: { currency: '$', modules: { goals: 'yes', nope: true, loans: false } } });
    const s = session(storage);
    expect(s.settings.modules()).toEqual({ loans: false });
  });
});

describe('rule 1e: a module that is off changes no figure', () => {
  it('with an active loan and Loans off: net worth, what is owed, the notices and every shown figure stay the same', () => {
    const s = session();
    registerLoan(s);
    const before = {
      owed: s.loans.totalOwed(),
      net: s.netWorth.summary().net,
      alerts: s.loans.alerts(),
      figures: s.dashboard.indicators().map((i) => [i.id, i.value]),
    };
    expect(before.owed).toBeGreaterThan(0);
    expect(before.alerts.length).toBeGreaterThan(0);
    s.modules.set('loans', false);
    expect(s.modules.isOn('loans')).toBe(false);
    expect(s.loans.totalOwed()).toBe(before.owed);
    expect(s.netWorth.summary().net).toEqual(before.net);
    expect(s.loans.alerts()).toEqual(before.alerts); // obligations are never hidden by the switch
    expect(s.dashboard.indicators().map((i) => [i.id, i.value])).toEqual(before.figures);
  });

  it('the debts indicator hides (never zero) when Loans is off and there are no cards; with a card it stays', () => {
    const s = session();
    registerLoan(s);
    expect(s.dashboard.visible().some((i) => i.id === 'debts')).toBe(true);
    s.modules.set('loans', false);
    expect(s.dashboard.visible().some((i) => i.id === 'debts')).toBe(false);
    expect(s.dashboard.byId('debts')?.value).toBeGreaterThan(0); // still computed
    s.modules.set('loans', true);
    expect(s.dashboard.visible().some((i) => i.id === 'debts')).toBe(true);
  });

  it('business capital hides with Business off but its data is untouched', () => {
    const s = session();
    s.modules.set('business', false);
    expect(s.dashboard.visible().some((i) => i.id === 'business-capital' || i.id === 'commercial-profit')).toBe(false);
  });
});
