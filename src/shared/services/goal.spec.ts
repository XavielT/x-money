// Prompt 07 (v2.13.0) on the real services: goals are virtual set-asides (no balance moves),
// they lower available money, personal savings / reserved commercial capital / inventory never add
// the same peso twice, "use for inventory", reminders, the emergency fund and the connections.
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, vi } from 'vitest';
import { MemoryStorage, boot } from '../testing/memory-storage';
import { cashSnapshot } from '../testing/non-cash-guard';
import { account, transaction } from '../testing/builders';
import { isSyncedKey } from '../data-layer/registry';
import { parseBackup } from '../data-layer/backup';
import { AuditLogService } from './audit-log.service';
import { BudgetService } from './budget.service';
import { BusinessService } from './business.service';
import { DashboardService } from './dashboard.service';
import { GoalResult, GoalService } from './goal.service';

const bank = account({ id: 'bank', name: 'Bank', type: 'bank', initialBalance: 100000 });
const sav = account({ id: 'sav', name: 'Savings', type: 'savings', initialBalance: 20000 });

function session(extra: Record<string, unknown> = {}) {
  const s = boot(new MemoryStorage().seed({ accounts: [bank, sav], ...extra }));
  return { ...s, goals: TestBed.inject(GoalService), dashboard: TestBed.inject(DashboardService), business: TestBed.inject(BusinessService), audit: TestBed.inject(AuditLogService) };
}
type S = ReturnType<typeof session>;
const id = (r: GoalResult) => {
  if (!r.ok) throw new Error(`rejected: ${r.error}`);
  return r.id;
};
const newGoal = (s: S, o: Record<string, unknown> = {}) => id(s.goals.add({ name: 'Car', kind: 'vehicle', target: 100000, ...o }));
const put = (s: S, goalId: string, amount: number, date = '2026-11-10') => id(s.goals.addEntry(goalId, { type: 'contribution', amount, date }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-20T12:00:00'));
});
afterEach(() => vi.useRealTimers());

describe('virtual set-asides', () => {
  it('a contribution moves no money: balances, movements and net worth stay as they were', () => {
    const s = session();
    const g = newGoal(s);
    const before = cashSnapshot(2026, 11);
    put(s, g, 15000);
    expect(cashSnapshot(2026, 11)).toEqual(before);
    expect(s.transactions.transactions()).toEqual([]);
    expect(s.goals.progress(s.goals.byId(g)!)).toMatchObject({ reserved: 15000, percent: 15 });
  });

  it('it lowers available money; a withdrawal gives it back', () => {
    const s = session();
    const g = newGoal(s);
    const available = () => s.dashboard.byId('available')!.value;
    const start = available();
    put(s, g, 15000);
    expect(available()).toBe(start! - 15000);
    expect(s.dashboard.byId('available')!.components.find((c) => c.label === 'Set aside in goals')).toMatchObject({ amount: -15000 });
    id(s.goals.addEntry(g, { type: 'withdrawal', amount: 5000, date: '2026-11-12' }));
    expect(available()).toBe(start! - 10000);
    expect(s.goals.addEntry(g, { type: 'withdrawal', amount: 10001, date: '2026-11-13' })).toEqual({ ok: false, error: 'exceeds' });
  });

  it('entries are reversed (kept in the history) and audited; a reversal that would leave a withdrawal uncovered is refused', () => {
    const s = session();
    const g = newGoal(s);
    const c1 = put(s, g, 10000);
    id(s.goals.addEntry(g, { type: 'withdrawal', amount: 8000, date: '2026-11-12' }));
    expect(s.goals.reverseEntry(g, c1)).toEqual({ ok: false, error: 'exceeds' });
    const c2 = put(s, g, 3000, '2026-11-13');
    id(s.goals.reverseEntry(g, c2));
    expect(s.goals.progress(s.goals.byId(g)!).reserved).toBe(2000);
    expect(s.goals.byId(g)!.entries).toHaveLength(3);
    expect(s.audit.events().filter((e) => e.type === 'goal-entry').length).toBeGreaterThanOrEqual(4);
    expect(s.goals.reverseEntry(g, c2)).toEqual({ ok: false, error: 'not-found' });
  });

  it('is validated: US$ goals, bad targets and archived goals', () => {
    const s = session();
    expect(s.goals.add({ name: ' ', kind: 'vehicle', target: 1 })).toEqual({ ok: false, error: 'name' });
    expect(s.goals.add({ name: 'x', kind: 'custom', target: 1 })).toEqual({ ok: false, error: 'kind' });
    expect(s.goals.add({ name: 'x', kind: 'vehicle', target: 0 })).toEqual({ ok: false, error: 'target' });
    expect(s.goals.add({ name: 'x', kind: 'vehicle', target: 1, accountId: 'ghost' })).toEqual({ ok: false, error: 'account' });
    const g = newGoal(s);
    id(s.goals.setStatus(g, 'archived'));
    expect(s.goals.addEntry(g, { type: 'contribution', amount: 5, date: '2026-11-10' })).toEqual({ ok: false, error: 'archived' });
  });

  it('progress passes 100 % without hiding the surplus, and the goal is achieved', () => {
    const s = session();
    const g = newGoal(s, { target: 10000 });
    put(s, g, 12500);
    expect(s.goals.progress(s.goals.byId(g)!)).toMatchObject({ percent: 125, barPercent: 100, surplus: 2500 });
    expect(s.goals.status(s.goals.byId(g)!)).toBe('achieved');
  });
});

