// Prompt 07 (v2.13.0): goals as virtual set-asides, reminders, projection, viability and the
// emergency fund. Pure.
import { GoalEntry, GoalModel } from '../models/goal.model';
import {
  actualMonthly,
  dueReminders,
  effectiveStatus,
  emergencyBase,
  emergencyFund,
  goalTotals,
  monthContributions,
  monthlyMargin,
  monthlyOfPlan,
  progressOf,
  projectGoal,
  reservedOf,
  validateEntry,
  validateGoal,
  viability,
} from './goals';

let n = 0;
const entry = (date: string, amount: number, type: GoalEntry['type'] = 'contribution', extra: Partial<GoalEntry> = {}): GoalEntry => ({ id: `e${++n}`, date, amount, type, ...extra });
const goal = (o: Partial<GoalModel> = {}): GoalModel => ({ id: `g${++n}`, name: 'Car', kind: 'vehicle', target: 100000, currency: 'DOP', status: 'active', entries: [], createdAt: 'x', ...o });
const margin = { guaranteedIncome: 60000, fixed: 20000, variableMedian: 15000, debtPayments: 5000 };

describe('reserved and progress', () => {
  it('contributions minus withdrawals; reversed entries count for nothing', () => {
    const g = goal({ entries: [entry('2026-10-01', 5000), entry('2026-10-15', 3000), entry('2026-10-20', 1000, 'withdrawal'), entry('2026-10-21', 9999, 'contribution', { reversed: true })] });
    expect(reservedOf(g)).toBe(7000);
    expect(reservedOf(g, '2026-10-10')).toBe(5000); // as of a date
    expect(reservedOf(goal())).toBe(0);
  });

  it('the percentage is real (it can pass 100 %), the bar is capped, the surplus is never hidden', () => {
    const g = goal({ target: 10000, entries: [entry('2026-10-01', 12500)] });
    expect(progressOf(g)).toEqual({ reserved: 12500, target: 10000, percent: 125, barPercent: 100, remaining: 0, surplus: 2500 });
    expect(progressOf(goal({ target: 3, entries: [entry('2026-10-01', 1)] })).percent).toBe(33.3);
    expect(progressOf(goal({ target: 0 })).percent).toBe(0);
  });

  it('an active goal that reaches its target is achieved; paused and archived keep their status', () => {
    const done = [entry('2026-10-01', 100000)];
    expect(effectiveStatus(goal({ entries: done }))).toBe('achieved');
    expect(effectiveStatus(goal({ entries: [entry('2026-10-01', 5)] }))).toBe('active');
    expect(effectiveStatus(goal({ entries: done, status: 'paused' }))).toBe('paused');
    expect(effectiveStatus(goal({ entries: done, status: 'archived' }))).toBe('archived');
  });
});

describe('validation', () => {
  it('a goal needs a name, a positive target, valid dates, RD$ and a sane plan or emergency months', () => {
    const ok = { name: 'Car', target: 1000 };
    expect(validateGoal(ok)).toBeNull();
    expect(validateGoal({ ...ok, name: ' ' })).toBe('name');
    expect(validateGoal({ ...ok, target: 0 })).toBe('target');
    expect(validateGoal({ ...ok, target: NaN })).toBe('target');
    expect(validateGoal({ ...ok, targetDate: '2026-02-30' })).toBe('date');
    expect(validateGoal({ ...ok, currency: 'USD' })).toBe('currency');
    expect(validateGoal({ ...ok, plan: { amount: 0, cadence: 'monthly', startDate: '2026-11-01' } })).toBe('plan');
    expect(validateGoal({ ...ok, emergencyMonths: 0 })).toBe('months');
    expect(validateGoal({ ...ok, emergencyMonths: 13 })).toBe('months');
    expect(validateGoal({ ...ok, emergencyMonths: 6 })).toBeNull();
  });

  it('an entry needs a positive amount and a date; a withdrawal cannot exceed what is set aside; archived is closed', () => {
    const g = goal({ entries: [entry('2026-10-01', 5000)] });
    expect(validateEntry(g, 'contribution', 100, '2026-10-05')).toBeNull();
    expect(validateEntry(g, 'contribution', 0, '2026-10-05')).toBe('amount');
    expect(validateEntry(g, 'contribution', 5, 'nope')).toBe('date');
    expect(validateEntry(g, 'withdrawal', 5000, '2026-10-05')).toBeNull();
    expect(validateEntry(g, 'withdrawal', 5001, '2026-10-05')).toBe('exceeds');
    expect(validateEntry(g, 'withdrawal', 100, '2026-09-30')).toBe('exceeds'); // nothing was set aside yet on that date
    expect(validateEntry({ ...g, status: 'archived' }, 'contribution', 5, '2026-10-05')).toBe('archived');
  });
});

