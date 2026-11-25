import { account, transaction } from '../testing/builders';
import { accountsToMatch } from './match-due';

const now = new Date('2026-11-25T12:00:00');
const withMove = (id: string) => transaction({ accountId: id, amount: 10, date: '2026-11-01' });

describe('which accounts are due to be matched with the bank', () => {
  it('an account matched 30 days ago or more is due, a recent one is not', () => {
    const old = account({ id: 'a', type: 'bank', reconciledAt: '2026-10-25' });
    const recent = account({ id: 'b', type: 'bank', reconciledAt: '2026-11-10' });
    const due = accountsToMatch([old, recent], [withMove('a'), withMove('b')], now);
    expect(due.map((d) => [d.account.id, d.days])).toEqual([['a', 31]]);
  });

  it('never matched comes first, then the longest ago', () => {
    const a = account({ id: 'a', type: 'bank', reconciledAt: '2026-09-01' });
    const b = account({ id: 'b', type: 'savings' });
    const c = account({ id: 'c', type: 'card', cardKind: 'credit', reconciledAt: '2026-10-01' });
    expect(accountsToMatch([a, c, b], [withMove('a'), withMove('b'), withMove('c')], now).map((d) => d.account.id)).toEqual(['b', 'a', 'c']);
  });

  it('cash, debit cards, archived accounts and accounts without movements are never due', () => {
    const accounts = [
      account({ id: 'cash', type: 'cash' }),
      account({ id: 'debit', type: 'card', cardKind: 'debit' }),
      account({ id: 'old', type: 'bank', archived: true }),
      account({ id: 'empty', type: 'bank' }),
    ];
    expect(accountsToMatch(accounts, [withMove('cash'), withMove('debit'), withMove('old')], now)).toEqual([]);
  });

  it('a reversed movement does not count as a movement; a transfer counts for both ends', () => {
    const a = account({ id: 'a', type: 'bank' });
    const b = account({ id: 'b', type: 'bank' });
    expect(accountsToMatch([a], [transaction({ accountId: 'a', status: 'reversed' })], now)).toEqual([]);
    expect(accountsToMatch([b], [transaction({ type: 'transfer', accountId: 'a', toAccountId: 'b', amount: 5 })], now).map((d) => d.account.id)).toEqual(['b']);
  });
});
