import { describe, expect, it } from 'vitest';
import { transaction } from '../testing/builders';
import { usualPayer } from './usual-payer';

const pay = (from: string, card: string, extra: Parameters<typeof transaction>[0] = {}) => transaction({ type: 'transfer', origin: 'card-payment', accountId: from, toAccountId: card, ...extra });

describe('usualPayer', () => {
  it('no payments ever: the first account that can pay', () => {
    expect(usualPayer([], 'card1', ['a', 'b'])).toBe('a');
  });

  it('nobody can pay: empty, never a made-up id', () => {
    expect(usualPayer([pay('a', 'card1')], 'card1', [])).toBe('');
  });

  it('the account behind most payments to this card', () => {
    const txs = [pay('a', 'card1'), pay('b', 'card1'), pay('b', 'card1')];
    expect(usualPayer(txs, 'card1', ['a', 'b'])).toBe('b');
  });

  it('a card with no payments yet uses the account behind most payments of any card', () => {
    const txs = [pay('b', 'card2'), pay('b', 'card2'), pay('a', 'card3')];
    expect(usualPayer(txs, 'card1', ['a', 'b'])).toBe('b');
  });

  it('this card wins over the general habit', () => {
    const txs = [pay('b', 'card2'), pay('b', 'card2'), pay('b', 'card2'), pay('a', 'card1')];
    expect(usualPayer(txs, 'card1', ['a', 'b'])).toBe('a');
  });

  it('a tie goes to the earlier candidate; an account that can no longer pay is skipped', () => {
    expect(usualPayer([pay('a', 'card1'), pay('b', 'card1')], 'card1', ['b', 'a'])).toBe('b');
    expect(usualPayer([pay('gone', 'card1'), pay('gone', 'card1'), pay('a', 'card1')], 'card1', ['a', 'b'])).toBe('a');
  });

  it('reversed payments and plain transfers do not count', () => {
    const txs = [pay('b', 'card1', { status: 'reversed' }), pay('b', 'card1', { status: 'reversed' }), transaction({ type: 'transfer', accountId: 'b', toAccountId: 'card1' }), pay('a', 'card1')];
    expect(usualPayer(txs, 'card1', ['a', 'b'])).toBe('a');
  });
});
