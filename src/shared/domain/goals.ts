// Goals and the emergency fund. Pure. A goal is a virtual set-aside (nothing moves between
// accounts). Projections and viability are ESTIMATES (rule 10): they come back flagged with their
// assumptions. RD$ only.
import { GoalEntry, GoalModel, GoalStatus, PlanCadence } from '../models/goal.model';
import { IncomeSchedule } from '../models/income-source.model';
import { addMoney, round2, subMoney, sumMoney } from '../utils/money';
import { addDays, addMonthsKeepingDay, daysBetween, isValidIsoDate, lastCompleteMonths, weekdayOf } from './dates';
import { expectedDates } from './income';
import { median } from './budget';

// ----- reserved and progress

export const activeEntries = (g: Pick<GoalModel, 'entries'>): GoalEntry[] => g.entries.filter((e) => !e.reversed);

// Reserved = contributions - withdrawals, as of a date (all of it when no date is given)
export function reservedOf(g: Pick<GoalModel, 'entries'>, asOf?: string): number {
  let total = 0;
  for (const e of activeEntries(g)) {
    if (asOf !== undefined && e.date > asOf) continue;
    total = e.type === 'contribution' ? addMoney(total, e.amount) : subMoney(total, e.amount);
  }
  return total;
}

export interface Progress {
  reserved: number;
  target: number;
  percent: number; // real percentage: it can pass 100 (the surplus is never hidden)
  barPercent: number; // what the bar draws: capped at 100
  remaining: number; // never below zero
  surplus: number;
}

export function progressOf(g: Pick<GoalModel, 'entries' | 'target'>): Progress {
  const reserved = reservedOf(g);
  const percent = g.target > 0 ? Math.round((reserved / g.target) * 1000) / 10 : 0;
  return {
    reserved,
    target: g.target,
    percent,
    barPercent: Math.min(100, Math.max(0, percent)),
    remaining: Math.max(0, subMoney(g.target, reserved)),
    surplus: Math.max(0, subMoney(reserved, g.target)),
  };
}

// Archived and paused goals keep their status; an active one that reached its target is achieved
export function effectiveStatus(g: Pick<GoalModel, 'status' | 'entries' | 'target'>): GoalStatus {
  if (g.status === 'active' && g.target > 0 && reservedOf(g) >= g.target) return 'achieved';
  return g.status;
}

// ----- validation

export type GoalError = 'name' | 'target' | 'date' | 'currency' | 'plan' | 'months' | 'amount' | 'exceeds' | 'not-found' | 'read-only' | 'archived' | 'kind';

export interface GoalInput {
  name: string;
  target: number;
  targetDate?: string;
  currency?: 'DOP' | 'USD';
  plan?: { amount: number; cadence: PlanCadence; startDate: string };
  emergencyMonths?: number;
}

export function validateGoal(i: GoalInput): GoalError | null {
  if (!i.name.trim()) return 'name';
  if (!Number.isFinite(i.target) || i.target <= 0) return 'target';
  if (i.targetDate !== undefined && !isValidIsoDate(i.targetDate)) return 'date';
  if ((i.currency ?? 'DOP') !== 'DOP') return 'currency'; // RD$ only for now
  if (i.plan && (!Number.isFinite(i.plan.amount) || i.plan.amount <= 0 || !isValidIsoDate(i.plan.startDate))) return 'plan';
  if (i.emergencyMonths !== undefined && (!Number.isInteger(i.emergencyMonths) || i.emergencyMonths < 1 || i.emergencyMonths > 12)) return 'months';
  return null;
}

export function validateEntry(g: GoalModel, type: GoalEntry['type'], amount: number, date: string): GoalError | null {
  if (g.status === 'archived') return 'archived';
  if (!Number.isFinite(amount) || amount <= 0) return 'amount';
  if (!isValidIsoDate(date)) return 'date';
  if (type === 'withdrawal' && amount > reservedOf(g, date) + 1e-9) return 'exceeds'; // cannot take out more than is set aside
  return null;
}

// ----- periodic plan and reminders

export const monthlyOfPlan = (p: { amount: number; cadence: PlanCadence }): number => round2(p.amount * (p.cadence === 'weekly' ? 52 / 12 : p.cadence === 'biweekly' ? 2 : 1));

export function planSchedule(p: { cadence: PlanCadence; startDate: string }): IncomeSchedule {
  if (p.cadence === 'weekly') return { mode: 'weekly', weekday: weekdayOf(p.startDate) };
  if (p.cadence === 'biweekly') return { mode: 'month-days', days: [15, 30] };
  return { mode: 'month-days', days: [Number(p.startDate.slice(8, 10))] };
}

export interface Reminder {
  goalId: string;
  date: string; // the day the contribution was due
}

