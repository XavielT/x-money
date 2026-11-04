import { InsightStateModel } from '../../models/insight.model';
import { MonthEndProjection } from '../budget';
import { Cashflow } from '../dashboard';
import { Projection } from '../goals';
import { DEFAULT_INSIGHT_SETTINGS, RULES, isVisible, rank, ruleSetting, stateIdOf } from './engine';
import { bucketOf, fingerprintOf, makeInsight } from './helpers';
import { cashflowEstimates, goalEstimate, monthEndEstimate } from './projections';
import { Insight } from './types';

const make = (over: Partial<Insight> = {}, value: number | string = 1000, txIds?: string[]): Insight =>
  makeInsight({
    id: 'x:1',
    rule: 'duplicates',
    module: 'data',
    severity: 'info',
    titleKey: 't',
    messageKey: 'm',
    params: {},
    evidence: [{ label: 'Amount', value, kind: 'money', source: txIds ? { txIds } : undefined }],
    formula: 'f',
    dataState: 'confirmed',
    period: '2026-11',
    ...over,
  });

describe('fingerprint of the evidence', () => {
  it('ignores small changes, notices material ones, and ignores the order of ids', () => {
    expect(make({}, 1000).fingerprint).toBe(make({}, 1001).fingerprint);
    expect(make({}, 1000).fingerprint).not.toBe(make({}, 1500).fingerprint);
    expect(make({}, 1000, ['a', 'b']).fingerprint).toBe(make({}, 1000, ['b', 'a']).fingerprint);
    expect(make({}, 1000, ['a', 'b']).fingerprint).not.toBe(make({}, 1000, ['a', 'c']).fingerprint);
    expect(fingerprintOf('a', [])).not.toBe(fingerprintOf('b', []));
  });

  it('buckets are about 10 % wide, symmetric for negatives, and 0 stays 0', () => {
    expect(bucketOf(0)).toBe(0);
    expect(bucketOf(-1000)).toBe(-bucketOf(1000));
    expect(bucketOf('text')).toBe('text');
    expect(bucketOf(1100)).not.toBe(bucketOf(1000));
  });
});

describe('dismiss and snooze', () => {
  const insight = make({}, 1000);
  const state = (over: Partial<InsightStateModel> = {}): InsightStateModel => ({ id: stateIdOf(insight.id), insightId: insight.id, status: 'dismissed', fingerprint: insight.fingerprint, at: '2026-11-01T00:00:00Z', ...over });

  it('is visible without a state, hidden once dismissed, and stays hidden while the evidence does not change', () => {
    expect(isVisible(insight, undefined, '2026-11-20')).toBe(true);
    expect(isVisible(insight, state(), '2026-11-20')).toBe(false);
    expect(isVisible(make({}, 1001), state(), '2026-11-20')).toBe(false); // a 0.1 % change is not material
  });

  it('comes back when the evidence changes materially', () => {
    expect(isVisible(make({}, 2000), state(), '2026-11-20')).toBe(true);
    expect(isVisible(make({}, 1000, ['new-id']), state(), '2026-11-20')).toBe(true);
  });

  it('a snooze hides it until its date, and then it is back even if nothing changed', () => {
    const snoozed = state({ status: 'snoozed', until: '2026-11-27' });
    expect(isVisible(insight, snoozed, '2026-11-26')).toBe(false);
    expect(isVisible(insight, snoozed, '2026-11-27')).toBe(true);
    expect(isVisible(make({}, 5000), snoozed, '2026-11-21')).toBe(true); // material change beats a snooze
  });

  it('the storage id is safe for the server', () => {
    expect(stateIdOf('a b/c:d')).toBe('a_b_c:d');
    expect(stateIdOf('x'.repeat(300))).toHaveLength(128);
  });
});

describe('ranking and rules', () => {
  it('alerts first, then critical ones, then by module', () => {
    const list = rank([make({ id: 'i', severity: 'info' }), make({ id: 'a', severity: 'attention', module: 'income' }), make({ id: 'c', severity: 'alert' }), make({ id: 'k', severity: 'alert', critical: true, module: 'debt' })]);
    expect(list.map((i) => i.id)).toEqual(['k', 'c', 'a', 'i']);
  });

  it('every rule is on by default and has thresholds with sensible ranges', () => {
    for (const r of RULES) {
      expect(ruleSetting(DEFAULT_INSIGHT_SETTINGS, r.id).enabled).toBe(true);
      for (const t of r.thresholds) expect(t.default >= t.min && t.default <= t.max).toBe(true);
    }
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
  });

  it('a rule can be turned off and a threshold changed', () => {
    const s = ruleSetting({ rules: { 'variable-dependence': { enabled: false, thresholds: { sharePercent: 55 } } } }, 'variable-dependence');
    expect(s).toEqual({ enabled: false, thresholds: { sharePercent: 55 } });
  });
});

describe('projections are Estimates (rule 10)', () => {
  it('month end: value, range and assumptions', () => {
    const e = monthEndEstimate({ projected: 1000, low: 500, high: 1500 } as MonthEndProjection);
    expect(e).toMatchObject({ value: 1000, low: 500, high: 1500, isEstimate: true });
    expect(e.assumptions.length).toBeGreaterThan(0);
  });

  it('cash flow: one Estimate per horizon and the same projection without variable income', () => {
    const flow = (mid: number): Cashflow => ({ summaries: [30, 60, 90].map((days) => ({ days: days as 30 | 60 | 90, mid: mid + days, low: mid - 10, high: mid + 10 })), assumptions: ['A'] } as Cashflow);
    const list = cashflowEstimates(flow(100), flow(50));
    expect(list.map((x) => x.id)).toEqual(['cashflow-30', 'cashflow-60', 'cashflow-90']);
    expect(list[0].estimate.value).toBe(130);
    expect(list[0].withoutVariableIncome!.value).toBe(80);
    expect(list.every((x) => x.estimate.isEstimate && x.withoutVariableIncome!.isEstimate)).toBe(true);
  });

  it('goal completion: the real pace when there is history, the plan otherwise, the range between both', () => {
    const p = (insufficient: boolean): Projection => ({ achieved: false, overdue: false, plan: { monthly: 10, months: 5, date: '2027-04-01' }, actual: { monthly: 5, months: 10, date: '2027-09-01' }, insufficient, assumptions: ['x'], estimate: true });
    const withHistory = goalEstimate(p(false));
    expect(withHistory.value).toEqual({ months: 10, date: '2027-09-01' });
    expect(withHistory.low.date).toBe('2027-04-01');
    expect(withHistory.high.date).toBe('2027-09-01');
    const without = goalEstimate(p(true));
    expect(without.value.date).toBe('2027-04-01');
    const never = goalEstimate({ ...p(false), actual: { monthly: 0, months: null, date: null } });
    expect(never.high.date).toBeNull();
    expect(goalEstimate({ ...p(false), plan: null, actual: null, assumptions: [] }).assumptions.length).toBeGreaterThan(0);
  });
});