describe('plan reminders: never contributes on its own', () => {
  it('"today it is time to contribute" appears, confirming records ONE entry, dismissing stops it', () => {
    const s = session();
    const g = newGoal(s, { plan: { amount: 5000, cadence: 'monthly', startDate: '2026-09-15' } });
    expect(s.goals.reminders()).toEqual([{ goalId: g, date: '2026-11-15' }]);
    expect(s.goals.byId(g)!.entries).toEqual([]); // nothing happened by itself
    boot(s.storage); // reopening the app does not contribute either
    expect(TestBed.inject(GoalService).byId(g)!.entries).toEqual([]);
    id(s.goals.confirmReminder(s.goals.reminders()[0]));
    expect(s.goals.byId(g)!.entries).toHaveLength(1);
    expect(s.goals.byId(g)!.entries[0]).toMatchObject({ amount: 5000, type: 'contribution' });
    expect(s.goals.reminders()).toEqual([]);
  });

  it('"not this time" dismisses that date', () => {
    const s = session();
    const g = newGoal(s, { plan: { amount: 5000, cadence: 'monthly', startDate: '2026-09-15' } });
    s.goals.skipReminder(g, '2026-11-15');
    expect(s.goals.reminders()).toEqual([]);
    expect(s.goals.byId(g)!.entries).toEqual([]);
  });
});

