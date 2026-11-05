// A credit card does not have a "negative balance" in real life: it has a debt. Home and Accounts say "Owed X"
// for it; the stored balance (minus what is owed) and every calculation stay as they are.
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { MemoryStorage, boot } from '../../../shared/testing/memory-storage';
import { account } from '../../../shared/testing/builders';
import { HomeComponent } from './home';

const card = account({ id: 'c1', name: 'Visa', type: 'card', cardKind: 'credit', initialBalance: -2019.43 });
const overdrawn = account({ id: 'k1', name: 'Corriente', type: 'bank', initialBalance: -50 });
const fine = account({ id: 's1', name: 'Ahorro', type: 'savings', initialBalance: 100 });
const cardInFavor = account({ id: 'c2', name: 'Mastercard', type: 'card', cardKind: 'credit', initialBalance: 40 });

describe('a card shows what it owes', () => {
  it('only a credit card with a debt is shown as owed; an overdrawn account keeps its minus sign', () => {
    boot(new MemoryStorage().seed({ accounts: [card, overdrawn, fine, cardInFavor], transactions: [] }));
    const home = TestBed.createComponent(HomeComponent).componentInstance;
    expect(home.isDebt(card)).toBe(true);
    expect(home.isDebt(overdrawn)).toBe(false);
    expect(home.isDebt(fine)).toBe(false);
    expect(home.isDebt(cardInFavor)).toBe(false); // a balance in the user's favor is a plain amount
  });

  it('the stored balance of the card is still minus what is owed, so net worth is unchanged', () => {
    boot(new MemoryStorage().seed({ accounts: [card, fine], transactions: [] }));
    const home = TestBed.createComponent(HomeComponent).componentInstance;
    expect(home.transactionService.accountBalance('c1')).toBe(-2019.43);
  });
});
