// Registered loans (2.14.0). The disbursement and every payment are real movements (the payment
// is split in principal, which is NOT an expense, and interest and charges, which are). What is
// still owed is never stored: it is the debt at the start minus the principal paid.
import { AmortMethod, LoanCosts, PayFrequency, RateSpec, ScheduleRow } from '../domain/loans';

export type LoanStatus = 'active' | 'paid' | 'voided';
export type LoanPaymentKind = 'regular' | 'partial' | 'advance' | 'extra';

export interface LoanPayment {
  id: string;
  date: string;
  installment: number | null; // the installment it pays (null for an extra payment to principal)
  kind: LoanPaymentKind;
  amount: number; // cash that left the account
  principal: number;
  interest: number;
  fees: number;
  linkedId: string; // the movements of this payment are one atomic unit
  note?: string;
  reversed?: boolean; // reversed payments stay in the history and count for nothing
  scheduleBefore?: ScheduleRow[]; // extra payments: the schedule to restore if it is reversed
}

export interface LoanModel {
  id: string;
  name: string;
  lender?: string;
  amount: number; // what the lender handed over
  debt: number; // what is owed at the start: the amount plus a financed commission
  rate: RateSpec;
  method: AmortMethod;
  termMonths: number;
  frequency: PayFrequency;
  periods: number;
  firstDate: string;
  costs?: LoanCosts;
  disbursementDate: string;
  disbursementAccountId: string;
  payAccountId: string; // the account the installments usually leave from
  disbursementLinkedId: string;
  schedule: ScheduleRow[]; // the current schedule (it is recomputed only by an extra payment)
  payments: LoanPayment[];
  status: LoanStatus;
  createdAt: string;
}

// A saved simulation or bank offer that can be named and reopened (not a loan: nothing is owed)
export interface LoanSimulationModel {
  id: string;
  name: string;
  amount: number;
  rate: RateSpec;
  method: AmortMethod;
  termMonths: number;
  frequency: PayFrequency;
  costs?: LoanCosts;
  createdAt: string;
}

export interface LoanSettings {
  switches: { salary: boolean; bonuses: boolean; commercial: boolean; declared: boolean }; // which income levels count
  commercialDiscount: number; // percent taken off the commercial average, for prudence
  comfortable: number; // reference: committed percent up to here is comfortable
  tight: number; // reference: up to here is tight, above is risky
  declaredVariable: number; // variable spending to assume when there are fewer than 3 months of history
}

export const DEFAULT_LOAN_SETTINGS: LoanSettings = {
  switches: { salary: true, bonuses: true, commercial: true, declared: true },
  commercialDiscount: 20,
  comfortable: 35,
  tight: 50,
  declaredVariable: 0,
};
