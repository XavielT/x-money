// Balances are NEVER stored: they are always derived from the initial balance and the
// movements (integrity rule 9). Every function here is pure and rounds to cents after
// each step. RD$ and US$ are computed separately and never mixed.
import { TransactionCurrency, TransactionModel } from '../models/transaction.model';
import { addMoney, round2 } from '../utils/money';

export interface LedgerAccount {
  id: string;
  currency?: 'DOP' | 'USD' | 'dual';
  initialBalance: number;
  linkedAccountId?: string; // debit card -> the bank account its money comes from
  archived?: boolean;
  liquid?: boolean;
}

export type LedgerTx = Pick<
  TransactionModel,
  'type' | 'amount' | 'accountId' | 'toAccountId' | 'fee' | 'date' | 'currency'
>;

export const txCurrency = (t: { currency?: TransactionCurrency }): TransactionCurrency => t.currency ?? 'DOP';

// The currency a (single-currency or dual) account starts in: dual cards start in RD$
export const initialCurrency = (a: LedgerAccount): TransactionCurrency => (a.currency === 'USD' ? 'USD' : 'DOP');

// Movements made with a linked debit card belong to the bank account behind it
export function ownerId(accounts: readonly LedgerAccount[], accountId: string): string {
  const a = accounts.find((x) => x.id === accountId);
  return a?.linkedAccountId && accounts.some((x) => x.id === a.linkedAccountId) ? a.linkedAccountId : accountId;
}

export interface Balances {
  byAccount: Map<string, number>;
  // Net of movements that point to an account that no longer exists. It is kept (not
  // dropped) so legacy data keeps its old total; new data cannot create orphans because
  // accounts with movements are archived instead of deleted.
  orphan: number;
}

export function balances(
  accounts: readonly LedgerAccount[],
  txs: readonly LedgerTx[],
  currency: TransactionCurrency,
  asOf?: string
): Balances {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const owner = (id: string) => {
    const a = byId.get(id);
    return a?.linkedAccountId && byId.has(a.linkedAccountId) ? a.linkedAccountId : id;
  };
  const byAccount = new Map<string, number>();
  for (const a of accounts) byAccount.set(a.id, initialCurrency(a) === currency ? round2(a.initialBalance) : 0);
  let orphan = 0;
  const bump = (id: string, delta: number) => {
    if (byAccount.has(id)) byAccount.set(id, addMoney(byAccount.get(id)!, delta));
    else orphan = addMoney(orphan, delta);
  };

  for (const t of txs) {
    if (txCurrency(t) !== currency) continue;
    if (asOf !== undefined && t.date > asOf) continue;
    const from = owner(t.accountId);
    if (t.fee) bump(from, -t.fee); // the bank fee always leaves the source account
    if (t.type === 'transfer') {
      bump(from, -t.amount);
      if (t.toAccountId) bump(owner(t.toAccountId), t.amount);
    } else {
      bump(from, t.type === 'income' ? t.amount : -t.amount);
    }
  }
  return { byAccount, orphan };
}

export function accountBalance(
  accounts: readonly LedgerAccount[],
  txs: readonly LedgerTx[],
  accountId: string,
  currency: TransactionCurrency,
  asOf?: string
): number {
  return balances(accounts, txs, currency, asOf).byAccount.get(accountId) ?? 0;
}

// Balance of one account at the end of a given day
export const balanceAsOf = (
  accounts: readonly LedgerAccount[],
  txs: readonly LedgerTx[],
  accountId: string,
  currency: TransactionCurrency,
  date: string
): number => accountBalance(accounts, txs, accountId, currency, date);

// Sum of the balances of the active (not archived) accounts. Transfers net out because
// both legs are inside the sum; the orphan net keeps legacy totals unchanged.
export function totalBalance(
  accounts: readonly LedgerAccount[],
  txs: readonly LedgerTx[],
  currency: TransactionCurrency,
  options: { liquidOnly?: boolean; asOf?: string } = {}
): number {
  return totalFrom(balances(accounts, txs, currency, options.asOf), accounts, options.liquidOnly ?? false);
}

export function totalFrom(b: Balances, accounts: readonly LedgerAccount[], liquidOnly = false): number {
  let total = liquidOnly ? 0 : b.orphan;
  for (const a of accounts) {
    if (a.archived) continue;
    if (liquidOnly && a.liquid === false) continue;
    total = addMoney(total, b.byAccount.get(a.id) ?? 0);
  }
  return total;
}

// Movements whose source or destination account is gone (legacy data only)
export function orphanTransactions<T extends Pick<TransactionModel, 'accountId' | 'toAccountId'>>(
  accounts: readonly LedgerAccount[],
  txs: readonly T[]
): T[] {
  const ids = new Set(accounts.map((a) => a.id));
  return txs.filter((t) => !ids.has(t.accountId) || (t.toAccountId !== undefined && !ids.has(t.toAccountId)));
}
