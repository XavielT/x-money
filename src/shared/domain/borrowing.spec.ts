import { IncomeSourceModel } from '../models/income-source.model';
import { DEFAULT_LOAN_SETTINGS, LoanSettings } from '../models/loan.model';
import { evaluateCapacity, incomeDropImpact, incomeTiers, monthlyEquivalent, readings, statusOf } from './borrowing';

const src = (o: Partial<IncomeSourceModel>): IncomeSourceModel => ({
  id: 's' + Math.random(),
  name: 'x',
  kind: 'payroll',
  icon: 'x',
  color: '#000',
  active: true,
  stability: 'recurring',
  schedule: { mode: 'month-days', days: [15, 30] },
  method: 'transfer',
  verifiability: 'documented',
  expectedNet: 30000,
  createdAt: '2026-01-01',
  ...o,
});
const today = '2026-11-20';
const tiers = { salary: 60000, bonuses: 5000, commercial: 20000, declared: 10000 };
const obligations = { fixed: 20000, variable: 15000, debts: 5000, variableBasis: 'history' as const };

describe('income levels', () => {
  it('splits documented payroll, recurring bonuses, the business and everything else; benefits do not exist here', () => {
    const t = incomeTiers(
      [
        src({ id: 'pay' }), // 2 x 30,000
        src({ id: 'bonus', kind: 'bonus-commission', expectedNet: 5000, schedule: { mode: 'month-days', days: [10] } }),
        src({ id: 'declared-pay', verifiability: 'declared', expectedNet: 8000 }), // not documented: level 4
        src({ id: 'freelance', kind: 'freelance', stability: 'variable', schedule: undefined, expectedNet: undefined }),
        src({ id: 'shop', kind: 'commercial-sales', expectedNet: 99999 }), // business sales are level 3 only, never here
        src({ id: 'off', active: false }),
        src({ id: 'usd', currency: 'USD' }),
      ],
      [],
      today,
      12345.67
    );
    expect(t).toEqual({ salary: 60000, bonuses: 5000, commercial: 12345.67, declared: 16000 });
  });

  it('a loss in the business never lowers the income level below zero', () => {
    expect(incomeTiers([], [], today, -500).commercial).toBe(0);
  });
});

describe('three readings', () => {
  it('conservative = levels 1 and 2; with commercial = 1 to 3 (with the prudence discount); all = 1 to 4', () => {
    const r = readings(tiers, DEFAULT_LOAN_SETTINGS);
    expect(r.map((x) => x.key)).toEqual(['conservative', 'with-commercial', 'all-declared']);
    expect(r.map((x) => x.income)).toEqual([65000, 81000, 91000]); // 20,000 commercial less 20% = 16,000
    const commercial = r[1].parts.find((p) => p.tier === 'commercial')!;
    expect(commercial).toMatchObject({ amount: 16000, discount: 4000 });
  });

  it('the user can switch a level off, and change the discount', () => {
    const s: LoanSettings = { ...DEFAULT_LOAN_SETTINGS, commercialDiscount: 50, switches: { ...DEFAULT_LOAN_SETTINGS.switches, bonuses: false, declared: false } };
    expect(readings(tiers, s).map((x) => x.income)).toEqual([60000, 70000, 70000]);
  });
});

describe('capacity result', () => {
  it('committed percent, money left after the installment and the status by reading', () => {
    const c = evaluateCapacity(tiers, DEFAULT_LOAN_SETTINGS, obligations, 10000);
    // conservative: income 65,000 ; committed = (20,000 + 5,000 + 10,000) / 65,000 ; left = 65,000 - 20,000 - 15,000 - 5,000 - 10,000
    expect(c.rows[0]).toMatchObject({ key: 'conservative', income: 65000, committed: 53.85, availableAfter: 15000, status: 'risky' });
    expect(c.rows[1]).toMatchObject({ committed: 43.21, availableAfter: 31000, status: 'tight' });
    expect(c.rows[2]).toMatchObject({ committed: 38.46, availableAfter: 41000, status: 'tight' });
    expect(c.estimate).toBe(true);
  });

  it('status thresholds are a configurable reference; negative money left is always risky', () => {
    expect(statusOf(30, 100, 35, 50)).toBe('comfortable');
    expect(statusOf(35, 100, 35, 50)).toBe('comfortable');
    expect(statusOf(36, 100, 35, 50)).toBe('tight');
    expect(statusOf(50, 100, 35, 50)).toBe('tight');
    expect(statusOf(51, 100, 35, 50)).toBe('risky');
    expect(statusOf(10, -1, 35, 50)).toBe('risky');
    expect(statusOf(null, 0, 35, 50)).toBe('no-income');
    const loose = evaluateCapacity(tiers, { ...DEFAULT_LOAN_SETTINGS, comfortable: 60, tight: 80 }, obligations, 10000);
    expect(loose.rows[0].status).toBe('comfortable');
  });

  it('without income there is no percentage, only "no income"', () => {
    const c = evaluateCapacity({ salary: 0, bonuses: 0, commercial: 0, declared: 0 }, DEFAULT_LOAN_SETTINGS, obligations, 5000);
    expect(c.rows.every((r) => r.committed === null && r.status === 'no-income' && r.availableAfter < 0)).toBe(true);
  });

  it('a biweekly installment weighs 26/12 of itself per month', () => {
    expect(monthlyEquivalent(1200, 12)).toBe(1200);
    expect(monthlyEquivalent(1200, 26)).toBe(2600);
    expect(monthlyEquivalent(1200, 52)).toBe(5200);
  });

  it('an income drop lowers every reading and says whether the installment still fits', () => {
    const impact = incomeDropImpact(tiers, DEFAULT_LOAN_SETTINGS, { ...obligations, fixed: 10000, variable: 10000, debts: 0 }, 5000, [0, 10, 20, 30]);
    expect(impact.map((i) => i.drop)).toEqual([0, 10, 20, 30]);
    const conservative = impact.map((i) => i.rows[0]);
    expect(conservative.map((r) => r.income)).toEqual([65000, 58500, 52000, 45500]);
    for (let i = 1; i < conservative.length; i++) {
      expect(conservative[i].committed!).toBeGreaterThan(conservative[i - 1].committed!);
      expect(conservative[i].availableAfter).toBeLessThan(conservative[i - 1].availableAfter);
    }
    expect(conservative[0].status).toBe('comfortable'); // (10,000 + 0 + 5,000) / 65,000 = 23 %
    expect(conservative[3].committed).toBe(32.97);
    expect(evaluateCapacity(tiers, DEFAULT_LOAN_SETTINGS, obligations, 0, 100).rows[0].income).toBe(0);
    expect(evaluateCapacity(tiers, DEFAULT_LOAN_SETTINGS, obligations, 0, 250).rows[0].income).toBe(0); // clamped, never negative
  });
});
