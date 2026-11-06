// A draft made before its account existed (the bank email that named card ····4237 arrived before the card was
// added) waits with "choose the account". When the account appears, this finds it again with the same rule as
// the first reading (digits named in the notice must match; a bank name alone never picks another card): exactly one
// account matches, else nothing. It only fills an EMPTY account: whatever the
// user chose is never touched. Pure.
import { AccountModel } from '../../models/account.model';
import { CaptureDraft } from '../../models/capture-draft.model';
import { resolveAccount } from './resolve';

const WAITING: readonly CaptureDraft['status'][] = ['pending', 'duplicate'];
// kinds that name no account of their own
const NO_ACCOUNT: readonly CaptureDraft['kind'][] = ['account_setup', 'goal_contribution'];

export function rematchAccount(d: CaptureDraft, accounts: readonly AccountModel[], bankNameOf: (a: AccountModel) => string): Partial<CaptureDraft> | null {
  if (!WAITING.includes(d.status) || NO_ACCOUNT.includes(d.kind)) return null;
  if (d.resolvedAccountId) return null; // already settled (by the reader or by the user)
  if (d.kind === 'card_payment' && d.resolvedToAccountId) return null;
  if (!d.accountLast4 && !d.bankName) return null; // nothing to match on: never a guess
  const found = resolveAccount(accounts, d.accountLast4, d.currency, d.bankName, bankNameOf);
  if (found.status !== 'resolved') return null;
  const account = accounts.find((a) => a.id === found.accountId);
  // a card payment that names only the card: that account is the card being paid, as when the draft was first built
  if (d.kind === 'card_payment' && account?.type === 'card' && account.cardKind === 'credit') return { resolvedToAccountId: found.accountId };
  return { resolvedAccountId: found.accountId };
}
