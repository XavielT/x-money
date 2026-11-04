// Loan amortization engine (2.14.0). Pure: no Angular, no storage. Every amount is rounded to
// cents on each period and the LAST period absorbs the rounding residue, so the principal always
// adds up to what was borrowed and the balance never goes negative. Everything it returns is a
// SIMULATION / ESTIMATE (integrity rule 10): nominal, effective and flat rates are different
// things, and the "effective cost" is the IRR of the real cash flow, not the advertised rate.
import { addDays, addMonthsKeepingDay, isValidIsoDate } from './dates';
import { addMoney, round2, sumMoney } from '../utils/money';

export type AmortMethod = 'french' | 'german' | 'flat'; // fixed installment / constant principal / interest on the original amount
export type RateType = 'nominal' | 'effective' | 'flat';
export type PayFrequency = 'monthly' | 'biweekly' | 'weekly';

export const PERIODS_PER_YEAR: Record<PayFrequency, number> = { monthly: 12, biweekly: 26, weekly: 52 };

export interface RateSpec {
  value: number; // percent per year
  type: RateType;
  compounding?: number; // nominal only: capitalizations per year (12 by default)
}

export interface LoanCosts {
  insurance?: { mode: 'fixed' | 'percent'; value: number }; // per period: a fixed amount or a percent of the opening balance
  commission?: { mode: 'fixed' | 'percent'; value: number; financed: boolean }; // percent of the amount; financed = added to the debt
  others?: { label?: string; amount: number; recurring: boolean }[]; // one-off (paid at the start) or on every period
}

export interface LoanInput {
  amount: number;
  rate: RateSpec;
  method: AmortMethod;
  termMonths: number;
  frequency: PayFrequency;
  firstDate: string; // date of the first payment
  costs?: LoanCosts;
  periods?: number; // overrides the periods derived from the term
}

export type LoanError = 'amount' | 'rate' | 'term' | 'date' | 'costs' | 'method-rate' | 'no-amortization';

export interface ScheduleRow {
  n: number;
  date: string;
  opening: number;
  principal: number; // the regular part of the installment
  interest: number;
  fees: number; // insurance and recurring charges
  payment: number; // principal + interest + fees (without extra payments)
  extra: number; // extra payment to principal made together with this installment
  balance: number; // after the installment and the extra payment
}

// ----- rates

export const nominalToEffective = (nominalPct: number, compounding = 12): number => ((1 + nominalPct / 100 / compounding) ** compounding - 1) * 100;
export const effectiveToNominal = (effectivePct: number, compounding = 12): number => compounding * ((1 + effectivePct / 100) ** (1 / compounding) - 1) * 100;

// Effective annual rate (percent) of a declared rate. Flat rates have no effective annual rate of
// their own: see equivalentFlatEffective.
export function effectiveAnnual(rate: RateSpec): number {
  if (rate.type === 'effective') return rate.value;
  if (rate.type === 'nominal') return nominalToEffective(rate.value, rate.compounding ?? 12);
  return NaN;
}

// Rate of one payment period, whatever the payment frequency (from the effective annual rate)
export function periodicRate(rate: RateSpec, ppy: number): number {
  if (rate.type === 'flat') return rate.value / 100 / ppy;
  return (1 + effectiveAnnual(rate) / 100) ** (1 / ppy) - 1;
}

export const periodsFor = (termMonths: number, frequency: PayFrequency): number => Math.max(1, Math.round((termMonths * PERIODS_PER_YEAR[frequency]) / 12));

export function dateOfPeriod(firstDate: string, frequency: PayFrequency, n: number): string {
  if (frequency === 'monthly') return addMonthsKeepingDay(firstDate, n - 1, Number(firstDate.slice(8, 10)));
  return addDays(firstDate, (frequency === 'biweekly' ? 14 : 7) * (n - 1));
}

const pmtFor = (balance: number, i: number, n: number): number => (i === 0 ? balance / n : (balance * i) / (1 - (1 + i) ** -n));