describe('personal savings, reserved commercial capital and inventory never add the same peso twice', () => {
  it('commercial goals are summed apart from personal ones', () => {
    const s = session();
    put(s, newGoal(s, { name: 'Trip', kind: 'travel' }), 8000);
    put(s, newGoal(s, { name: 'Shop capital', kind: 'business-capital' }), 50000);
    expect(s.goals.totals()).toEqual({ personal: 8000, commercial: 50000, outsideSavingsAccounts: 8000 });
    const savings = s.dashboard.byId('savings')!;
    expect(savings.value).toBe(20000 + 8000); // the savings account + personal goals; the commercial reserve is NOT in it
    expect(savings.components.find((c) => c.label === 'Reserved commercial capital (apart, not added)')).toMatchObject({ amount: 50000, kind: 'excluded' });
  });

  it('a goal tied to a savings account does not add its money again to the savings figure', () => {
    const s = session();
    put(s, newGoal(s, { name: 'Emergency', kind: 'emergency', accountId: 'sav' }), 15000);
    expect(s.goals.totals()).toMatchObject({ personal: 15000, outsideSavingsAccounts: 0 });
    expect(s.dashboard.byId('savings')!.value).toBe(20000); // the 15,000 already live in the savings account
    // but they are still reserved: they come out of available money
    expect(s.dashboard.byId('available')!.components.find((c) => c.label === 'Set aside in goals')!.amount).toBe(-15000);
  });

  it('"use for inventory": the goal loses the reserve and ONE purchase is created; the peso is never savings and invested at once', () => {
    const s = session();
    const g = newGoal(s, { name: 'Shop capital', kind: 'business-capital', target: 100000 });
    put(s, g, 50000);
    const count = s.transactions.transactions().length;
    const op = id(s.goals.useForInventory(g, { name: 'Alternator', category: 'part', totalCost: 20000, acquiredAt: '2026-11-15', accountId: 'bank' }));
    expect(s.transactions.transactions().length).toBe(count + 1); // just the purchase: nothing duplicated
    expect(s.goals.byId(g)!.entries[0]).toMatchObject({ type: 'withdrawal', amount: 20000, businessOperationId: op });
    const totals = s.goals.totals();
    const invested = s.business.inventory().cost;
    expect(totals.commercial).toBe(30000);
    expect(invested).toBe(20000);
    expect(totals.commercial + invested).toBe(50000); // the same 50,000, split: never counted twice
    expect(s.goals.totals().personal).toBe(0);
    expect(s.audit.events().some((e) => e.origin === 'use-for-inventory')).toBe(true);
  });

  it('without enough reserved, or for a personal goal, nothing is bought', () => {
    const s = session();
    const g = newGoal(s, { kind: 'business-capital' });
    put(s, g, 5000);
    const count = s.transactions.transactions().length;
    expect(s.goals.useForInventory(g, { name: 'Part', category: 'part', totalCost: 20000, acquiredAt: '2026-11-15', accountId: 'bank' })).toEqual({ ok: false, error: 'exceeds' });
    expect(s.goals.useForInventory(newGoal(s, { name: 'Trip', kind: 'travel' }), { name: 'Part', category: 'part', totalCost: 1, acquiredAt: '2026-11-15', accountId: 'bank' })).toEqual({ ok: false, error: 'kind' });
    expect(s.transactions.transactions()).toHaveLength(count);
    expect(s.business.operations()).toEqual([]);
  });
});

describe('projection and viability through the service', () => {
  it('plan vs real pace and a viability with its numbers', () => {
    const payroll = { id: 'pay', name: 'Pay', kind: 'payroll', icon: 'x', color: '#000', active: true, stability: 'recurring', schedule: { mode: 'month-days', days: [15, 30] }, method: 'transfer', verifiability: 'documented', expectedNet: 30000, createdAt: 'x' };
    const s = session({ incomeSources: [payroll] });
    const g = newGoal(s, { target: 120000, targetDate: '2027-05-20', plan: { amount: 10000, cadence: 'monthly', startDate: '2026-08-15' } });
    put(s, g, 10000, '2026-09-15');
    put(s, g, 10000, '2026-10-15');
    const goal = s.goals.byId(g)!;
    const p = s.goals.projection(goal);
    expect(p.estimate).toBe(true);
    expect(p.plan!.monthly).toBe(10000);
    expect(p.actual!.monthly).toBeCloseTo(6666.67, 1);
    const v = s.goals.viabilityOf(goal);
    expect(v.components.guaranteedIncome).toBe(60000); // 2 x 30,000, guaranteed only
    expect(v.margin).toBe(60000); // no fixed, no variables, no debt
    expect(v.status).toBe('reachable');
    expect(v.estimate).toBe(true);
  });
});

