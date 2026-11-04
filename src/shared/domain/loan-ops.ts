// Operations on a REGISTERED loan (2.14.0), pure. What is owed is never stored: it is the debt at
// the start minus the principal paid. A payment is split by the order interest, charges, principal
// (so a partial payment first covers what the lender charges), and only the principal reduces the
// debt: it is not an expense (integrity rule 1 in spirit: money that repays a debt is not spending).
import { LoanModel, LoanPayment } from '../models/loan.model';
import { daysBetween } from './dates';
import { Adjustments, ScheduleRow, amortize, recurringOthersOf } from './loans';
import { addMoney, round2, subMoney, sumMoney } from '../utils/money';

const live = (p: LoanPayment): boolean => !p.reversed;

export const paidPrincipal = (l: Pick<LoanModel, 'payments'>): number => sumMoney(l.payments.filter(live).map((p) => p.principal));

// What is still owed (never below zero)
export const outstanding = (l: Pick<LoanModel, 'debt' | 'payments' | 'status'>): number => (l.status === 'voided' ? 0 : Math.max(0, subMoney(l.debt, paidPrincipal(l))));

export const paidOfInstallment = (l: Pick<LoanModel, 'payments'>, n: number): number => sumMoney(l.payments.filter((p) => live(p) && p.installment === n).map((p) => p.amount));

export const remainingOfInstallment = (l: Pick<LoanModel, 'payments'>, row: ScheduleRow): number => Math.max(0, subMoney(row.payment, paidOfInstallment(l, row.n)));

// First installment that is not fully paid
export function nextInstallment(l: Pick<LoanModel, 'schedule' | 'payments' | 'status'>): ScheduleRow | undefined {
  if (l.status !== 'active') return undefined;
  return l.schedule.find((r) => remainingOfInstallment(l, r) > 0);
}

// Installments paid in full, counted from the start without gaps
export function paidThrough(l: Pick<LoanModel, 'schedule' | 'payments'>): number {
  let k = 0;
  while (k < l.schedule.length && remainingOfInstallment(l, l.schedule[k]) === 0) k++;
  return k;
}

export interface Split {
  interest: number;
  fees: number;
  principal: number;
}

// How a payment toward one installment splits: interest first, then charges, then principal
export function allocate(row: ScheduleRow, alreadyPaid: number, amount: number): Split {
  const slice = (from: number, size: number) => Math.max(0, Math.min(addMoney(alreadyPaid, amount), from + size) - Math.max(alreadyPaid, from));
  const interest = round2(slice(0, row.interest));
  const fees = round2(slice(row.interest, row.fees));
  const principal = round2(slice(addMoney(row.interest, row.fees), row.principal));
  return { interest, fees, principal };
}

export type PayError = 'amount' | 'exceeds' | 'no-installment' | 'inactive' | 'out-of-order' | 'partial-pending' | 'method-rate' | 'no-amortization' | 'later-payments' | 'not-found' | 'already-reversed';

// An extra payment to principal. The schedule of the installments that are NOT paid yet is
// recomputed from what is still owed: shorter (same installment) or lighter (same term).
export function reschedule(l: LoanModel, extra: number, mode: 'reduce-term' | 'reduce-installment'): { rows: ScheduleRow[] } | { error: PayError } {
  if (l.method === 'flat') return { error: 'method-rate' };
  const through = paidThrough(l);
  // a payment on a later installment, or a partly paid one, would make "what is left" ambiguous
  if (l.payments.some((p) => live(p) && p.installment !== null && p.installment > through + 1)) return { error: 'out-of-order' };
  if (l.payments.some((p) => live(p) && p.installment === through + 1)) return { error: 'partial-pending' };
  const next = l.schedule[through];
  if (!next) return { error: 'no-installment' };
  const owed = outstanding(l);
  if (!(extra > 0) || extra >= owed) return { error: extra >= owed ? 'exceeds' : 'amount' };
  const left = l.schedule.length - through;
  const balance = round2(owed - extra);
  const first = l.schedule[through];
  const run = amortize({
    principal: balance,
    periods: left,
    frequency: l.frequency,
    method: l.method,
    rate: l.rate,
    firstDate: first.date,
    insurance: l.costs?.insurance,
    recurringOthers: recurringOthersOf({ amount: l.amount, rate: l.rate, method: l.method, termMonths: l.termMonths, frequency: l.frequency, firstDate: l.firstDate, costs: l.costs }),
    keepInstallment: mode === 'reduce-term' ? (l.method === 'french' ? first.principal + first.interest : first.principal) : undefined,
    offset: through,
  });
  if (run.error) return { error: run.error === 'no-amortization' ? 'no-amortization' : 'method-rate' };
  return { rows: [...l.schedule.slice(0, through), ...run.rows] };
}

// ----- alerts (same moments as the credit-card ones, inside the app)

export type LoanAlertStage = 'due-7' | 'due-3' | 'due-1' | 'overdue';

export interface LoanAlert {
  key: string; // stable per loan, installment and stage
  loanId: string;
  stage: LoanAlertStage;
  date: string;
  daysLeft: number; // negative once overdue
  amount: number; // what is still owed on that installment
}

export function loanAlerts(loans: readonly LoanModel[], today: string): LoanAlert[] {
  const out: LoanAlert[] = [];
  for (const l of loans) {
    const row = nextInstallment(l);
    if (!row) continue;
    const daysLeft = daysBetween(today, row.date);
    const stage: LoanAlertStage | null = daysLeft < 0 ? 'overdue' : daysLeft <= 1 ? 'due-1' : daysLeft <= 3 ? 'due-3' : daysLeft <= 7 ? 'due-7' : null;
    if (stage) out.push({ key: `${l.id}:${row.n}:${stage}`, loanId: l.id, stage, date: row.date, daysLeft, amount: remainingOfInstallment(l, row) });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

// What the active loans ask each month (an estimate: the next installment of each, per month of its frequency)
export function monthlyInstallments(loans: readonly LoanModel[]): number {
  return sumMoney(
    loans
      .filter((l) => l.status === 'active')
      .map((l) => {
        const row = nextInstallment(l);
        if (!row) return 0;
        const perMonth = l.frequency === 'monthly' ? 1 : l.frequency === 'biweekly' ? 26 / 12 : 52 / 12;
        return round2(row.payment * perMonth);
      })
  );
}

// Installments due up to a date (the overdue ones count as due on `from`), with what is still owed on each
export function installmentsDue(loans: readonly LoanModel[], from: string, to: string): { date: string; amount: number; loanId: string }[] {
  const out: { date: string; amount: number; loanId: string }[] = [];
  for (const l of loans) {
    if (l.status !== 'active') continue;
    for (const r of l.schedule) {
      const remaining = remainingOfInstallment(l, r);
      if (remaining > 0 && r.date <= to) out.push({ date: r.date < from ? from : r.date, amount: remaining, loanId: l.id }); // overdue ones count as due today
    }
  }
  return out;
}

export type { Adjustments };
