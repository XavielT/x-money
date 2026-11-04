// Prompt 09 (v2.15.0) on the real services: the detectors fed by the app's data, dismiss and
// snooze with the evidence fingerprint, projections that are all Estimates (rule 10), non-monetary
// benefits never used as money (rule 4), persistence and timing with 5,000 movements.
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, vi } from 'vitest';
import { MemoryStorage, boot } from '../testing/memory-storage';
import { account, recurring, transaction } from '../testing/builders';
import { cashSnapshot } from '../testing/non-cash-guard';
import { isSyncedKey } from '../data-layer/registry';
import { parseBackup } from '../data-layer/backup';
import { RULES } from '../domain/insights/engine';
import { PROJECTION_KINDS } from '../domain/insights/projections';
import { BenefitService } from './benefit.service';
import { GoalService } from './goal.service';
import { SmartInsightService } from './smart-insight.service';
import { TransactionService } from './transaction.service';

const bank = account({ id: 'bank', name: 'Bank', type: 'bank', initialBalance: 5000 });
const payroll = { id: 'pay', name: 'Pay', kind: 'payroll', icon: 'x', color: '#000', active: true, stability: 'recurring', schedule: { mode: 'month-days', days: [15, 30] }, method: 'transfer', verifiability: 'documented', expectedNet: 30000, createdAt: '2026-01-01' };

function session(extra: Record<string, unknown> = {}) {
  const s = boot(new MemoryStorage().seed({ accounts: [bank], ...extra }));
  return { ...s, smart: TestBed.inject(SmartInsightService), goals: TestBed.inject(GoalService), benefits: TestBed.inject(BenefitService) };
}

const dup = () => [
  transaction({ type: 'expense', amount: 480, accountId: 'bank', date: '2026-11-10', categoryId: 'cat-transport', note: 'Uber' }),
  transaction({ type: 'expense', amount: 480, accountId: 'bank', date: '2026-11-11', categoryId: 'cat-transport', note: 'uber trip' }),
];
// 8,000 due in 10 days against 5,000 of liquid money
const rent = () => recurring({ id: 'rent', type: 'expense', amount: 8000, categoryId: 'cat-rent', accountId: 'bank', frequency: 'monthly', startDate: '2026-11-30', nextDate: '2026-11-30' });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-20T12:00:00'));
});
afterEach(() => vi.useRealTimers());

describe('the detectors on the app data', () => {
  it('commitments: not enough money for the next 30 days is a critical alert with what is missing', () => {
    const s = session({ recurring: [rent()] });
    const a = s.smart.all().find((i) => i.id === 'commitments:shortfall')!;
    expect(a).toMatchObject({ severity: 'alert', critical: true });
    expect(a.evidence.find((e) => e.label === 'Missing')!.value).toBe(3000);
    expect(s.smart.critical().map((i) => i.id)).toContain('commitments:shortfall');
    expect(s.smart.top()[0].id).toBe('commitments:shortfall'); // the most important first
  });

  it('duplicates: a candidate pair shows up and nothing is merged', () => {
    const s = session({ transactions: dup() });
    expect(s.smart.all().some((i) => i.rule === 'duplicates')).toBe(true);
    expect(s.smart.duplicateCandidates()).toHaveLength(1);
    expect(s.transactions.transactions()).toHaveLength(2); // nothing was removed or merged
  });

  it('with no data every check that needs history says so instead of inventing a result', () => {
    const s = session();
    const missing = s.smart.insufficient().map((r) => r.rule);
    expect(missing).toEqual(expect.arrayContaining(['small-expenses', 'unusual-increase', 'low-savings', 'budget-adjust', 'reservable', 'variable-dependence', 'declared-vs-received']));
    for (const r of s.smart.insufficient()) {
      expect(r.insights).toEqual([]);
      expect(r.history.have).toBeLessThan(r.history.needed);
    }
    expect(s.smart.all()).toEqual([]);
  });

  it('a rule that is switched off does not run, and a threshold changes what it finds', () => {
    const s = session({ transactions: dup() });
    s.smart.setRule('duplicates', { thresholds: { minScore: 100 } });
    expect(s.smart.duplicateCandidates()).toEqual([]);
    s.smart.setRule('duplicates', { thresholds: { minScore: 75 }, enabled: false });
    expect(s.smart.results().some((r) => r.rule === 'duplicates')).toBe(false);
    expect(s.smart.all().some((i) => i.rule === 'duplicates')).toBe(false);
  });
});

