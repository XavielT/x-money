// Every projection of the app under ONE type: Estimate<T> (integrity rule 10). These adapters wrap
// the projections that already exist (end of month: prompt 04, cash flow: prompt 05, goal
// completion: prompt 07) instead of recalculating them, and add what the user needs to read them:
// the range, the assumptions and what happens if the variable income does not arrive.
import { MonthEndProjection } from '../budget';
import { Cashflow } from '../dashboard';
import { Projection } from '../goals';
import { Estimate, estimate } from './types';

export type ProjectionKind = 'month-end' | 'cashflow' | 'goal';

// Every kind of projection the app has; the test walks the registry and fails when a kind is
// missing or when an entry is not an Estimate
export const PROJECTION_KINDS: readonly ProjectionKind[] = ['month-end', 'cashflow', 'goal'];

export interface GoalTiming {
  date: string | null;
  months: number | null;
}

export interface ProjectionEntry<T = number | GoalTiming> {
  id: string;
  kind: ProjectionKind;
  labelKey: string;
  subject?: string; // a goal name, for example
  estimate: Estimate<T>;
  withoutVariableIncome?: Estimate<T>; // the same projection if the variable income does not arrive
}

export function monthEndEstimate(p: MonthEndProjection): Estimate<number> {
  return estimate(p.projected, p.low, p.high, [
    'Starts from your liquid balance today.',
    'Subtracts the fixed obligations still to pay this month.',
    'Variable spending still expected follows your recent pace and your recurring patterns.',
    'Adds only guaranteed income still expected: variable income and non-monetary benefits are not included.',
  ]);
}

export function cashflowEstimates(main: Cashflow, withoutVariable: Cashflow): ProjectionEntry<number>[] {
  return main.summaries.map((s) => {
    const w = withoutVariable.summaries.find((x) => x.days === s.days)!;
    return {
      id: `cashflow-${s.days}`,
      kind: 'cashflow' as const,
      labelKey: s.days === 30 ? 'Cash flow in 30 days' : s.days === 60 ? 'Cash flow in 60 days' : 'Cash flow in 90 days',
      estimate: estimate(s.mid, s.low, s.high, main.assumptions),
      withoutVariableIncome: estimate(w.mid, w.low, w.high, withoutVariable.assumptions),
    };
  });
}

const byDate = (a: GoalTiming, b: GoalTiming): number => (a.date === b.date ? 0 : a.date === null ? 1 : b.date === null ? -1 : a.date < b.date ? -1 : 1);

export function goalEstimate(p: Projection): Estimate<GoalTiming> {
  const timing = (s: Projection['plan']): GoalTiming | null => (s ? { date: s.date, months: s.months } : null);
  const plan = timing(p.plan);
  const actual = p.insufficient ? null : timing(p.actual);
  const options = [plan, actual].filter((x): x is GoalTiming => x !== null).sort(byDate);
  const none: GoalTiming = { date: null, months: null };
  const value = actual ?? plan ?? none;
  return estimate(value, options[0] ?? none, options[options.length - 1] ?? none, [...(p.assumptions.length ? p.assumptions : ['Based on your plan and the pace of your contributions.'])]);
}