describe('periodic plan and "time to contribute"', () => {
  it('monthly equivalent of a plan', () => {
    expect(monthlyOfPlan({ amount: 1000, cadence: 'monthly' })).toBe(1000);
    expect(monthlyOfPlan({ amount: 1000, cadence: 'biweekly' })).toBe(2000);
    expect(monthlyOfPlan({ amount: 1000, cadence: 'weekly' })).toBe(4333.33);
  });

  it('a due contribution nobody made is a reminder; a made one (a little early or late) is not', () => {
    const g = goal({ plan: { amount: 5000, cadence: 'monthly', startDate: '2026-09-15' } });
    expect(dueReminders([g], '2026-11-15').map((r) => r.date)).toEqual(['2026-11-15']);
    const paid = { ...g, entries: [entry('2026-11-13', 5000)] };
    expect(dueReminders([paid], '2026-11-15')).toEqual([]);
    expect(dueReminders([g], '2026-11-20').map((r) => r.date)).toEqual(['2026-11-15']); // still pending 5 days later
    expect(dueReminders([g], '2026-11-30')).toEqual([]); // older than the look-back
  });

  it('a dismissed date, a paused or achieved goal, a goal without plan and a date before the plan start never remind', () => {
    const plan = { amount: 5000, cadence: 'monthly' as const, startDate: '2026-09-15' };
    expect(dueReminders([goal({ plan, skippedDates: ['2026-11-15'] })], '2026-11-15')).toEqual([]);
    expect(dueReminders([goal({ plan, status: 'paused' })], '2026-11-15')).toEqual([]);
    expect(dueReminders([goal({ plan, entries: [entry('2026-01-01', 100000)] })], '2026-11-15')).toEqual([]);
    expect(dueReminders([goal()], '2026-11-15')).toEqual([]);
    expect(dueReminders([goal({ plan: { ...plan, startDate: '2026-12-15' } })], '2026-11-15')).toEqual([]);
  });

  it('weekly and biweekly plans', () => {
    const weekly = goal({ plan: { amount: 100, cadence: 'weekly', startDate: '2026-11-06' } }); // Fridays
    expect(dueReminders([weekly], '2026-11-20', 14).map((r) => r.date)).toEqual(['2026-11-06', '2026-11-13', '2026-11-20']);
    const bi = goal({ plan: { amount: 100, cadence: 'biweekly', startDate: '2026-11-01' } });
    expect(dueReminders([bi], '2026-11-30', 20).map((r) => r.date)).toEqual(['2026-11-15', '2026-11-30']);
  });
});

