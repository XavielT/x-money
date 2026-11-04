// Rule 3: paying the card is not a second expense. The Pay card screen records it correctly;
// this finds the ones that were typed as a plain expense (a "Bills" payment from the bank,
// say) so the user can confirm them and the purchases are not counted twice.
import { AccountModel } from '../models/account.model';
import { CardStatementModel } from '../models/card-statement.model';
import { TransactionModel } from '../models/transaction.model';
import { addDays } from './dates';
import { effectiveBalance, effectiveMinimum, isCreditCard, cardCurrencies, remainingOf } from './cards';
import { txCurrency } from './ledger';
import { moneyEquals } from '../utils/money';

export interface CardPaymentSuggestion {
  key: string; // stable: the dismissal memory uses it
  expenseId: string;
  cardId: string;
  statementId: string;
  amount: number;
  date: string;
}

// Days after the due date in which a matching expense is still read as that payment
const LATE_GRACE = 10;

export function detectCardPaymentExpenses(
  txs: readonly TransactionModel[],
  accounts: readonly AccountModel[],
  statements: readonly CardStatementModel[],
  paidAfter: (s: CardStatementModel) => number,
  dismissed: readonly string[] = []
): CardPaymentSuggestion[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const out: CardPaymentSuggestion[] = [];
  const taken = new Set<string>(); // one expense is offered once
  for (const s of statements) {
    const card = byId.get(s.accountId);
    if (!card || !isCreditCard(card) || !cardCurrencies(card).includes(s.currency)) continue;
    const remaining = remainingOf(s, paidAfter(s));
    if (remaining <= 0) continue;
    const targets = [effectiveBalance(s), effectiveMinimum(s), remaining].filter((n) => n > 0);
    const until = addDays(s.dueDate, LATE_GRACE);
    for (const t of txs) {
      if (t.type !== 'expense' || t.status === 'reversed' || t.reconciled || t.linkedId || t.origin === 'adjustment') continue;
      if (txCurrency(t) !== s.currency || t.date <= s.cutDate || t.date > until) continue;
      const from = byId.get(t.accountId);
      if (!from || from.archived || isCreditCard(from)) continue; // a card purchase is a purchase
      if (!targets.some((n) => moneyEquals(n, t.amount))) continue;
      const key = `cardpay:${t.id}`;
      if (taken.has(t.id) || dismissed.includes(key)) continue;
      taken.add(t.id);
      out.push({ key, expenseId: t.id, cardId: card.id, statementId: s.id, amount: t.amount, date: t.date });
    }
  }
  return out;
}