describe('emergency fund', () => {
  const essential = (amount: number, date: string) => transaction({ type: 'expense', amount, accountId: 'bank', date, categoryId: 'cat-rent' });

  it('N months of essential spending + minimum debt payments, the user chooses N; coverage = reserved / base', () => {
    const s = session({ transactions: [essential(30000, '2026-08-05'), essential(30000, '2026-09-05'), essential(30000, '2026-10-05')] });
    const g = id(s.goals.add({ name: 'Emergency fund', kind: 'emergency', target: 1, emergencyMonths: 6 }));
    put(s, g, 45000);
    const f = s.goals.emergencyOf(s.goals.byId(g)!);
    expect(f.base).toMatchObject({ monthly: 30000, basis: 'history', months: 3, estimate: true });
    expect(f.target).toBe(180000);
    expect(f.coverage).toBe(1.5);
    id(s.goals.update(g, { emergencyMonths: 3 }));
    expect(s.goals.emergencyOf(s.goals.byId(g)!).target).toBe(90000);
  });

  it('the target is never changed silently: it warns "rose from X to Y" and the user accepts it', () => {
    const s = session({ transactions: [essential(30000, '2026-08-05'), essential(30000, '2026-09-05'), essential(36000, '2026-10-05')] });
    const g = id(s.goals.add({ name: 'Emergency fund', kind: 'emergency', target: 90000, emergencyMonths: 3 }));
    const f = s.goals.emergencyOf(s.goals.byId(g)!);
    expect(f.target).toBe(90000); // median of 30,000 / 30,000 / 36,000
    // expenses rise
    s.transactions.add({ type: 'expense', amount: 40000, accountId: 'bank', date: '2026-09-20', categoryId: 'cat-rent' });
    const f2 = s.goals.emergencyOf(s.goals.byId(g)!);
    expect(f2.targetChange).toMatchObject({ from: 90000 });
    expect(s.goals.byId(g)!.target).toBe(90000);
    id(s.goals.acceptEmergencyTarget(g));
    expect(s.goals.byId(g)!.target).toBe(f2.target);
    expect(s.goals.emergencyOf(s.goals.byId(g)!).targetChange).toBeNull();
  });

  it('with fewer than 3 months it uses the declared fixed expenses and says so', () => {
    const rule = { id: 'r', type: 'expense', amount: 20000, categoryId: 'cat-rent', accountId: 'bank', frequency: 'monthly', startDate: '2026-11-25', nextDate: '2026-11-25', active: true };
    const s = session({ recurring: [rule] });
    const g = id(s.goals.add({ name: 'Emergency fund', kind: 'emergency', target: 1, emergencyMonths: 3 }));
    expect(s.goals.emergencyOf(s.goals.byId(g)!).base).toMatchObject({ basis: 'declared', monthly: 20000, estimate: true });
  });
});

describe('connections', () => {
  it('the budget blocks Savings and Emergencies reflect the real contributions of the month', () => {
    const s = session();
    put(s, newGoal(s, { name: 'Trip', kind: 'travel' }), 3000);
    put(s, id(s.goals.add({ name: 'Emergency fund', kind: 'emergency', target: 10 })), 5000);
    const rows = Object.fromEntries(TestBed.inject(BudgetService).bucketRows(2026, 11).map((r) => [r.bucket.kind, r.spent]));
    expect(rows['savings']).toBe(3000);
    expect(rows['emergency']).toBe(5000);
  });

  it('the savings evolution includes contributions to goals', () => {
    const s = session();
    put(s, newGoal(s), 7000, '2026-10-20');
    const h = s.dashboard.savings12();
    expect(h[11].total).toBe(27000); // November: 20,000 in the account + 7,000 set aside
    expect(h[9].total).toBe(20000); // September: before the contribution
  });

  it('with goals but no savings account the savings indicator appears (it is no longer hidden)', () => {
    const s = session({ accounts: [bank] });
    expect(s.dashboard.byId('savings')!.available).toBe(false);
    put(s, newGoal(s), 4000);
    expect(s.dashboard.byId('savings')).toMatchObject({ available: true, value: 4000 });
  });

  it('goals are a synced collection and travel in backups; an old backup without them imports fine', () => {
    expect(isSyncedKey('goals')).toBe(true);
    const old = parseBackup(JSON.stringify({ app: 'x-money', schemaVersion: 4, accounts: [bank] }));
    expect(old.ok).toBe(true);
    const withGoals = parseBackup(JSON.stringify({ app: 'x-money', schemaVersion: 4, goals: [{ id: 'g', name: 'Car', target: 100, entries: [] }] }));
    expect(withGoals.ok).toBe(true);
    expect(parseBackup(JSON.stringify({ app: 'x-money', schemaVersion: 4, goals: [{ id: 'g', name: 'Car', target: 100 }] }))).toMatchObject({ ok: false, error: { key: 'goals', field: 'entries' } });
    const s = session();
    newGoal(s);
    const backup = s.settings.exportData();
    s.settings.wipeData();
    expect(boot(s.storage).settings.importData(backup).ok).toBe(true);
    boot(s.storage);
    expect(TestBed.inject(GoalService).goals()).toHaveLength(1);
  });
});
