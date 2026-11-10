import { TransactionModel } from '../models/transaction.model';

// The account the user usually pays a card from: the one behind most past payments to that card; when the card has none yet,
// the one behind most card payments of any card. `candidates` are the accounts that can pay (in order); the first is the
// fallback. Pure.
export function usualPayer(transactions: readonly Pick<TransactionModel, 'type' | 'origin' | 'accountId' | 'toAccountId' | 'status'>[], cardId: string, candidates: readonly string[]): string {
  const payments = transactions.filter((t) => t.type === 'transfer' && t.origin === 'card-payment' && t.status !== 'reversed');
  const pick = (list: typeof payments): string | undefined => {
    const uses = new Map<string, number>();
    for (const t of list) if (candidates.includes(t.accountId)) uses.set(t.accountId, (uses.get(t.accountId) ?? 0) + 1);
    let best: string | undefined;
    for (const id of candidates) if ((uses.get(id) ?? 0) > (best ? uses.get(best)! : 0)) best = id; // earlier candidate wins a tie
    return best;
  };
  return pick(payments.filter((t) => t.toAccountId === cardId)) ?? pick(payments) ?? candidates[0] ?? '';
}
