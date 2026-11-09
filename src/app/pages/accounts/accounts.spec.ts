// Editing happens where the thing is: the account form opens right under the card that is edited (one at a time),
// "Add account" is on top with its form under it, and changing the opening balance is shown and confirmed first.
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageService } from '../../../shared/services/storage.service';
import { MemoryStorage } from '../../../shared/testing/memory-storage';
import { account, transaction } from '../../../shared/testing/builders';
import { AccountsComponent } from './accounts';

const cash = account({ id: 'a-cash', name: 'Cartera', type: 'cash', initialBalance: 100 });
const bank = account({ id: 'a-bank', name: 'Corriente', type: 'bank', bankId: 'banreservas', initialBalance: 7727.48 });
const card = account({ id: 'a-card', name: 'Visa', type: 'card', cardKind: 'credit', bankId: 'popular', initialBalance: 0 });

function open(query: Record<string, string> = {}) {
  TestBed.resetTestingModule();
  const txs = [transaction({ id: 't1', type: 'income', amount: 2239.5, accountId: 'a-bank', date: '2026-11-02' })];
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: StorageService, useValue: new MemoryStorage().seed({ accounts: [cash, bank, card], transactions: txs }) as unknown as StorageService },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
    ],
  });
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(AccountsComponent);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  const cardEl = (id: string) => root.querySelector('.accounts-card[data-account-id="' + id + '"]') as HTMLElement;
  const forms = () => root.querySelectorAll('.accounts-form');
  return { fixture, component: fixture.componentInstance, root, cardEl, forms, navigate };
}

describe('accounts: the form opens under its account', () => {
  afterEach(() => vi.restoreAllMocks());

  it('Edit on the second account: exactly one form, and it is the next sibling of that card', () => {
    const { fixture, component, cardEl, forms } = open();
    component.edit(bank, new Event('click'));
    fixture.detectChanges();
    expect(forms().length).toBe(1);
    expect(cardEl('a-bank').nextElementSibling).toBe(forms()[0]);
    expect(cardEl('a-bank').classList.contains('accounts-card-editing')).toBe(true);
  });

  it('Edit on another account moves the form: no longer under the first, now under the new one', () => {
    const { fixture, component, cardEl, forms } = open();
    component.edit(bank, new Event('click'));
    fixture.detectChanges();
    component.edit(card, new Event('click'));
    fixture.detectChanges();
    expect(forms().length).toBe(1);
    expect(cardEl('a-bank').nextElementSibling?.classList.contains('accounts-form') ?? false).toBe(false);
    expect(cardEl('a-card').nextElementSibling).toBe(forms()[0]);
  });

  it('Edit on the account that is already open closes it; Cancel and Save close it too', () => {
    const { fixture, component, forms } = open();
    component.edit(bank, new Event('click'));
    component.edit(bank, new Event('click'));
    fixture.detectChanges();
    expect(forms().length).toBe(0);
    component.edit(bank, new Event('click'));
    fixture.detectChanges();
    component.cancelForm();
    fixture.detectChanges();
    expect(forms().length).toBe(0);
    component.edit(bank, new Event('click'));
    fixture.detectChanges();
    component.save();
    fixture.detectChanges();
    expect(forms().length).toBe(0);
  });

  it('"Add account" is before the first account and its form appears right under it', () => {
    const { fixture, component, root, cardEl, forms } = open();
    const add = root.querySelector('.accounts-add') as HTMLElement;
    const first = root.querySelector('.accounts-card') as HTMLElement;
    expect(add.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(root.querySelectorAll('.accounts-add').length).toBe(1);
    add.click();
    fixture.detectChanges();
    expect(forms().length).toBe(1);
    expect(add.nextElementSibling).toBe(forms()[0]);
    expect(forms()[0].classList.contains('accounts-form-attached')).toBe(false);
    expect(component.editing()).toBeNull();
    expect(cardEl('a-cash')).toBeTruthy();
  });

  it('?edit=ID opens under that account; an unknown id opens nothing and does not fail', () => {
    const ok = open({ edit: 'a-card' });
    ok.fixture.detectChanges();
    expect(ok.forms().length).toBe(1);
    expect(ok.cardEl('a-card').nextElementSibling).toBe(ok.forms()[0]);
    const bad = open({ edit: 'nope' });
    bad.fixture.detectChanges();
    expect(bad.forms().length).toBe(0);
  });

  it('tapping the card body still goes to the detail and does not open the edit form', () => {
    const { fixture, cardEl, forms, navigate } = open();
    cardEl('a-bank').click();
    fixture.detectChanges();
    expect(navigate).toHaveBeenCalledWith(['/account', 'a-bank']);
    expect(forms().length).toBe(0);
  });
});

describe('accounts: changing the opening balance', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the balance now and says what it will be; no change, no question', () => {
    const { fixture, component, root } = open();
    component.edit(bank, new Event('click'));
    fixture.detectChanges();
    expect(root.querySelector('.accounts-form')?.textContent).toContain('9,966.98');
    expect(component.openingChange()).toBeNull();
    component.formBalance = 8000;
    expect(component.openingChange()).toEqual({ currency: 'DOP', before: 9966.98, after: 10239.5 });
  });

  it('asks before saving a changed opening balance, and keeps the old one if the user says no', () => {
    const { component } = open();
    component.edit(bank, new Event('click'));
    component.formBalance = 8000;
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    component.save();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0]).toContain('9,966.98');
    expect(ask.mock.calls[0][0]).toContain('10,239.50');
    expect(component.accountService.byId('a-bank')?.initialBalance).toBe(7727.48);
    ask.mockReturnValue(true);
    component.save();
    expect(component.accountService.byId('a-bank')?.initialBalance).toBe(8000);
  });

  it('does not ask when the opening balance did not change', () => {
    const { component } = open();
    component.edit(bank, new Event('click'));
    component.formName = 'Corriente 2';
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(true);
    component.save();
    expect(ask).not.toHaveBeenCalled();
    expect(component.accountService.byId('a-bank')?.name).toBe('Corriente 2');
  });
});
