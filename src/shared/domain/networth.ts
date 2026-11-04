// "Liquid net worth" and "net worth". RD$ and US$ are never added together.
import { AccountType } from '../models/account.model';
import { TransactionCurrency } from '../models/transaction.model';
import { addMoney, subMoney } from '../utils/money';
import { Balances, LedgerAccount, LedgerTx, balances } from './ledger';

export interface NetWorthAccount extends LedgerAccount {
  type: AccountType;
  cardKind?: 'credit' | 'debit';
}

export type PerCurrency = Record<TransactionCurrency, number>;

export interface NetWorthRow {
  accountId: string;
  balance: PerCurrency;
  liquid: boolean; // counts in liquid net worth
  debt: boolean; // credit card: its negative balance is debt
}

export interface NetWorth {
  liquid: PerCurrency; // sum of liquid accounts
  cardDebt: PerCurrency; // positive number: what is owed on credit cards
  net: PerCurrency; // liquid - card debt (loans join in prompt 08)
  rows: NetWorthRow[]; // what adds and what does not
}

// Default for accounts created before the flag existed
export function defaultLiquid(type: AccountType): boolean {
  return type === 'cash' || type === 'bank' || type === 'savings';
}

export const isLiquid = (a: NetWorthAccount): boolean => a.liquid ?? defaultLiquid(a.type);
export const isCreditCard = (a: NetWorthAccount): boolean => a.type === 'card' && a.cardKind === 'credit';

export function netWorth(accounts: readonly NetWorthAccount[], txs: readonly LedgerTx[]): NetWorth {
  const active = accounts.filter((a) => !a.archived);
  const per: Record<TransactionCurrency, Balances> = {
    DOP: balances(accounts, txs, 'DOP'),
    USD: balances(accounts, txs, 'USD'),
  };
  const liquid: PerCurrency = { DOP: 0, USD: 0 };
  const cardDebt: PerCurrency = { DOP: 0, USD: 0 };
  const rows: NetWorthRow[] = [];

  for (const a of active) {
    const balance: PerCurrency = { DOP: per.DOP.byAccount.get(a.id) ?? 0, USD: per.USD.byAccount.get(a.id) ?? 0 };
    const counts = isLiquid(a);
    const debt = isCreditCard(a);
    for (const c of ['DOP', 'USD'] as const) {
      if (counts) liquid[c] = addMoney(liquid[c], balance[c]);
      if (debt && balance[c] < 0) cardDebt[c] = addMoney(cardDebt[c], -balance[c]);
    }
    rows.push({ accountId: a.id, balance, liquid: counts, debt });
  }
  return {
    liquid,
    cardDebt,
    net: { DOP: subMoney(liquid.DOP, cardDebt.DOP), USD: subMoney(liquid.USD, cardDebt.USD) },
    rows,
  };
}