describe('projection of completion (an estimate)', () => {
  const today = '2026-11-20';

  it('without enough contributions only the plan is shown, and it says the history is insufficient', () => {
    const g = goal({ target: 60000, plan: { amount: 10000, cadence: 'monthly', startDate: '2026-11-01' }, entries: [entry('2026-11-01', 10000)] });
    const p = projectGoal(g, today);
    expect(p).toMatchObject({ insufficient: true, actual: null, achieved: false, estimate: true });
    expect(p.plan).toMatchObject({ monthly: 10000, months: 5 });
    expect(p.plan!.date).toBe('2027-04-22'); // 5 months x 30.44 days from today, rounded up
    expect(p.assumptions.length).toBeGreaterThan(0);
  });

  it('no plan and no history: nothing to project', () => {
    expect(projectGoal(goal(), today)).toMatchObject({ plan: null, actual: null, insufficient: true });
  });

  it('plan and real pace side by side; irregular contributions give the real average, empty months count as zero', () => {
    const g = goal({
      target: 100000,
      plan: { amount: 10000, cadence: 'monthly', startDate: '2026-07-01' },
      entries: [entry('2026-08-10', 12000), entry('2026-10-05', 6000), entry('2026-10-20', 6000)],
    });
    expect(actualMonthly(g, today)).toBe(8000); // Aug 12,000 + Sep 0 + Oct 12,000 over 3 months
    const p = projectGoal(g, today);
    expect(p.insufficient).toBe(false);
    expect(p.actual).toMatchObject({ monthly: 8000 });
    expect(p.actual!.months).toBe(9.5); // (100,000 - 24,000) / 8,000
    expect(p.plan).toMatchObject({ monthly: 10000 });
    expect(p.actual!.months!).toBeGreaterThan(p.plan!.months!); // the real pace is slower
  });

  it('withdrawals lower the real pace; a pace of zero never finishes', () => {
    const g = goal({ entries: [entry('2026-09-10', 5000), entry('2026-10-10', 5000), entry('2026-10-12', 15000, 'withdrawal')] });
    expect(actualMonthly(g, today)).toBe(0); // net negative: never below zero
    expect(projectGoal(g, today).actual).toEqual({ monthly: 0, months: null, date: null });
  });

  it('an achieved goal has nothing to project; a target date that passed is overdue', () => {
    expect(projectGoal(goal({ entries: [entry('2026-10-01', 100000)] }), today)).toMatchObject({ achieved: true, plan: null, actual: null });
    expect(projectGoal(goal({ targetDate: '2026-10-31', entries: [entry('2026-10-01', 5)] }), today).overdue).toBe(true);
    expect(projectGoal(goal({ targetDate: '2027-10-31' }), today).overdue).toBe(false);
  });
});

describe('viability (deterministic)', () => {
  const today = '2026-11-20';

  it('the monthly margin = guaranteed income - fixed - median of variables - debt payments', () => {
    expect(monthlyMargin(margin)).toBe(20000);
    expect(monthlyMargin({ ...margin, guaranteedIncome: 0 })).toBe(-40000);
  });

  it('reachable with slack, tight without slack, unreachable when it does not fit', () => {
    const g = (target: number) => goal({ target, targetDate: '2027-05-20', entries: [entry('2026-11-01', 0.01)] }); // 6 months left
    expect(viability(g(60000), today, margin)).toMatchObject({ status: 'reachable', margin: 20000 }); // ~10,000 / month (slack > 20 %)
    expect(viability(g(110000), today, margin).status).toBe('tight'); // ~18,300 / month: fits, no slack
    expect(viability(g(240000), today, margin).status).toBe('unreachable'); // ~40,000 / month
    const v = viability(g(60000), today, margin);
    expect(v.required).toBeCloseTo(60000 / (181 / 30.44), 0);
    expect(v.components).toEqual({ guaranteedIncome: 60000, fixed: 20000, variableMedian: 15000, debtPayments: 5000 });
  });

  it('no margin is never reachable; no date, achieved and an overdue date are handled', () => {
    const g = goal({ target: 10000, targetDate: '2027-05-20' });
    expect(viability(g, today, { ...margin, guaranteedIncome: 0 }).status).toBe('unreachable');
    expect(viability(goal({ target: 10000 }), today, margin)).toMatchObject({ status: 'no-date', required: 0 });
    expect(viability(goal({ entries: [entry('2026-10-01', 100000)] }), today, margin).status).toBe('achieved');
    // a date that already passed asks for everything now
    expect(viability(goal({ target: 30000, targetDate: '2026-10-01' }), today, margin)).toMatchObject({ required: 30000, status: 'unreachable' });
  });
});

