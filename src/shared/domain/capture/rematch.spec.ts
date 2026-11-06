// A draft made before its account existed finds it afterwards, only when exactly one account fits and
// only when no account was chosen yet.
import { describe, expect, it } from 'vitest';
import { account } from '../../testing/builders';
import { CaptureDraft } from '../../models/capture-draft.model';
import { rematchAccount } from './rematch';

const bankName = (a: { bankId?: string }) => (a.bankId === 'popular' ? 'Banco Popular' : '');
const debit = account({ id: 'd1', name: 'Debito Popular', type: 'card', cardKind: 'debit', bankId: 'popular', last4: '4237', initialBalance: 0 });
const credit = account({ id: 'c1', name: 'Visa', type: 'card', cardKind: 'credit', bankId: 'popular', last4: '7108', initialBalance: 0 });
const draft = (over: Partial<CaptureDraft>): CaptureDraft => ({ id: 'x', createdAt: '2026-11-06T12:00:00Z', source: 'email', status: 'pending', kind: 'expense', confidence: {}, doubts: ['account-missing'], amountMinor: 23913, currency: 'DOP', accountLast4: '4237', bankName: 'Banco Popular', ...over });

describe('rematchAccount', () => {
  it('finds the account by its last 4 digits once it exists', () => {
    expect(rematchAccount(draft({}), [debit], bankName)).toEqual({ resolvedAccountId: 'd1' });
  });

  it('digits that match no account are never replaced by another card of the same bank', () => {
    expect(rematchAccount(draft({}), [credit], bankName)).toBeNull(); // the Visa ····7108 is Popular too, but it is not ····4237
  });

  it('without digits the bank name is enough, when exactly one account fits', () => {
    expect(rematchAccount(draft({ accountLast4: undefined }), [credit], bankName)).toEqual({ resolvedAccountId: 'c1' });
    expect(rematchAccount(draft({ accountLast4: undefined }), [credit, debit], bankName)).toBeNull(); // two Popular accounts: the user chooses
  });

  it('does nothing while the account still does not exist', () => {
    expect(rematchAccount(draft({}), [credit], bankName)).toBeNull();
  });

  it('never touches an account that is already set, by the reader or by the user', () => {
    expect(rematchAccount(draft({ resolvedAccountId: 'c1' }), [debit, credit], bankName)).toBeNull();
  });

  it('never guesses: two accounts with the same digits stay for the user to choose', () => {
    const twin = account({ id: 'd2', name: 'Otro', type: 'card', cardKind: 'debit', bankId: 'popular', last4: '4237', initialBalance: 0 });
    expect(rematchAccount(draft({}), [debit, twin], bankName)).toBeNull();
  });

  it('needs something to match on: no digits and no bank means nothing', () => {
    expect(rematchAccount(draft({ accountLast4: undefined, bankName: undefined }), [debit], bankName)).toBeNull();
  });

  it('respects the currency of the draft', () => {
    const usd = account({ id: 'u1', name: 'USD', type: 'card', cardKind: 'debit', bankId: 'popular', last4: '4237', currency: 'USD', initialBalance: 0 });
    expect(rematchAccount(draft({}), [usd], bankName)).toBeNull();
  });

  it('only waiting drafts: an approved, rejected or account-less kind is left alone', () => {
    for (const over of [{ status: 'approved' as const }, { status: 'rejected' as const }, { kind: 'goal_contribution' as const }, { kind: 'account_setup' as const }]) {
      expect(rematchAccount(draft(over), [debit], bankName)).toBeNull();
    }
  });

  it('a card payment that names only the credit card puts it as the card being paid', () => {
    expect(rematchAccount(draft({ kind: 'card_payment', accountLast4: '7108' }), [credit], bankName)).toEqual({ resolvedToAccountId: 'c1' });
  });
});
