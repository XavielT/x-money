// Non-monetary work benefits (2.9.0): fuel card, health insurance, company-paid
// subscriptions... They are NOT money: they never touch an account, income, net worth or
// the payment capacity (integrity rule 4). Money that reaches an account is an income source.

export type BenefitKind = 'fuel-card' | 'health-insurance' | 'subscriptions' | 'meals' | 'transport' | 'in-kind-bonus' | 'other';

export interface BenefitUse {
  id: string;
  date: string; // ISO yyyy-MM-dd
  amount: number;
  note?: string;
}

export interface BenefitModel {
  id: string;
  name: string;
  kind: BenefitKind;
  provider?: string; // free text (the employer, usually)
  incomeSourceId?: string; // optional link to the payroll source
  monthlyValue: number; // estimated value per month
  monthlyLimit?: number; // use limit per month, when it has one
  validFrom?: string;
  validTo?: string;
  active: boolean;
  notes?: string;
  uses: BenefitUse[]; // what the user noted; never creates a movement
}