describe('emergency fund', () => {
  it('base = median of the last 3-6 months of essential spending + minimum debt payments, with its months', () => {
    const b = emergencyBase([30000, 32000, 31000, 45000], 20000, 4000);
    expect(b).toEqual({ monthly: 35500, essential: 31500, debtPayments: 4000, basis: 'history', months: 4, estimate: true });
    expect(emergencyBase([1, 2, 3, 4, 5, 6, 7, 8], 0, 0).months).toBe(6); // only the last 6
  });

  it('with fewer than 3 months it uses the declared fixed expenses and says so (an estimate)', () => {
    expect(emergencyBase([30000, 32000], 20000, 4000)).toMatchObject({ monthly: 24000, basis: 'declared', months: 2, estimate: true });
    expect(emergencyBase([], 0, 0)).toMatchObject({ monthly: 0, basis: 'declared' });
  });

  it('target = N months x base; coverage = reserved / base; 3 and 6 are just choices', () => {
    const base = emergencyBase([30000, 30000, 30000], 0, 0);
    const f3 = emergencyFund(3, base, 45000, null);
    expect(f3).toMatchObject({ target: 90000, coverage: 1.5, targetChange: null });
    expect(emergencyFund(6, base, 0, null).target).toBe(180000);
    expect(emergencyFund(5, base, 0, null).target).toBe(150000);
    expect(emergencyFund(12, emergencyBase([], 0, 0), 100, null)).toMatchObject({ target: 0, coverage: 0 });
  });

  it('warns when the target changed because the expenses changed', () => {
    const before = emergencyFund(3, emergencyBase([30000, 30000, 30000], 0, 0), 0, null).target;
    const f = emergencyFund(3, emergencyBase([30000, 36000, 36000], 0, 0), 0, before);
    expect(f.targetChange).toEqual({ from: 90000, to: 108000 });
    expect(emergencyFund(3, emergencyBase([30000, 30000, 30000], 0, 0), 0, 90000).targetChange).toBeNull();
    expect(emergencyFund(3, emergencyBase([30000, 30000, 30000], 0, 0), 0, 89700).targetChange).toBeNull(); // under 1 %
  });
});

describe('groups: personal savings and reserved commercial capital are never added together', () => {
  const isSavings = (id: string) => id === 'sav';

  it('personal, commercial and what is outside savings accounts (the money already in a savings account is not counted again)', () => {
    const goals = [
      goal({ kind: 'emergency', accountId: 'sav', entries: [entry('2026-10-01', 40000)] }),
      goal({ kind: 'vehicle', entries: [entry('2026-10-01', 15000)] }),
      goal({ kind: 'business-capital', entries: [entry('2026-10-01', 70000)] }),
      goal({ kind: 'travel', entries: [entry('2026-10-01', 999)], status: 'archived' }),
      goal({ kind: 'travel', currency: 'USD', entries: [entry('2026-10-01', 555)] }),
    ];
    expect(goalTotals(goals, isSavings)).toEqual({ personal: 55000, commercial: 70000, outsideSavingsAccounts: 15000 });
    expect(goalTotals([], isSavings)).toEqual({ personal: 0, commercial: 0, outsideSavingsAccounts: 0 });
  });

  it('what was contributed in a month, by budget block (contributions only)', () => {
    const goals = [goal({ kind: 'emergency', entries: [entry('2026-11-02', 5000), entry('2026-11-03', 500, 'withdrawal')] }), goal({ kind: 'vehicle', entries: [entry('2026-11-10', 3000), entry('2026-10-10', 9)] })];
    expect(monthContributions(goals, '2026-11')).toEqual({ savings: 3000, emergency: 5000 });
  });
});