const EARLY = 3;
const LATE = 10;

// "Today it is time to contribute": due dates in the last `lookback` days (and today) that no
// contribution satisfied and nobody dismissed. Nothing is contributed on its own.
export function dueReminders(goals: readonly GoalModel[], today: string, lookback = 7): Reminder[] {
  const out: Reminder[] = [];
  for (const g of goals) {
    if (g.status !== 'active' || !g.plan || effectiveStatus(g) === 'achieved') continue;
    const start = g.plan.startDate;
    const from = addDays(today, -lookback) < start ? start : addDays(today, -lookback);
    const skipped = new Set(g.skippedDates ?? []);
    const contributions = activeEntries(g).filter((e) => e.type === 'contribution');
    const used = new Set<string>();
    for (const date of expectedDates(planSchedule(g.plan), from, today)) {
      if (skipped.has(date)) continue;
      const hit = contributions.find((c) => !used.has(c.id) && c.date >= addDays(date, -EARLY) && c.date <= addDays(date, LATE));
      if (hit) used.add(hit.id);
      else out.push({ goalId: g.id, date });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ----- projection (an estimate)

export interface Scenario {
  monthly: number; // the monthly contribution the scenario assumes
  months: number | null; // months still needed; null when it never finishes (no contributions)
  date: string | null; // projected completion date
}

export interface Projection {
  achieved: boolean;
  overdue: boolean; // the target date passed and the goal is not achieved
  plan: Scenario | null; // according to the declared plan
  actual: Scenario | null; // according to the real pace (average of the last 3 months)
  insufficient: boolean; // fewer than 2 contributions: only the plan is shown
  assumptions: string[]; // English phrases (translation keys)
  estimate: true;
}

const DAYS_PER_MONTH = 30.44;

function scenario(remaining: number, monthly: number, today: string): Scenario {
  if (monthly <= 0) return { monthly, months: null, date: null };
  const months = remaining / monthly;
  return { monthly, months: Math.round(months * 10) / 10, date: addDays(today, Math.ceil(months * DAYS_PER_MONTH)) };
}

// Real pace = average NET contribution per month over the last 3 complete months (months with
// nothing count as zero). It needs at least 2 contributions to say anything.
export function actualMonthly(g: Pick<GoalModel, 'entries'>, today: string): number {
  const months = lastCompleteMonths(today, 3);
  const totals = months.map((m) => sumMoney(activeEntries(g).filter((e) => e.date.startsWith(m)).map((e) => (e.type === 'contribution' ? e.amount : -e.amount))));
  return Math.max(0, round2(sumMoney(totals) / 3));
}

export function projectGoal(g: GoalModel, today: string): Projection {
  const p = progressOf(g);
  const contributions = activeEntries(g).filter((e) => e.type === 'contribution').length;
  const achieved = p.remaining <= 0;
  const overdue = !achieved && !!g.targetDate && g.targetDate < today;
  const insufficient = contributions < 2;
  const assumptions = [
    'The plan scenario assumes you contribute exactly what you declared.',
    'The real-pace scenario assumes the average of your last 3 months continues.',
    'Withdrawals count against the pace.',
  ];
  if (achieved) return { achieved, overdue: false, plan: null, actual: null, insufficient, assumptions, estimate: true };
  return {
    achieved,
    overdue,
    plan: g.plan ? scenario(p.remaining, monthlyOfPlan(g.plan), today) : null,
    actual: insufficient ? null : scenario(p.remaining, actualMonthly(g, today), today),
    insufficient,
    assumptions,
    estimate: true,
  };
}

// ----- viability (deterministic)

export type Viability = 'reachable' | 'tight' | 'unreachable' | 'no-date' | 'achieved';

export interface ViabilityResult {
  status: Viability;
  required: number; // monthly contribution needed to arrive on the target date
  monthsLeft: number | null;
  margin: number; // monthly margin available
  components: { guaranteedIncome: number; fixed: number; variableMedian: number; debtPayments: number };
  estimate: true;
}

export interface MarginInput {
  guaranteedIncome: number; // guaranteed monthly income (recurring and documented only)
  fixed: number; // fixed obligations per month
  variableMedian: number; // median of the variable spending
  debtPayments: number; // minimum debt payments per month
}

export const monthlyMargin = (m: MarginInput): number => round2(m.guaranteedIncome - m.fixed - m.variableMedian - m.debtPayments);

// required = (target - reserved) / months left. Reachable with 20 % or more of slack, tight when
// it fits the margin without slack, unreachable when it does not fit. Only guaranteed income counts.
export function viability(g: GoalModel, today: string, margin: MarginInput): ViabilityResult {
  const p = progressOf(g);
  const m = monthlyMargin(margin);
  const base = { margin: m, components: { guaranteedIncome: margin.guaranteedIncome, fixed: margin.fixed, variableMedian: margin.variableMedian, debtPayments: margin.debtPayments }, estimate: true as const };
  if (p.remaining <= 0) return { ...base, status: 'achieved', required: 0, monthsLeft: null };
  if (!g.targetDate) return { ...base, status: 'no-date', required: 0, monthsLeft: null };
  const monthsLeft = Math.max(0, daysBetween(today, g.targetDate) / DAYS_PER_MONTH);
  // a target date that has passed (or is days away) asks for everything now
  const required = round2(monthsLeft < 1 ? p.remaining : p.remaining / monthsLeft);
  const status: Viability = m <= 0 ? 'unreachable' : required <= m * 0.8 ? 'reachable' : required <= m ? 'tight' : 'unreachable';
  return { ...base, status, required, monthsLeft: Math.round(monthsLeft * 10) / 10 };
}

// ----- emergency fund

export interface EmergencyBase {
  monthly: number; // essential monthly expenses + minimum debt payments
  essential: number;
  debtPayments: number;
  basis: 'history' | 'declared'; // declared = fixed expenses you declared, because there are fewer than 3 months of history
  months: number; // months of history behind the figure
  estimate: true;
}

export const MIN_EMERGENCY_HISTORY = 3;

// Median of the last 3-6 months of essential spending (fixed + variable of the essential blocks)
// plus the minimum debt payments; with less than 3 months it falls back to the declared fixed
// expenses and says so.
export function emergencyBase(essentialHistory: readonly number[], fixedDeclaredMonthly: number, debtPayments: number): EmergencyBase {
  const history = essentialHistory.slice(-6);
  if (history.length >= MIN_EMERGENCY_HISTORY) {
    const essential = median(history);
    return { monthly: round2(essential + debtPayments), essential, debtPayments, basis: 'history', months: history.length, estimate: true };
  }
  return { monthly: round2(fixedDeclaredMonthly + debtPayments), essential: fixedDeclaredMonthly, debtPayments, basis: 'declared', months: history.length, estimate: true };
}

export interface EmergencyFund {
  months: number; // chosen by the user, 1 to 12 (3 and 6 are shortcuts, not rules)
  base: EmergencyBase;
  target: number; // months x monthly base
  reserved: number;
  coverage: number; // months of base covered by what is reserved
  previousTarget: number | null;
  targetChange: { from: number; to: number } | null; // "your target rose from X to Y"
  estimate: true;
}

export function emergencyFund(months: number, base: EmergencyBase, reserved: number, previousTarget: number | null): EmergencyFund {
  const target = round2(months * base.monthly);
  const changed = previousTarget !== null && previousTarget > 0 && Math.abs(target - previousTarget) / previousTarget >= 0.01;
  return {
    months,
    base,
    target,
    reserved,
    coverage: base.monthly > 0 ? Math.round((reserved / base.monthly) * 10) / 10 : 0,
    previousTarget,
    targetChange: changed ? { from: previousTarget!, to: target } : null,
    estimate: true,
  };
}

// ----- groups: personal savings vs reserved commercial capital (never added together)

export interface GoalTotals {
  personal: number; // goals that are personal savings
  commercial: number; // "capital para emprendimiento": shown and summed apart
  outsideSavingsAccounts: number; // personal reserved that is not sitting in an associated savings account
}

export function goalTotals(goals: readonly GoalModel[], isSavingsAccount: (id: string) => boolean): GoalTotals {
  let personal = 0;
  let commercial = 0;
  let outside = 0;
  for (const g of goals) {
    if (g.status === 'archived' || g.currency !== 'DOP') continue;
    const r = Math.max(0, reservedOf(g));
    if (g.kind === 'business-capital') commercial = addMoney(commercial, r);
    else {
      personal = addMoney(personal, r);
      if (!g.accountId || !isSavingsAccount(g.accountId)) outside = addMoney(outside, r);
    }
  }
  return { personal, commercial, outsideSavingsAccounts: outside };
}

// What was contributed to goals in a month, by block of the budget (contributions only)
export function monthContributions(goals: readonly GoalModel[], monthKey: string): { savings: number; emergency: number } {
  let savings = 0;
  let emergency = 0;
  for (const g of goals) {
    if (g.currency !== 'DOP') continue;
    const sum = sumMoney(activeEntries(g).filter((e) => e.type === 'contribution' && e.date.startsWith(monthKey)).map((e) => e.amount));
    if (g.kind === 'emergency') emergency = addMoney(emergency, sum);
    else savings = addMoney(savings, sum);
  }
  return { savings, emergency };
}

export const monthAfter = (iso: string, n: number): string => addMonthsKeepingDay(iso, n);
