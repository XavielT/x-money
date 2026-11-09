// One main figure per screen: "Money in your accounts" is the same number, read from the same signal, on Home and on
// Accounts; "After paying your cards" is totalBalance(); "After your loans" appears only when something is owed.
import { DecimalPipe } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage, boot } from '../../../shared/testing/memory-storage';
import { account } from '../../../shared/testing/builders';
import { DashboardIndicatorsComponent } from '../../../shared/components/dashboard-indicators/dashboard-indicators';
import { LoanInput } from '../../../shared/domain/loans';
import { LoanService } from '../../../shared/services/loan.service';
import { NetWorthService } from '../../../shared/services/net-worth.service';
import { AccountsComponent } from './accounts';

const bank = account({ id: 'bank', name: 'Bank', type: 'bank', initialBalance: 100000 });
const usd = account({ id: 'usd', name: 'Dollars', type: 'bank', currency: 'USD', initialBalance: 250.5 });
const card = account({ id: 'card', name: 'Visa', type: 'card', cardKind: 'credit', initialBalance: -4000 });
const input: LoanInput = { amount: 120000, rate: { value: 18, type: 'nominal' }, method: 'french', termMonths: 12, frequency: 'monthly', firstDate: '2026-12-15' };

const fmt = (n: number) => new DecimalPipe('en-US').transform(Math.abs(n), '1.2-2')!;

function setup() {
  boot(new MemoryStorage().seed({ accounts: [bank, usd, card], transactions: [] }));
  const accounts = TestBed.createComponent(AccountsComponent);
  accounts.detectChanges();
  return { accounts, root: accounts.nativeElement as HTMLElement };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-20T12:00:00'));
});
afterEach(() => vi.useRealTimers());

describe('Accounts header', () => {
  it('with no loans: "After paying your cards" equals totalBalance() and there is no third line; "Total balance" is gone', () => {
    const { accounts, root } = setup();
    const rows = Array.from(root.querySelectorAll('.accounts-networth > .accounts-networth-row'));
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('After paying your cards');
    expect(rows[0].textContent).toContain(fmt(accounts.componentInstance.transactionService.totalBalance()));
    expect(root.textContent).not.toContain('After your loans');
    expect(root.textContent).not.toContain('Total balance');
    expect(root.textContent).not.toContain('Net worth (after card debt)');
  });

  it('with a loan the third line appears and equals the net worth', () => {
    const { accounts, root } = setup();
    expect(TestBed.inject(LoanService).register({ input, name: 'Car', lender: 'Bank', disbursementAccountId: 'bank', payAccountId: 'bank', disbursementDate: '2026-11-18' }).ok).toBe(true);
    accounts.detectChanges();
    const rows = Array.from(root.querySelectorAll('.accounts-networth > .accounts-networth-row'));
    expect(rows.length).toBe(2);
    const net = TestBed.inject(NetWorthService).summary().net.DOP;
    expect(rows[1].textContent).toContain('After your loans');
    expect(rows[1].textContent).toContain(fmt(net));
  });

  it('pesos and dollars are never added: dollars show next to the main figure, apart', () => {
    const { root } = setup();
    const main = root.querySelector('.accounts-total strong')!.textContent!;
    expect(main).toContain('US$250.50');
    const live = TestBed.inject(NetWorthService).summary().liquid;
    expect(main).toContain(fmt(live.DOP));
    expect(live.DOP).toBe(100000); // the 250.50 US$ did not leak into it
  });
});

describe('"Money in your accounts" is one number', () => {
  it('Home and Accounts show the same value, from the same signal', () => {
    const { root } = setup();
    const home = TestBed.createComponent(DashboardIndicatorsComponent);
    home.detectChanges();
    const homeLine = (home.nativeElement as HTMLElement).querySelector('.dash-sub')!.textContent!;
    const accountsLine = root.querySelector('.accounts-total')!.textContent!;
    const live = TestBed.inject(NetWorthService).summary().liquid.DOP;
    expect(homeLine).toContain('Money in your accounts');
    expect(homeLine).toContain(fmt(live));
    expect(accountsLine).toContain(fmt(live));
    expect(homeLine).toContain('US$250.50');
  });
});
