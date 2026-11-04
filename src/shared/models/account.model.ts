export type AccountType = 'cash' | 'bank' | 'card' | 'savings' | 'other';
export type CardKind = 'credit' | 'debit';

// Subtype of a bank account, the way banks name them
export type BankAccountKind = 'checking' | 'savings' | 'payroll';

// DOP = Dominican peso (shown with the symbol chosen in Settings),
// USD = US dollar, dual = credit cards with both a RD$ and a US$ side
export type AccountCurrency = 'DOP' | 'USD' | 'dual';

// Credit card data (2.8.0). Everything is optional: cards created before 2.8.0 simply have
// none of it until the user completes it, and nothing is guessed on their behalf.
export interface CardConfig {
  creditLimit?: number; // RD$ side
  creditLimitUsd?: number; // US$ side (USD and dual cards)
  cutDay?: number; // 1-31; short months use their last day
  dueMode?: 'days-after' | 'fixed-day'; // payment deadline: N days after the cut, or a fixed day of the month
  dueDays?: number;
  dueDay?: number;
  minPercent?: number; // minimum payment: % of the balance...
  minFloor?: number; // ...but never below this amount (RD$ side; capped by the balance)
  minFloorUsd?: number;
  // A purchase made ON the cut day goes into the statement that closes ('closing', the
  // default) or into the next one ('next')
  cutDayPurchases?: 'closing' | 'next';
  warnAt?: number; // utilization thresholds in %, editable ("usual reference": 30 / 90)
  dangerAt?: number;
  smallPurchaseMax?: number; // "small purchase" ceiling; empty = the usual relative rule
}

export interface AccountModel {
  id: string;
  name: string;
  icon: string; // emoji, used for cash accounts and as legacy fallback
  type: AccountType;
  cardKind?: CardKind; // cards only
  bankKind?: BankAccountKind; // bank accounts only: checking / savings / payroll
  bankId?: string; // bank from the catalog (bank/card/savings accounts)
  last4?: string; // last 4 digits, cards only
  currency?: AccountCurrency; // default DOP
  linkedAccountId?: string; // debit cards: the bank account money comes from
  initialBalance: number;
  liquid?: boolean; // counts in "liquid net worth" (schema v2: set explicitly by type)
  archived?: boolean; // hidden from selectors and totals, history kept
  reconciledAt?: string; // ISO date of the last reconciliation
  card?: CardConfig; // credit cards only
}
