// The three-step "Get started" card: it ticks itself, existing users never see it, Hide persists, and ?new=1 opens the form.
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { GetStartedComponent } from '../../../shared/components/get-started/get-started';
import { ModuleService } from '../../../shared/services/module.service';
import { StorageService } from '../../../shared/services/storage.service';
import { account, transaction } from '../../../shared/testing/builders';
import { MemoryStorage, boot } from '../../../shared/testing/memory-storage';
import { AccountsComponent } from '../accounts/accounts';

const acc = account({ id: 'a1', name: 'Corriente' });

function card(storage: MemoryStorage) {
  boot(storage);
  const f = TestBed.createComponent(GetStartedComponent);
  f.detectChanges();
  return { f, root: f.nativeElement as HTMLElement };
}

describe('get-started card', () => {
  it('a fresh install (with its two starting accounts): three pending steps that go to the right places', () => {
    const { root } = card(new MemoryStorage().seed({ transactions: [] }));
    expect(root.querySelectorAll('li').length).toBe(3);
    expect(root.querySelectorAll('li.done').length).toBe(0);
    const hrefs = Array.from(root.querySelectorAll('a.gs-step')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/accounts?new=1', '/add', '/settings/features']);
  });

  it('with one account the first step is done and the other two are not', () => {
    const { root } = card(new MemoryStorage().seed({ accounts: [acc], transactions: [] }));
    const done = Array.from(root.querySelectorAll('li')).map((li) => li.classList.contains('done'));
    expect(done).toEqual([true, false, false]);
  });

  it('accounts and movements already there (an existing user): no card', () => {
    const { root } = card(new MemoryStorage().seed({ accounts: [acc], transactions: [transaction({ id: 't1', accountId: 'a1' })] }));
    expect(root.querySelector('.gs')).toBeNull();
  });

  it('flipping a module switch ticks the third step; Skip does too', () => {
    const { f, root } = card(new MemoryStorage().seed({ accounts: [], transactions: [] }));
    TestBed.inject(ModuleService).set('goals', true);
    f.detectChanges();
    expect(root.querySelectorAll('li')[2].classList.contains('done')).toBe(true);

    const second = card(new MemoryStorage().seed({ accounts: [], transactions: [] }));
    (second.root.querySelector('.gs-skip') as HTMLButtonElement).click();
    second.f.detectChanges();
    expect(second.root.querySelectorAll('li')[2].classList.contains('done')).toBe(true);
    expect(second.root.querySelector('.gs-skip')).toBeNull();
  });

  it('Hide removes it and it stays hidden after a restart', () => {
    const storage = new MemoryStorage().seed({ accounts: [], transactions: [] });
    const { f, root } = card(storage);
    (root.querySelector('.gs-hide') as HTMLButtonElement).click();
    f.detectChanges();
    expect(root.querySelector('.gs')).toBeNull();
    const again = card(storage);
    expect(again.root.querySelector('.gs')).toBeNull();
    expect(TestBed.inject(StorageService).get<Record<string, unknown>>('device-prefs', {})['getStartedHidden']).toBe(true);
  });
});

describe('/accounts?new=1', () => {
  it('opens the new-account form on top, under "Add account"', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: StorageService, useValue: new MemoryStorage().seed({ accounts: [], transactions: [] }) as unknown as StorageService },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ new: '1' }) } } },
      ],
    });
    const f = TestBed.createComponent(AccountsComponent);
    f.detectChanges();
    const root = f.nativeElement as HTMLElement;
    const add = root.querySelector('.accounts-add') as HTMLElement;
    expect(root.querySelectorAll('.accounts-form').length).toBe(1);
    expect(add.nextElementSibling).toBe(root.querySelector('.accounts-form'));
  });
});
