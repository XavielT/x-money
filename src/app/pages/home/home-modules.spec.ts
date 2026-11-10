// Home draws only what is switched on. Payment notices are obligations: they show with the module off.
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage, boot } from '../../../shared/testing/memory-storage';
import { account } from '../../../shared/testing/builders';
import { DashboardIndicatorsComponent } from '../../../shared/components/dashboard-indicators/dashboard-indicators';
import { LoanInput } from '../../../shared/domain/loans';
import { LoanService } from '../../../shared/services/loan.service';
import { ModuleService } from '../../../shared/services/module.service';
import { LoansComponent } from '../loans/loans';
import { HomeComponent } from './home';

const bank = account({ id: 'bank', name: 'Bank', type: 'bank', initialBalance: 100000 });
const input: LoanInput = { amount: 120000, rate: { value: 18, type: 'nominal' }, method: 'french', termMonths: 12, frequency: 'monthly', firstDate: '2026-12-15' };

function home(seed: Record<string, unknown> = {}) {
  boot(new MemoryStorage().seed({ accounts: [bank], transactions: [], ...seed }));
  const modules = TestBed.inject(ModuleService);
  return { modules, build: () => { const f = TestBed.createComponent(HomeComponent); f.detectChanges(); return f; } };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-12-12T12:00:00'));
});
afterEach(() => vi.useRealTimers());

describe('home: shortcuts of the active modules', () => {
  it('no data and nothing switched on: no shortcut at all (and no "+ More")', () => {
    const { build } = home();
    const root = build().nativeElement as HTMLElement;
    expect(root.querySelector('.home-links')).toBeNull();
  });

  it('with only Goals on: Goals and "+ More" that goes to Settings → Features', () => {
    const { modules, build } = home();
    modules.set('goals', true);
    const root = build().nativeElement as HTMLElement;
    const links = Array.from(root.querySelectorAll('.home-links a'));
    expect(links.map((a) => a.textContent?.trim())).toEqual(['🎯 Goals', '+ More']);
    expect(links[1].getAttribute('href')).toBe('/settings/features');
  });

  it('with every shortcut module on there is no "+ More"', () => {
    const { modules, build } = home();
    for (const id of ['income', 'benefits', 'business', 'goals', 'loans'] as const) modules.set(id, true);
    const root = build().nativeElement as HTMLElement;
    expect(root.querySelectorAll('.home-links a').length).toBe(5);
    expect(root.querySelector('.home-more')).toBeNull();
  });

  it('a loan notice shows even with Loans off', () => {
    const { modules, build } = home();
    const loans = TestBed.inject(LoanService);
    expect(loans.register({ input, name: 'Car loan', lender: 'Bank', disbursementAccountId: 'bank', payAccountId: 'bank', disbursementDate: '2026-11-18' }).ok).toBe(true);
    modules.set('loans', false);
    const root = build().nativeElement as HTMLElement;
    expect(root.querySelector('.home-links a[href="/loans"]')).toBeNull();
    expect(root.querySelector('a.home-goal-reminder[href="/loans"]')).toBeTruthy();
  });
});

describe('the Analysis card follows Smart alerts', () => {
  it('on by default; off hides it', () => {
    const { modules } = home();
    const f = TestBed.createComponent(DashboardIndicatorsComponent);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('.dash-analysis')).toBeTruthy();
    modules.set('insights', false);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('.dash-analysis')).toBeNull();
  });
});

describe('a page of a module that is off', () => {
  it('shows "This feature is off" with a button that turns it on and stays on the page', () => {
    const { modules } = home();
    modules.set('loans', false);
    const f = TestBed.createComponent(LoansComponent);
    f.detectChanges();
    const root = f.nativeElement as HTMLElement;
    const strip = root.querySelector('.modoff') as HTMLElement;
    expect(strip.textContent).toContain('This feature is off.');
    (strip.querySelector('button') as HTMLButtonElement).click();
    f.detectChanges();
    expect(modules.isOn('loans')).toBe(true);
    expect(root.querySelector('.modoff')).toBeNull();
    expect(root.querySelector('.loans')).toBeTruthy();
  });

  it('a module that is on has no strip', () => {
    const { modules } = home();
    modules.set('loans', true);
    const f = TestBed.createComponent(LoansComponent);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('.modoff')).toBeNull();
  });
});
