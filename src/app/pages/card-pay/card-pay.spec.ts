// Paying a card: the amount is the balance owed, the paying account is the one this card is usually paid from, and the
// date, bank tax and note are folded under "More options". The payment is still a transfer, never an expense (rule 3).
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { StorageService } from '../../../shared/services/storage.service';
import { TransactionService } from '../../../shared/services/transaction.service';
import { account, transaction } from '../../../shared/testing/builders';
import { MemoryStorage } from '../../../shared/testing/memory-storage';
import { CardPayComponent } from './card-pay';

const A1 = account({ id: 'a1', name: 'Corriente' });
const A2 = account({ id: 'a2', name: 'Ahorros' });
const CARD = account({ id: 'c1', name: 'Visa', type: 'card', cardKind: 'credit', initialBalance: 0 });
const purchase = transaction({ id: 'p1', accountId: 'c1', amount: 500, categoryId: 'cat-food', date: '2026-10-05' });
const paid = (id: string, from: string) => transaction({ id, type: 'transfer', origin: 'card-payment', accountId: from, toAccountId: 'c1', amount: 50, date: '2026-09-10' });

async function render(txs = [purchase]) {
  const storage = new MemoryStorage().seed({ accounts: [A1, A2, CARD], transactions: txs });
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: StorageService, useValue: storage as unknown as StorageService },
      provideRouter([{ path: 'card/:id', children: [] }]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'c1' }), queryParamMap: convertToParamMap({}) } } },
    ],
  });
  const fixture = TestBed.createComponent(CardPayComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, root: fixture.nativeElement as HTMLElement, txs: TestBed.inject(TransactionService) };
}

describe('Pay card', () => {
  it('first time: the first account that can pay and the balance owed; one tap on "Register payment" and it is a transfer to the card', async () => {
    const { fixture, root, txs } = await render();
    expect((root.querySelector('select[name=from]') as HTMLSelectElement).value).toBe('a1');
    expect(root.querySelector('.pay-choices .active')?.textContent).toContain('Statement balance');
    const register = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes('Register payment')) as HTMLButtonElement;
    expect(register.disabled).toBe(false);
    register.click(); // the only tap on this screen
    fixture.detectChanges();
    const payment = txs.transactions().find((t) => t.origin === 'card-payment')!;
    expect(payment).toMatchObject({ type: 'transfer', accountId: 'a1', toAccountId: 'c1', amount: 500 });
    expect(txs.transactions().filter((t) => t.type === 'expense').length).toBe(1); // only the original purchase: not an expense again
  });

  it('the account this card is usually paid from comes preselected, and it can still be changed', async () => {
    const { fixture, root, txs } = await render([purchase, paid('x1', 'a2'), paid('x2', 'a2'), paid('x3', 'a1')]);
    const select = root.querySelector('select[name=from]') as HTMLSelectElement;
    expect(select.value).toBe('a2');
    select.value = 'a1';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    (Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes('Register payment')) as HTMLButtonElement).click();
    expect(txs.transactions().find((t) => t.origin === 'card-payment' && t.id !== 'x1' && t.id !== 'x2' && t.id !== 'x3')?.accountId).toBe('a1');
  });

  it('date, bank tax and note are folded under More options, closed by default, and all three are still there', async () => {
    const { root } = await render();
    const more = root.querySelector('details.pay-more') as HTMLDetailsElement;
    expect(more.open).toBe(false);
    for (const name of ['date', 'fee', 'note']) expect(more.querySelector(`[name=${name}]`), name).toBeTruthy();
    expect(root.querySelector('select[name=from]')?.closest('details')).toBeNull();
  });
});
