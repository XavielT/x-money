// Where income comes from (2.9.0). A source describes how a stream of income behaves; the
// movements stay in `transactions` and point to it with `incomeSourceId`.

export type IncomeKind =
  | 'payroll' // salary
  | 'bonus-commission'
  | 'freelance'
  | 'commercial-sales' // business sales: gross, never profit (rule 5)
  | 'vehicle-trade'
  | 'parts-accessories'
  | 'extraordinary'
  | 'custom'; // the user names the type

// Kinds that are business sales: their amount is revenue, the benefit is price - cost - expenses
export const COMMERCIAL_KINDS: readonly IncomeKind[] = ['commercial-sales', 'vehicle-trade', 'parts-accessories'];
export const isCommercialKind = (k: IncomeKind): boolean => COMMERCIAL_KINDS.includes(k);

// recurring = same thing on a schedule, variable = comes and goes, occasional = once in a while
export type IncomeStability = 'recurring' | 'variable' | 'occasional';

// documented = verifiable (payroll stub, certificate); declared = the user says so
export type IncomeVerifiability = 'documented' | 'declared';

export type IncomeMethod = 'cash' | 'transfer';

// When it is expected. Presets (weekly, every two weeks, monthly) are just schedules.
export type IncomeSchedule =
  | { mode: 'weekly'; weekday: number } // 0 = Sunday ... 6 = Saturday
  | { mode: 'month-days'; days: number[] } // fixed days of the month, e.g. [15, 30]; short months use their last day
  | { mode: 'every'; n: number; unit: 'days' | 'weeks' | 'months'; anchor: string }; // from an ISO date

export interface IncomeSourceModel {
  id: string;
  name: string;
  kind: IncomeKind;
  customKind?: string; // name of the type when kind is 'custom'
  icon: string; // emoji
  color: string;
  active: boolean;
  stability: IncomeStability;
  schedule?: IncomeSchedule; // absent = no expectations are generated
  method: IncomeMethod;
  defaultAccountId?: string;
  verifiability: IncomeVerifiability;
  expectedGross?: number;
  expectedNet?: number; // what should reach the account each time
  skippedDates?: string[]; // expected dates the user said did not happen
  currency?: 'DOP' | 'USD'; // default DOP; figures and averages are RD$ only for now
  createdAt: string;
}

export interface Deduction {
  name: string;
  amount: number;
}
