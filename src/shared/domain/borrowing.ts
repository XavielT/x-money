// Payment capacity (2.14.0), pure. Income comes in four levels the user can switch on or off, and
// is read three ways at once. NON-MONETARY BENEFITS NEVER ENTER ANY LEVEL (integrity rule 4): this
// file does not even take them as an input. Every figure is an estimate (rule 10) and the
// thresholds are a personal REFERENCE, not a bank's rule.
import { IncomeSourceModel, isCommercialKind } from '../models/income-source.model';
import { LoanSettings } from '../models/loan.model';
import { TransactionModel } from '../models/transaction.model';
import { addMoney, round2, sumMoney } from '../utils/money';
import { averages, occurrencesPerMonth } from './income';

export interface IncomeTiers {
  salary: number; // 1: documented payroll, expected net x payments per month
  bonuses: number; // 2: recurring and documented bonuses / commissions
  commercial: number; // 3: net benefit of the business, monthly average of the last 6 months (before the prudence discount)
  declared: number; // 4: everything else the user declares (variable, or not documented)
}

export type TierKey = keyof IncomeTiers;
export const TIER_KEYS: readonly TierKey[] = ['salary', 'bonuses', 'commercial', 'declared'];

// Monthly figure of a personal income source: what it is expected to bring, else its average
function monthlyOf(s: IncomeSourceModel, txs: readonly TransactionModel[], today: string): number {
  if (s.expectedNet && s.expectedNet > 0 && s.schedule) return round2(s.expectedNet * occurrencesPerMonth(s.schedule));
  return averages(txs.filter((t) => t.incomeSourceId === s.id), today).monthly;
}

export function incomeTiers(sources: readonly IncomeSourceModel[], txs: readonly TransactionModel[], today: string, commercialMonthly: number): IncomeTiers {
  const t: IncomeTiers = { salary: 0, bonuses: 0, commercial: Math.max(0, round2(commercialMonthly)), declared: 0 };
  for (const s of sources) {
    if (!s.active || (s.currency ?? 'DOP') !== 'DOP' || isCommercialKind(s.kind)) continue;
    const documentedRecurring = s.stability === 'recurring' && s.verifiability === 'documented' && !!s.expectedNet && !!s.schedule;
    if (documentedRecurring && s.kind === 'payroll') t.salary = addMoney(t.salary, monthlyOf(s, txs, today));
    else if (documentedRecurring && s.kind === 'bonus-commission') t.bonuses = addMoney(t.bonuses, monthlyOf(s, txs, today));
    else t.declared = addMoney(t.declared, monthlyOf(s, txs, today));
  }
  return t;
}

export type ReadingKey = 'conservative' | 'with-commercial' | 'all-declared';
export const READING_KEYS: readonly ReadingKey[] = ['conservative', 'with-commercial', 'all-declared'];

// Levels that each reading may use (before the user's switches)
const LEVELS: Record<ReadingKey, readonly TierKey[]> = {
  conservative: ['salary', 'bonuses'],
  'with-commercial': ['salary', 'bonuses', 'commercial'],
  'all-declared': ['salary', 'bonuses', 'commercial', 'declared'],
};

export interface Reading {
  key: ReadingKey;
  income: number;
  parts: { tier: TierKey; amount: number; discount: number }[]; // what was used, so the screen can show it
}

export function readings(tiers: IncomeTiers, settings: Pick<LoanSettings, 'switches' | 'commercialDiscount'>): Reading[] {
  const discount = Math.min(100, Math.max(0, settings.commercialDiscount));
  return READING_KEYS.map((key) => {
    const parts = LEVELS[key]
      .filter((tier) => settings.switches[tier])
      .map((tier) => {
        const raw = tiers[tier];
        const cut = tier === 'commercial' ? round2((raw * discount) / 100) : 0;
        return { tier, amount: round2(raw - cut), discount: cut };
      });
    return { key, income: sumMoney(parts.map((p) => p.amount)), parts };
  });
}

export interface Obligations {
  fixed: number;
  variable: number; // median of the variable spending (or the declared figure when there is little history)
  debts: number; // minimum payments of cards + installments of registered loans
  variableBasis: 'history' | 'declared';
}

export type CapacityStatus = 'comfortable' | 'tight' | 'risky' | 'no-income';

export interface CapacityRow {
  key: ReadingKey;
  income: number;
  committed: number | null; // percent of the income that fixed + debts + the installment take
  availableAfter: number; // income - fixed - variable - debts - installment
  status: CapacityStatus;
}

export interface CapacityResult {
  rows: CapacityRow[];
  obligations: Obligations;
  installment: number;
  readings: Reading[];
  estimate: true;
}

export function statusOf(committed: number | null, availableAfter: number, comfortable: number, tight: number): CapacityStatus {
  if (committed === null) return 'no-income';
  if (availableAfter < 0 || committed > tight) return 'risky';
  return committed > comfortable ? 'tight' : 'comfortable';
}

export function evaluateCapacity(tiers: IncomeTiers, settings: LoanSettings, obligations: Obligations, installment: number, incomeDropPercent = 0): CapacityResult {
  const base = readings(tiers, settings);
  const factor = 1 - Math.min(100, Math.max(0, incomeDropPercent)) / 100;
  const used = base.map((r) => ({ ...r, income: round2(r.income * factor) }));
  const rows = used.map<CapacityRow>((r) => {
    const fixedAndDebts = addMoney(addMoney(obligations.fixed, obligations.debts), installment);
    const committed = r.income > 0 ? round2((fixedAndDebts / r.income) * 100) : null;
    const availableAfter = round2(r.income - obligations.fixed - obligations.variable - obligations.debts - installment);
    return { key: r.key, income: r.income, committed, availableAfter, status: statusOf(committed, availableAfter, settings.comfortable, settings.tight) };
  });
  return { rows, obligations, installment, readings: used, estimate: true };
}

// The same evaluation with the income lowered by a percent, reading by reading
export const incomeDropImpact = (tiers: IncomeTiers, settings: LoanSettings, obligations: Obligations, installment: number, drops: readonly number[]): { drop: number; rows: CapacityRow[] }[] =>
  drops.map((drop) => ({ drop, rows: evaluateCapacity(tiers, settings, obligations, installment, drop).rows }));

// Monthly cost of an installment in another frequency (the committed percentage is monthly)
export const monthlyEquivalent = (installment: number, ppy: number): number => round2((installment * ppy) / 12);