// Internal rate of return of a cash flow (bisection: robust, no derivatives). Per period.
export function irr(flows: readonly number[]): number | null {
  const f = (r: number) => flows.reduce((s, c, t) => s + c / (1 + r) ** t, 0);
  let lo = -0.9;
  let hi = 5;
  if (f(lo) * f(hi) > 0) return null;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    if (f(lo) * f(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

// ----- validation

export function validateLoan(i: LoanInput): LoanError | null {
  if (!Number.isFinite(i.amount) || i.amount <= 0 || i.amount > 1e12) return 'amount';
  const r = i.rate;
  if (!Number.isFinite(r.value) || r.value < 0 || r.value > 1000) return 'rate';
  if (r.compounding !== undefined && (!Number.isInteger(r.compounding) || r.compounding < 1 || r.compounding > 365)) return 'rate';
  if ((i.method === 'flat') !== (r.type === 'flat')) return 'method-rate';
  const months = i.periods === undefined ? i.termMonths : 1;
  if (!Number.isInteger(months) || months < 1 || months > 600) return 'term';
  if (i.periods !== undefined && (!Number.isInteger(i.periods) || i.periods < 1)) return 'term';
  if (!isValidIsoDate(i.firstDate)) return 'date';
  const c = i.costs;
  if (c) {
    const bad = (n: number | undefined) => n !== undefined && (!Number.isFinite(n) || n < 0);
    if (bad(c.insurance?.value) || bad(c.commission?.value) || (c.others ?? []).some((o) => bad(o.amount))) return 'costs';
    if ((c.insurance?.mode === 'percent' && (c.insurance.value ?? 0) > 100) || (c.commission?.mode === 'percent' && c.commission.value > 100)) return 'costs';
  }
  return null;
}

// ----- the engine

export interface Adjustments {
  extras?: { period: number; amount: number }[]; // one-off extra payments to principal
  recurringExtra?: { amount: number; every: number; from: number }; // a periodic extra payment
  extraMode?: 'reduce-term' | 'reduce-installment';
  rateChanges?: { period: number; rate: RateSpec }[]; // the rate applies from that period on
  rateChangeMode?: 'adjust-installment' | 'adjust-term';
  cancelAt?: { period: number; penaltyPercent: number }; // pay what is left right after installment `period`
}

export interface EngineArgs {
  principal: number;
  periods: number;
  frequency: PayFrequency;
  method: AmortMethod;
  rate: RateSpec;
  firstDate: string;
  insurance?: LoanCosts['insurance'];
  recurringOthers?: number; // sum of the recurring charges per period
  adjust?: Adjustments;
  keepInstallment?: number; // keep this installment (french) or this principal (german) instead of recomputing it
  offset?: number; // numbering starts after this period (a loan that is already running)
}

export interface Cancellation {
  period: number;
  balance: number; // what is still owed after that installment
  penalty: number;
  payoff: number; // balance + penalty: what it takes to close the loan
}

export interface EngineResult {
  rows: ScheduleRow[];
  cancel?: Cancellation;
  error?: LoanError;
}

const feesOf = (a: EngineArgs, balance: number): number => {
  let f = a.recurringOthers ?? 0;
  if (a.insurance) f = addMoney(f, a.insurance.mode === 'fixed' ? round2(a.insurance.value) : round2((balance * a.insurance.value) / 100));
  return f;
};

export function amortize(a: EngineArgs): EngineResult {
  const ppy = PERIODS_PER_YEAR[a.frequency];
  const adj = a.adjust ?? {};
  const offset = a.offset ?? 0;
  if (a.method === 'flat' && (adj.extras?.length || adj.recurringExtra || adj.rateChanges?.length)) return { rows: [], error: 'method-rate' };
  const mayExtend = adj.rateChangeMode === 'adjust-term' && !!adj.rateChanges?.length;
  const maxK = mayExtend ? a.periods + 600 : a.periods;
  let i = periodicRate(a.rate, ppy);
  let balance = round2(a.principal);
  let pmt = a.method === 'french' ? round2(a.keepInstallment ?? pmtFor(balance, i, a.periods)) : 0;
  let steady = a.method === 'german' ? round2(a.keepInstallment ?? balance / a.periods) : 0; // constant principal
  const flatInterest = a.method === 'flat' ? round2((balance * a.rate.value) / 100 / ppy) : 0;
  const flatPrincipal = a.method === 'flat' ? round2(balance / a.periods) : 0;
  const rows: ScheduleRow[] = [];
  let cancel: Cancellation | undefined;

  for (let k = 1; k <= maxK && balance > 0; k++) {
    const change = adj.rateChanges?.find((c) => c.period === k);
    if (change) {
      i = periodicRate(change.rate, ppy);
      if (a.method === 'french' && adj.rateChangeMode !== 'adjust-term') pmt = round2(pmtFor(balance, i, a.periods - k + 1));
    }
    const opening = balance;
    const interest = a.method === 'flat' ? flatInterest : round2(balance * i);
    const fees = feesOf(a, opening);
    const last = k >= a.periods && !mayExtend;
    let principal: number;
    if (last) principal = balance;
    else if (a.method === 'french') principal = round2(pmt - interest);
    else if (a.method === 'german') principal = steady;
    else principal = flatPrincipal;
    if (principal <= 0) return { rows, error: 'no-amortization' }; // the installment does not cover the interest
    if (principal > balance) principal = balance;
    let extra = 0;
    if (adj.extras?.length) extra = sumMoney(adj.extras.filter((e) => e.period === k).map((e) => e.amount));
    const re = adj.recurringExtra;
    if (re && k >= re.from && (k - re.from) % re.every === 0) extra = addMoney(extra, re.amount);
    extra = Math.max(0, Math.min(round2(extra), round2(balance - principal)));
    balance = round2(balance - principal - extra);
    rows.push({ n: offset + k, date: dateOfPeriod(a.firstDate, a.frequency, k), opening, principal, interest, fees, payment: addMoney(addMoney(principal, interest), fees), extra, balance });
    if (extra > 0 && balance > 0 && adj.extraMode === 'reduce-installment') {
      const left = a.periods - k;
      if (left > 0) {
        if (a.method === 'french') pmt = round2(pmtFor(balance, i, left));
        else steady = round2(balance / left);
      }
    }
    if (adj.cancelAt && adj.cancelAt.period === k) {
      const penalty = round2((balance * adj.cancelAt.penaltyPercent) / 100);
      cancel = { period: offset + k, balance, penalty, payoff: addMoney(balance, penalty) };
      return { rows, cancel };
    }
  }
  if (balance > 0) return { rows, error: 'no-amortization' };
  if (adj.cancelAt && adj.cancelAt.period >= rows.length) cancel = { period: offset + rows.length, balance: 0, penalty: 0, payoff: 0 };
  return { rows, cancel };
}

// ----- the quote

export interface LoanTotals {
  principal: number; // the debt: the amount plus a financed commission
  installment: number; // first installment, with insurance and recurring charges
  interest: number;
  fees: number; // insurance and recurring charges over the whole life
  upfront: number; // commission and one-off charges paid at the start
  financedCommission: number;
  extras: number; // extra payments to principal
  totalCost: number; // interest + all charges: what the loan costs over the amount
  totalPayable: number; // everything paid back, including what was paid at the start
  disbursed: number; // cash that actually arrives (the amount minus what is paid at the start)
}

export interface LoanQuote {
  input: LoanInput;
  periods: number;
  rows: ScheduleRow[];
  totals: LoanTotals;
  periodicRate: number;
  effectiveRate: number | null; // percent: the declared rate as an effective annual one (flat: its equivalent)
  effectiveCost: number | null; // percent: IRR of the real cash flow with every charge ("estimated effective cost")
  cancel?: Cancellation;
  assumptions: string[]; // English phrases (translation keys)
  estimate: true;
  error?: LoanError;
}

export function upfrontOf(input: LoanInput): { commission: number; financed: number; once: number } {
  const c = input.costs;
  let commission = 0;
  if (c?.commission) commission = c.commission.mode === 'percent' ? round2((input.amount * c.commission.value) / 100) : round2(c.commission.value);
  const once = sumMoney((c?.others ?? []).filter((o) => !o.recurring).map((o) => o.amount));
  const financed = c?.commission?.financed ? commission : 0;
  return { commission: financed ? 0 : commission, financed, once: round2(once) };
}

export const recurringOthersOf = (input: LoanInput): number => sumMoney((input.costs?.others ?? []).filter((o) => o.recurring).map((o) => o.amount));

const emptyTotals = (): LoanTotals => ({ principal: 0, installment: 0, interest: 0, fees: 0, upfront: 0, financedCommission: 0, extras: 0, totalCost: 0, totalPayable: 0, disbursed: 0 });

export function quoteLoan(input: LoanInput, adjust?: Adjustments): LoanQuote {
  const periods = input.periods ?? periodsFor(input.termMonths, input.frequency);
  const base = { input, periods, periodicRate: 0, effectiveRate: null, effectiveCost: null, assumptions: [], estimate: true as const };
  const error = validateLoan(input);
  if (error) return { ...base, rows: [], totals: emptyTotals(), error };
  const ppy = PERIODS_PER_YEAR[input.frequency];
  const up = upfrontOf(input);
  const principal = addMoney(input.amount, up.financed);
  const run = amortize({ principal, periods, frequency: input.frequency, method: input.method, rate: input.rate, firstDate: input.firstDate, insurance: input.costs?.insurance, recurringOthers: recurringOthersOf(input), adjust });
  if (run.error) return { ...base, rows: run.rows, totals: emptyTotals(), error: run.error };
  const rows = run.rows;
  const interest = sumMoney(rows.map((r) => r.interest));
  const fees = sumMoney(rows.map((r) => r.fees));
  const extras = sumMoney(rows.map((r) => r.extra));
  const upfront = addMoney(up.commission, up.once);
  const paid = sumMoney(rows.map((r) => addMoney(r.payment, r.extra)));
  const cancelPayoff = run.cancel?.payoff ?? 0;
  const totalPayable = addMoney(addMoney(paid, upfront), cancelPayoff);
  const disbursed = round2(input.amount - upfront);
  const totals: LoanTotals = {
    principal,
    installment: rows[0]?.payment ?? 0,
    interest,
    fees,
    upfront,
    financedCommission: up.financed,
    extras,
    totalCost: round2(totalPayable - input.amount),
    totalPayable,
    disbursed,
  };
  const flows = [disbursed, ...rows.map((r, idx) => -addMoney(r.payment, r.extra) - (idx === rows.length - 1 ? cancelPayoff : 0))];
  const periodic = irr(flows);
  const effectiveCost = periodic === null ? null : ((1 + periodic) ** ppy - 1) * 100;
  let effectiveRate: number | null = effectiveAnnual(input.rate);
  if (input.rate.type === 'flat') {
    const p = irr([input.amount, ...rows.map((r) => -addMoney(r.principal, r.interest))]);
    effectiveRate = p === null ? null : ((1 + p) ** ppy - 1) * 100;
  }
  const assumptions = ['Rates are converted to the rate of each payment period.', 'The last installment absorbs the rounding residue.', 'The effective cost is the IRR of the cash flow with every charge.'];
  if (input.rate.type === 'flat') assumptions.push('A flat rate charges interest on the original amount every period: its effective rate is higher than the number looks.');
  if (adjust?.cancelAt) assumptions.push('Early cancellation assumes the lender charges no more than the penalty you entered.');
  return { ...base, rows, totals, periodicRate: periodicRate(input.rate, ppy), effectiveRate, effectiveCost, cancel: run.cancel, assumptions };
}

// ----- comparisons

export interface GridCell {
  amount: number;
  termMonths: number;
  installment: number;
  totalCost: number;
  totalPayable: number;
}

// Every amount x term combination for the same rate and costs (percent costs follow the amount)
export function compareGrid(input: LoanInput, amounts: readonly number[], terms: readonly number[]): GridCell[][] {
  return amounts.map((amount) =>
    terms.map((termMonths) => {
      const q = quoteLoan({ ...input, amount, termMonths, periods: undefined });
      return { amount, termMonths, installment: q.totals.installment, totalCost: q.totals.totalCost, totalPayable: q.totals.totalPayable };
    })
  );
}

export interface Offer {
  name: string;
  input: LoanInput;
}

export interface OfferResult {
  name: string;
  quote: LoanQuote;
  best: boolean; // lowest total cost among the valid offers (a reading, not a recommendation)
}

export function compareOffers(offers: readonly Offer[]): OfferResult[] {
  const quotes = offers.map((o) => ({ name: o.name, quote: quoteLoan(o.input) }));
  const valid = quotes.filter((q) => !q.quote.error);
  const lowest = valid.length ? Math.min(...valid.map((q) => q.quote.totals.totalCost)) : null;
  return quotes.map((q) => ({ ...q, best: !q.quote.error && lowest !== null && q.quote.totals.totalCost === lowest }));
}

// ----- what-if on a loan (all of them rerun the engine)

export interface Savings {
  interestSaved: number;
  periodsSaved: number;
  newEndDate: string | null;
  newInstallment: number;
}

export function savingsOf(base: LoanQuote, scenario: LoanQuote): Savings {
  return {
    interestSaved: round2(base.totals.interest - scenario.totals.interest),
    periodsSaved: base.rows.length - scenario.rows.length,
    newEndDate: scenario.rows.length ? scenario.rows[scenario.rows.length - 1].date : null,
    newInstallment: scenario.rows[0]?.payment ?? 0,
  };
}

export interface CancellationResult {
  period: number;
  balance: number;
  penalty: number;
  payoff: number; // what it takes to close the loan after that installment
  paidUntil: number; // installments paid until then
  savedVsEnd: number; // what the rest of the installments would have cost, minus the payoff
}

export function cancelEarly(input: LoanInput, period: number, penaltyPercent = 0): CancellationResult | LoanError {
  const base = quoteLoan(input);
  if (base.error) return base.error;
  if (!Number.isInteger(period) || period < 1 || !Number.isFinite(penaltyPercent) || penaltyPercent < 0 || penaltyPercent > 100) return 'term';
  const run = quoteLoan(input, { cancelAt: { period, penaltyPercent } });
  if (run.error || !run.cancel) return run.error ?? 'term';
  const k = Math.min(period, base.rows.length);
  const rest = sumMoney(base.rows.slice(k).map((r) => r.payment));
  return {
    period: run.cancel.period,
    balance: run.cancel.balance,
    penalty: run.cancel.penalty,
    payoff: run.cancel.payoff,
    paidUntil: sumMoney(base.rows.slice(0, k).map((r) => r.payment)),
    savedVsEnd: round2(rest - run.cancel.payoff),
  };
}