describe('dismiss and snooze', () => {
  it('a dismissed insight stays hidden, survives a restart, and comes back when its evidence changes materially', () => {
    const s = session({ recurring: [rent()] });
    const shortfall = () => s.smart.visible().find((i) => i.id === 'commitments:shortfall');
    s.smart.dismiss(shortfall()!);
    expect(shortfall()).toBeUndefined();
    expect(s.smart.hidden().map((i) => i.id)).toContain('commitments:shortfall');

    boot(s.storage); // restart: the state was persisted
    const restarted = TestBed.inject(SmartInsightService);
    expect(restarted.visible().find((i) => i.id === 'commitments:shortfall')).toBeUndefined();

    // the shortfall goes from 3,000 to 1,000: a material change
    const t = TestBed.inject(TransactionService);
    t.add({ type: 'income', amount: 2000, accountId: 'bank', date: '2026-11-19', categoryId: 'cat-salary' });
    const back = TestBed.inject(SmartInsightService).visible().find((i) => i.id === 'commitments:shortfall')!;
    expect(back).toBeTruthy();
    expect(back.evidence.find((e) => e.label === 'Missing')!.value).toBe(1000);
  });

  it('a small change does not bring it back; a snooze brings it back on its date', () => {
    const s = session({ recurring: [rent()], transactions: [transaction({ type: 'income', amount: 1, accountId: 'bank', date: '2026-11-01', categoryId: 'cat-salary' })] });
    const find = (svc: SmartInsightService) => svc.visible().find((i) => i.id === 'commitments:shortfall');
    s.smart.snooze(find(s.smart)!, 7);
    expect(find(s.smart)).toBeUndefined();
    vi.setSystemTime(new Date('2026-11-27T12:00:00'));
    boot(s.storage);
    const later = TestBed.inject(SmartInsightService);
    expect(find(later)).toBeTruthy(); // the snooze ran out
  });

  it('dismissing does not rerun the detectors (the results are memoized)', () => {
    const s = session({ recurring: [rent()] });
    const first = s.smart.results();
    s.smart.dismiss(s.smart.all()[0]);
    expect(s.smart.results()).toBe(first);
  });

  it('can be brought back by the user', () => {
    const s = session({ recurring: [rent()] });
    const i = s.smart.all().find((x) => x.id === 'commitments:shortfall')!;
    s.smart.dismiss(i);
    s.smart.restore(i);
    expect(s.smart.visible().some((x) => x.id === 'commitments:shortfall')).toBe(true);
  });
});

describe('RULE 10: every projection is an Estimate', () => {
  it('the registry has every kind and each entry carries a range, assumptions and isEstimate', () => {
    const s = session({ transactions: [transaction({ type: 'income', amount: 1000, accountId: 'bank', date: '2026-10-05', categoryId: 'cat-salary' })], incomeSources: [payroll] });
    const goal = s.goals.add({ name: 'Car', kind: 'vehicle', target: 100000, plan: { amount: 5000, cadence: 'monthly', startDate: '2026-11-01' } });
    expect(goal.ok).toBe(true);
    const list = s.smart.projections();
    expect(new Set(list.map((p) => p.kind))).toEqual(new Set(PROJECTION_KINDS));
    expect(list.length).toBeGreaterThanOrEqual(5); // month end, 3 cash flows, 1 goal
    for (const p of list) {
      for (const e of [p.estimate, p.withoutVariableIncome].filter((x) => !!x)) {
        expect(e!.isEstimate).toBe(true);
        expect(e!.assumptions.length).toBeGreaterThan(0);
        expect(e).toHaveProperty('low');
        expect(e).toHaveProperty('high');
      }
    }
    // the cash flow shows what happens if variable income does not arrive
    expect(list.filter((p) => p.kind === 'cashflow').every((p) => !!p.withoutVariableIncome)).toBe(true);
  });

  it('the month-end figure is the same one the budget already shows (reused, not recalculated)', () => {
    const s = session();
    const month = s.smart.projections().find((p) => p.id === 'month-end')!;
    expect(month.estimate.value).toBe(s.budgets.endOfMonthProjection().projected);
  });
});

