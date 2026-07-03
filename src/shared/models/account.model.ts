export type AccountType = 'cash' | 'bank' | 'card' | 'savings';

export interface AccountModel {
  id: string;
  name: string;
  icon: string; // emoji, used for cash accounts and as legacy fallback
  type: AccountType;
  bankId?: string; // bank from the catalog (bank/card/savings accounts)
  last4?: string; // last 4 digits, cards only
  initialBalance: number;
}
