// Non-monetary benefits (rule 4): fuel card, health insurance, company-paid subscriptions...
// Pure and deliberately isolated: nothing here knows about accounts, income, net worth or
// movements, and nothing it returns is money you have. Every figure is an estimate.
import { BenefitModel } from '../models/benefit.model';
import { addMoney, round2, subMoney, sumMoney } from '../utils/money';

export const BENEFIT_ESTIMATE_LABEL = 'Estimate · not available money';

export const monthPrefix = (year: number, month: number): string => `${year}-${String(month).padStart(2, '0')}`;

// In force on a date: active, inside its validity dates (open ends allowed)
export function inForce(b: BenefitModel, date: string): boolean {
  return b.active && (!b.validFrom || b.validFrom <= date) && (!b.validTo || b.validTo >= date);
}

// Was it in force at any moment of the month?
export function inForceInMonth(b: BenefitModel, year: number, month: number): boolean {
  const prefix = monthPrefix(year, month);
  return b.active && (!b.validFrom || b.validFrom.slice(0, 7) <= prefix) && (!b.validTo || b.validTo.slice(0, 7) >= prefix);
}

export function usedInMonth(b: BenefitModel, year: number, month: number): number {
  const prefix = monthPrefix(year, month);
  return sumMoney(b.uses.filter((u) => u.date.startsWith(prefix)).map((u) => u.amount));
}

export interface MonthUsage {
  used: number;
  limit?: number;
  percentOfLimit: number | null; // null without a limit
  remaining?: number; // limit - used (never below zero)
  overLimit: boolean;
}

export function monthUsage(b: BenefitModel, year: number, month: number): MonthUsage {
  const used = usedInMonth(b, year, month);
  const limit = b.monthlyLimit !== undefined && b.monthlyLimit > 0 ? round2(b.monthlyLimit) : undefined;
  return {
    used,
    limit,
    percentOfLimit: limit === undefined ? null : Math.round((used / limit) * 1000) / 10,
    remaining: limit === undefined ? undefined : Math.max(0, subMoney(limit, used)),
    overLimit: limit !== undefined && used > limit,
  };
}

// Estimated saving of a month: what was really used when there are records, otherwise the
// estimated monthly value. Zero when the benefit was not in force.
export function monthlySaving(b: BenefitModel, year: number, month: number): number {
  if (!inForceInMonth(b, year, month)) return 0;
  const used = usedInMonth(b, year, month);
  return used > 0 ? used : round2(b.monthlyValue);
}

export function totalMonthlySaving(benefits: readonly BenefitModel[], year: number, month: number): number {
  return benefits.reduce((sum, b) => addMoney(sum, monthlySaving(b, year, month)), 0);
}

// January to the given month of the year (the running year so far)
export function yearToDateSaving(benefits: readonly BenefitModel[], year: number, upToMonth: number): number {
  let total = 0;
  for (let m = 1; m <= upToMonth; m++) total = addMoney(total, totalMonthlySaving(benefits, year, m));
  return total;
}

export function validBenefit(b: Pick<BenefitModel, 'name' | 'monthlyValue' | 'monthlyLimit' | 'validFrom' | 'validTo'>): boolean {
  if (!b.name.trim() || !Number.isFinite(b.monthlyValue) || b.monthlyValue < 0) return false;
  if (b.monthlyLimit !== undefined && (!Number.isFinite(b.monthlyLimit) || b.monthlyLimit < 0)) return false;
  if (b.validFrom && b.validTo && b.validTo < b.validFrom) return false;
  return true;
}
