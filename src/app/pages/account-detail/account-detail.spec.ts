// Tapping an account opens its detail: balance and the movements that leave it AND the ones that arrive.
// A credit card goes to its own page.
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { StorageService } from '../../../shared/services/storage.service';
import { MemoryStorage } from '../../../shared/testing/memory-storage';
import { account, transaction } from '../../../shared/testing/builders';
import { AccountDetailComponent } from './account-detail';

const savings = account({ id: 's1', name: 'Ahorro', type: 'savings', initialBalance: 1000 });
const bank = account({ id: 'k1', name: 'Corriente', type: 'bank', initialBalance: 500 });
const card = account({ id: 'c1', name: 'Visa', type: 'card', cardKind: 'credit', initialBalance: 0 });

function open(id: string, txs = [] as ReturnType<typeof transaction>[]) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: StorageService, useValue: new MemoryStorage().seed({ accounts: [savings, bank, card], transactions: txs }) as unknown as StorageService },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id }) } } },
    ],
  });
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  return { component: TestBed.createComponent(AccountDetailComponent).componentInstance, navigate };
}

describe('account detail', () => {
  it('lists what leaves the account and what arrives, newest first, and nothing from other accounts', () => {
    const txs = [
      transaction({ id: 'a', type: 'expense', amount: 10, accountId: 's1', date: '2026-11-01' }),
      transaction({ id: 'b', type: 'transfer', amount: 100, accountId: 'k1', toAccountId: 's1', date: '2026-11-03' }),
      transaction({ id: 'c', type: 'expense', amount: 5, accountId: 'k1', date: '2026-11-04' }),
    ];
    const { component } = open('s1', txs);
    expect(component.movements().map((t) => t.id)).toEqual(['b', 'a']);
    expect(component.balance('DOP')).toBe(1000 - 10 + 100);
  });

  it('shows the balance with its own sign: only a credit card is shown as a debt (its own page)', () => {
    const { component, navigate } = open('k1');
    expect(component.account()?.name).toBe('Corriente');
    expect(navigate).not.toHaveBeenCalled();
    const card = open('c1');
    expect(card.navigate).toHaveBeenCalledWith(['/card', 'c1'], { replaceUrl: true });
  });

  it('an unknown account says so instead of failing', () => {
    expect(open('nope').component.account()).toBeUndefined();
  });
});
