// Checking the balance a bank app shows against the one this app calculates from the user's movements. Pure.
// The app never writes a balance: balances come from movements (rule 9). A difference is shown, explained as far as the
// captures still waiting in the tray can explain it, and only an audited adjustment the user approves closes it.
import { AccountModel } from '../../models/account.model';
import { CaptureDraft } from '../../models/capture-draft.model';
import { TransactionCurrency } from '../../models/transaction.model';
import { addMoney, round2 } from '../../utils/money';
import { majorOf } from './amount';

// The bank's figure in the app's own terms: a credit card shows what is OWED, the app holds it as a negative balance
export function bankBalanceOf(d: Pick<CaptureDraft, 'balanceMinor' | 'accountType'>, account: Pick<AccountModel, 'type' | 'cardKind'> | undefined): number | null {
  if (d.balanceMinor === undefined) return null;
  const owed = d.accountType === 'credit_card' || (account?.type === 'card' && account.cardKind === 'credit');
  const v = majorOf(d.balanceMinor);
  return owed ? -v : v;
}

// What approving the drafts still waiting for this account would do to its balance (major units): the part of a difference that
// is only "not registered yet". Everything it cannot be sure of (no direction, no amount, another currency) counts as nothing.
export function pendingEffect(drafts: readonly CaptureDraft[], accountId: string, currency: TransactionCurrency): number {
  let total = 0;
  for (const d of drafts) {
    if (d.status !== 'pending' || d.kind === 'balance_check' || d.kind === 'account_setup' || !d.amountMinor || (d.currency ?? 'DOP') !== currency) continue;
    const amount = majorOf(d.amountMinor);
    const fee = d.bankFeeMinor ? majorOf(d.bankFeeMinor) : 0;
    const from = d.resolvedAccountId === accountId;
    const to = d.resolvedToAccountId === accountId;
    switch (d.kind) {
      case 'expense':
      case 'invoice_purchase':
      case 'loan_payment':
        if (from) total = addMoney(total, -(amount + fee));
        break;
      case 'income':
        if (from) total = addMoney(total, amount);
        break;
      case 'internal_transfer':
      case 'card_payment':
        if (from) total = addMoney(total, -(amount + fee));
        if (to) total = addMoney(total, amount);
        break;
      default:
        break;
    }
  }
  return round2(total);
}
