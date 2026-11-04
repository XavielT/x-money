export type AccountType = 'cash' | 'bank' | 'card' | 'savings' | 'other';
export type CardKind = 'credit' | 'debit';

// Subtype of a bank account, the way banks name them
export type BankAccountKind = 'checking' | 'savings' | 'payroll';

// DOP = Dominican peso (shown with the symbol chosen in Settings),
// USD = US dollar, dual = credit cards with both a RD$ and a US$ side
export type AccountCurrency = 'DOP' | 'USD' | 'dual';

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
}
