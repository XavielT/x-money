// Home must not get slower: timing with 5,000 movements. The numbers are printed (see the run
// output) and only a generous ceiling is asserted so the suite is not flaky on a slow machine.
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, vi } from 'vitest';
import { HomeComponent } from '../../app/pages/home/home';
import { MemoryStorage, boot } from '../testing/memory-storage';
import { account, transaction } from '../testing/builders';
import { DashboardService } from './dashboard.service';

const bank = account({ id: 'bank', type: 'bank', initialBalance: 100000 });
const savings = account({ id: 'sav', type: 'savings', initialBalance: 5000 });
const CATEGORIES = ['cat-food', 'cat-groceries', 'cat-transport', 'cat-shopping', 'cat-entertainment', 'cat-home', 'cat-health', 'cat-rent'];

function bigData(n: number) {
  const txs = [];
  for (let i = 0; i < n; i++) {
    const day = (i % 28) + 1;
    const month = 1 + (Math.floor(i / 28) % 11);
    const date = `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    txs.push(
      i % 9 === 0
        ? transaction({ type: 'income', amount: 1000 + (i % 7) * 100, accountId: 'bank', date, categoryId: 'cat-salary' })
        : i % 13 === 0
          ? transaction({ type: 'transfer', amount: 200, accountId: 'bank', toAccountId: 'sav', date })
          : transaction({ type: 'expense', amount: 50 + (i % 40) * 10, accountId: 'bank', date, categoryId: CATEGORIES[i % CATEGORIES.length] })
    );
  }
  return txs;
}

const time = (fn: () => void): number => {
  const t = performance.now();
  fn();
  return Math.round((performance.now() - t) * 10) / 10;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-20T12:00:00'));
});
afterEach(() => vi.useRealTimers());

describe('Home with 5,000 movements', () => {
  it('prints the render cost of the existing Home and of the dashboard on top of it', () => {
    boot(new MemoryStorage().seed({ accounts: [bank, savings], transactions: bigData(5000) }));
    const home = TestBed.createComponent(HomeComponent).componentInstance;
    const dashboard = TestBed.inject(DashboardService);

    const before = time(() => {
      home.summary();
      home.topCategories();
      home.recent();
      home.budgetAlerts();
    });
    const first = time(() => dashboard.indicators());
    const again = time(() => dashboard.indicators());
    const analysis = time(() => {
      dashboard.flow12();
      dashboard.savings12();
      dashboard.topSources();
      dashboard.cashflow();
      dashboard.unusual();
    });
    const compare = time(() => dashboard.compare('2026-09', '2026-10'));

    const tx = TestBed.inject(DashboardService)['transactions'];
    const afterAdd = time(() => {
      tx.add({ type: 'expense', amount: 99, accountId: 'bank', date: '2026-11-19', categoryId: 'cat-food' });
      dashboard.indicators();
    });

    console.log(`[perf 5000 tx] existing Home computeds: ${before} ms | ten indicators (first): ${first} ms | memoized: ${again} ms | after adding one movement: ${afterAdd} ms | analyses (12-month flow, savings, sources, cash flow, unusual): ${analysis} ms | month comparison: ${compare} ms`);
    expect(again).toBeLessThan(5); // memoized: effectively free
    expect(first).toBeLessThan(1500);
    expect(analysis).toBeLessThan(2500);
  });
});