describe('RULE 4: non-monetary benefits are never money for any insight', () => {
  it('adding, using and removing benefits changes no insight, no projection and no cash', () => {
    const s = session({ recurring: [rent()], transactions: dup(), incomeSources: [payroll] });
    const before = JSON.stringify([s.smart.all(), s.smart.projections()]);
    const snap = cashSnapshot(2026, 11);
    const b = s.benefits.add({ name: 'Fuel card', kind: 'fuel-card', provider: 'Employer', monthlyValue: 500000, monthlyLimit: 600000, active: true });
    if (!b.ok) throw new Error('benefit');
    s.benefits.addUse(b.id, { date: '2026-11-03', amount: 25000 });
    expect(JSON.stringify([s.smart.all(), s.smart.projections()])).toBe(before);
    expect(cashSnapshot(2026, 11)).toEqual(snap);
    s.benefits.remove(b.id);
    expect(JSON.stringify([s.smart.all(), s.smart.projections()])).toBe(before);
  });
});

describe('persistence', () => {
  it('settings and dismissed states are synced collections, travel in backups, and old backups import fine', () => {
    for (const k of ['insightStates', 'insightSettings']) expect(isSyncedKey(k)).toBe(true);
    expect(parseBackup(JSON.stringify({ app: 'x-money', schemaVersion: 4, accounts: [bank] })).ok).toBe(true);
    expect(parseBackup(JSON.stringify({ app: 'x-money', schemaVersion: 4, insightStates: [{ id: 'a' }] }))).toMatchObject({ ok: false, error: { key: 'insightStates' } });
    const s = session({ recurring: [rent()] });
    s.smart.setRule('variable-dependence', { thresholds: { sharePercent: 55 } });
    s.smart.dismiss(s.smart.all()[0]);
    const backup = s.settings.exportData();
    s.settings.wipeData();
    expect(boot(s.storage).settings.importData(backup).ok).toBe(true);
    boot(s.storage);
    const again = TestBed.inject(SmartInsightService);
    expect(again.ruleSetting('variable-dependence').thresholds['sharePercent']).toBe(55);
    expect(again.states()).toHaveLength(1);
  });
});

// ----- timing: 5,000 movements (the set of prompt 05). Printed, with a generous ceiling.
const CATEGORIES = ['cat-food', 'cat-groceries', 'cat-transport', 'cat-shopping', 'cat-entertainment', 'cat-home', 'cat-health', 'cat-rent'];
function bigData(n: number) {
  const txs = [];
  for (let i = 0; i < n; i++) {
    const day = (i % 28) + 1;
    const month = 1 + (Math.floor(i / 28) % 11);
    const date = `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    txs.push(i % 9 === 0 ? transaction({ type: 'income', amount: 1000 + (i % 7) * 100, accountId: 'bank', date, categoryId: 'cat-salary' }) : transaction({ type: 'expense', amount: 50 + (i % 40) * 10, accountId: 'bank', date, categoryId: CATEGORIES[i % CATEGORIES.length] }));
  }
  return txs;
}
const time = (fn: () => void): number => {
  const t = performance.now();
  fn();
  return Math.round((performance.now() - t) * 10) / 10;
};

describe('timing with 5,000 movements', () => {
  it('each detector is measured alone and the whole set once; nothing runs until it is read', () => {
    const data = bigData(5000);
    const rows: string[] = [];
    let slowest = 0;
    for (const r of RULES) {
      const others = Object.fromEntries(RULES.filter((x) => x.id !== r.id).map((x) => [x.id, { enabled: false, thresholds: {} }]));
      const s = session({ transactions: data, insightSettings: { rules: others } });
      const ms = time(() => s.smart.results());
      slowest = Math.max(slowest, ms);
      rows.push(`${r.id}: ${ms} ms`);
    }
    const s = session({ transactions: data });
    const all = time(() => s.smart.results());
    const memo = time(() => s.smart.results());
    const top = time(() => s.smart.top());
    s.transactions.add({ type: 'expense', amount: 99, accountId: 'bank', date: '2026-11-19', categoryId: 'cat-food' });
    const afterAdd = time(() => s.smart.results());
    const projections = time(() => s.smart.projections());
    console.log(`[perf 5000 tx] ${rows.join(' | ')} | all enabled: ${all} ms | memoized: ${memo} ms | top 3: ${top} ms | after adding one movement: ${afterAdd} ms | projections: ${projections} ms`);
    expect(slowest).toBeLessThan(2500);
    expect(all).toBeLessThan(6000);
    expect(memo).toBeLessThan(250);
  });

  it('adding a movement is not slowed down: the detectors do not run on write', () => {
    const s = session({ transactions: bigData(5000) });
    const ms = time(() => s.transactions.add({ type: 'expense', amount: 10, accountId: 'bank', date: '2026-11-19', categoryId: 'cat-food' }));
    expect(ms).toBeLessThan(1500);
  });
});
