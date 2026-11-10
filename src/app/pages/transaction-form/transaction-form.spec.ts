// New transaction in three taps: amount, category, Save. The structure is tested here (what is folded, what is remembered, what is saved);
// the pixels (sticky Save above the bar, 44 px rows) are on the manual checklist because jsdom does not lay out CSS.
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { StorageService } from '../../../shared/services/storage.service';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MemoryStorage, boot } from '../../../shared/testing/memory-storage';
import { account, transaction } from '../../../shared/testing/builders';
import { TransactionService } from '../../../shared/services/transaction.service';
import { UndoToastService } from '../../../shared/services/undo-toast.service';
import { AccountService } from '../../../shared/services/account.service';
import { TransactionFormComponent } from './transaction-form';

const A1 = account({ id: 'a1', name: 'Corriente', icon: '🏦' });
const A2 = account({ id: 'a2', name: 'Ahorros', icon: '🏦' });
const CASH = account({ id: 'cash', name: 'Efectivo', type: 'cash', icon: '💵' });
const USD = account({ id: 'usd', name: 'Dólares', currency: 'USD' });

async function render(seed: Record<string, unknown> = {}, storage?: MemoryStorage) {
  const s = storage ?? new MemoryStorage().seed({ accounts: [A1, A2, CASH, USD], transactions: [], ...seed });
  boot(s);
  const fixture = TestBed.createComponent(TransactionFormComponent);
  fixture.detectChanges();
  await fixture.whenStable(); // ngModel writes its values on a microtask
  fixture.detectChanges();
  return { fixture, root: fixture.nativeElement as HTMLElement, storage: s, txs: TestBed.inject(TransactionService), toasts: TestBed.inject(UndoToastService) };
}

type Env = Awaited<ReturnType<typeof render>>;

// the three interactions of a typical expense; `taps` counts only touches (typing is not a tap)
function typeAmount(env: Env, value: string) {
  const input = env.root.querySelector('#tf-amount') as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  env.fixture.detectChanges();
}
function tapCategory(env: Env, title: string) {
  const grid = Array.from(env.root.querySelectorAll<HTMLButtonElement>('.transaction-form-categories .transaction-form-category'));
  grid.find((b) => b.getAttribute('title') === title)!.click();
  env.fixture.detectChanges();
}
function tapSave(env: Env) {
  (env.root.querySelector('.transaction-form-save') as HTMLButtonElement).click();
  env.fixture.detectChanges();
}
function pick(env: Env, name: string, value: string) {
  const select = env.root.querySelector(`select[name=${name}]`) as HTMLSelectElement;
  select.value = value;
  select.dispatchEvent(new Event('change'));
  env.fixture.detectChanges();
}
const stored = (env: Env) => env.txs.transactions();

describe('new transaction: category grid and the way into capture', () => {
  it('the grid shows 8 categories plus More; every one carries its full name in title; the rest are in the sheet', async () => {
    const env = await render();
    const tiles = Array.from(env.root.querySelectorAll<HTMLElement>('.transaction-form-categories .transaction-form-category'));
    expect(tiles.length).toBe(9); // 8 + More
    expect(tiles[8].classList.contains('transaction-form-category-more')).toBe(true);
    for (const b of tiles.slice(0, 8)) expect(b.getAttribute('title')).toBe(b.querySelector('.transaction-form-category-name')?.textContent?.trim());
    expect(env.root.querySelector('app-bottom-sheet .sheet')).toBeNull(); // closed

    (tiles[8] as HTMLButtonElement).click();
    env.fixture.detectChanges();
    const titles = Array.from(env.root.querySelectorAll<HTMLElement>('app-bottom-sheet .transaction-form-category')).map((b) => b.getAttribute('title'));
    expect(titles).toContain('Card interest and charges');
    expect(titles).toContain('Loan interest and charges');
    expect(env.root.querySelector('app-bottom-sheet .transaction-form-category-new')).toBeTruthy(); // the way to a new category lives here
  });

  it('the grid and its names use the classes that hold the layout (minmax(0, 1fr) and the two-line clamp live in the SCSS)', async () => {
    const { root } = await render();
    expect(root.querySelector('.transaction-form-categories')).toBeTruthy();
    expect(root.querySelectorAll('.transaction-form-category-name').length).toBeGreaterThan(8);
  });

  it('a new transaction shows a compact row that goes to /capture, right under the title and before the kind toggle', async () => {
    const { root } = await render();
    const row = root.querySelector('a.transaction-form-capture') as HTMLAnchorElement;
    expect(row.getAttribute('href')).toBe('/capture');
    expect(row.textContent).toContain('Have a screenshot, photo or invoice?');
    const toggle = root.querySelector('.transaction-form-toggle') as HTMLElement;
    expect(row.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the categories this user picks most come first; a category chosen from More takes the first place', async () => {
    const many = Array.from({ length: 6 }, (_, i) => transaction({ id: `u${i}`, accountId: 'a1', categoryId: 'cat-gifts-expense', date: '2026-11-0' + (i + 1) }));
    const env = await render({ transactions: many });
    const first = env.root.querySelector<HTMLElement>('.transaction-form-categories .transaction-form-category');
    expect(first?.getAttribute('title')).toBe('Gifts');

    // open More, pick something from the rest: it moves up to the grid
    (env.root.querySelector('.transaction-form-category-more') as HTMLButtonElement).click();
    env.fixture.detectChanges();
    const rest = env.root.querySelector<HTMLButtonElement>('app-bottom-sheet .transaction-form-category:not(.transaction-form-category-new)')!;
    const name = rest.getAttribute('title');
    rest.click();
    env.fixture.detectChanges();
    expect(env.root.querySelector('app-bottom-sheet .sheet')).toBeNull(); // the sheet closed
    const grid = Array.from(env.root.querySelectorAll<HTMLElement>('.transaction-form-categories .transaction-form-category'));
    expect(grid[0].getAttribute('title')).toBe(name);
    expect(grid[0].classList.contains('active')).toBe(true);
  });
});

describe('new transaction: three taps', () => {
  it('a typical expense is amount, category, Save (the "+" on Home is the first tap: 3 in all) and defaults do the rest', async () => {
    const env = await render();
    let taps = 1; // "+" on Home
    expect((env.root.querySelector('button.transaction-form-save') as HTMLButtonElement).disabled).toBe(true);
    typeAmount(env, '350');
    tapCategory(env, 'Food');
    taps++;
    expect((env.root.querySelector('button.transaction-form-save') as HTMLButtonElement).disabled).toBe(false);
    tapSave(env);
    taps++;
    expect(taps).toBe(3);

    expect(stored(env).length).toBe(1);
    const tx = stored(env)[0];
    expect(tx).toMatchObject({ type: 'expense', amount: 350, categoryId: 'cat-food', accountId: 'a1', currency: 'DOP', status: 'posted' });
    expect(tx.date).toBe(new Date().toLocaleDateString('en-CA'));
  });

  it('the movement has the same shape as always: no extra fields appear from the new layout', async () => {
    const env = await render();
    typeAmount(env, '12.5');
    tapCategory(env, 'Food');
    tapSave(env);
    const keys = Object.keys(JSON.parse(JSON.stringify(stored(env)[0]))).sort();
    expect(keys).toEqual(['accountId', 'amount', 'categoryId', 'createdAt', 'currency', 'date', 'id', 'origin', 'status', 'type', 'updatedAt']);
  });

  it('the amount asks for the numeric keyboard and starts focused on a new movement', async () => {
    const env = await render();
    const input = env.root.querySelector('#tf-amount') as HTMLInputElement;
    expect(input.getAttribute('inputmode')).toBe('decimal');
    document.body.appendChild(env.root);
    await new Promise((r) => setTimeout(r, 5));
    expect(document.activeElement).toBe(input);
    env.root.remove();
  });

  it('the date is today and shown as "Today"; a new movement offers Save below everything, outside More options', async () => {
    const { root } = await render();
    expect(root.textContent).toContain('Today');
    const actions = root.querySelector('.transaction-form-actions') as HTMLElement;
    expect(actions.querySelector('.transaction-form-save')).toBeTruthy();
    expect(actions.closest('details')).toBeNull();
    expect(root.querySelector('.transaction-form')!.lastElementChild).toBe(actions);
  });

  it('Save is sticky above the bottom navigation (the rule is in the SCSS)', async () => {
    const scss = readFileSync('src/app/pages/transaction-form/transaction-form.scss', 'utf8');
    expect(scss).toMatch(/\.transaction-form-actions\s*\{[^}]*position:\s*sticky/);
    expect(scss).toMatch(/\.transaction-form-actions\s*\{[^}]*safe-area-inset-bottom/);
  });

  it('after saving, a short confirmation with Undo is shown; Undo takes the movement back and the balance returns', async () => {
    const env = await render();
    const balanceBefore = TestBed.inject(AccountService).byId('a1');
    expect(balanceBefore).toBeTruthy();
    typeAmount(env, '350');
    tapCategory(env, 'Food');
    tapSave(env);
    expect(stored(env).length).toBe(1);
    const toast = env.toasts.current();
    expect(toast?.message).toBe('Expense of $350.00 saved');
    expect(toast?.undo).toBeTruthy();
    env.toasts.undo();
    expect(stored(env).length).toBe(0);
    expect(env.toasts.current()).toBeNull();
  });

  it('a recurring movement says it was saved but offers no Undo (its rule is edited in Settings)', async () => {
    const env = await render();
    (env.root.querySelector('details.transaction-form-more') as HTMLDetailsElement).open = true;
    typeAmount(env, '100');
    tapCategory(env, 'Food');
    pick(env, 'repeat', 'monthly');
    tapSave(env);
    expect(env.toasts.current()?.message).toBe('Expense of $100.00 saved');
    expect(env.toasts.current()?.undo).toBeUndefined();
  });

  it('income and transfer have their own sentence in the confirmation', async () => {
    const inc = await render();
    (inc.root.querySelectorAll('.transaction-form-toggle button')[1] as HTMLButtonElement).click();
    inc.fixture.detectChanges();
    typeAmount(inc, '1000');
    tapCategory(inc, 'Salary');
    tapSave(inc);
    expect(inc.toasts.current()?.message).toBe('Income of $1,000.00 saved');

    const tr = await render();
    (tr.root.querySelectorAll('.transaction-form-toggle button')[2] as HTMLButtonElement).click();
    tr.fixture.detectChanges();
    typeAmount(tr, '40');
    tapSave(tr);
    expect(tr.toasts.current()?.message).toBe('Transfer of $40.00 saved');
    const t = stored(tr)[0];
    expect(t).toMatchObject({ type: 'transfer', amount: 40, accountId: 'a1', toAccountId: 'a2' });
  });
});

describe('new transaction: the account is the one used last', () => {
  it('the first time it is the first account; after saving with another one, the next form starts there', async () => {
    const first = await render();
    expect(first.root.querySelector('select[name=accountId]')).toBeTruthy();
    expect((first.root.querySelector('select[name=accountId]') as HTMLSelectElement).value).toBe('a1');
    expect(first.root.querySelector('.transaction-form-row-value')?.textContent).toContain('Corriente');
    pick(first, 'accountId', 'a2');
    typeAmount(first, '5');
    tapCategory(first, 'Food');
    tapSave(first);

    const prefs = first.storage.get('device-prefs', {}) as { lastAccountByType?: Record<string, string> };
    expect(prefs.lastAccountByType).toEqual({ expense: 'a2' });

    const second = await render({}, first.storage);
    expect((second.root.querySelector('select[name=accountId]') as HTMLSelectElement).value).toBe('a2');
    expect(second.root.querySelector('.transaction-form-row-value')?.textContent).toContain('Ahorros');
  });

  it('each kind remembers its own account, and the other device preferences are kept', async () => {
    const storage = new MemoryStorage().seed({ accounts: [A1, A2, CASH, USD], transactions: [], 'device-prefs': { reminderDays: 14 } });
    const env = await render({}, storage);
    pick(env, 'accountId', 'cash');
    typeAmount(env, '5');
    tapCategory(env, 'Food');
    tapSave(env);
    const income = await render({}, storage);
    (income.root.querySelectorAll('.transaction-form-toggle button')[1] as HTMLButtonElement).click();
    income.fixture.detectChanges();
    await income.fixture.whenStable();
    income.fixture.detectChanges();
    expect((income.root.querySelector('select[name=accountId]') as HTMLSelectElement).value).toBe('a1'); // income never used cash
    const prefs = storage.get('device-prefs', {}) as { reminderDays?: number; lastAccountByType?: Record<string, string> };
    expect(prefs.reminderDays).toBe(14);
    expect(prefs.lastAccountByType?.['expense']).toBe('cash');
  });

  it('an old install (device-prefs without the field) works, and a remembered account that is gone falls back to the first', async () => {
    const storage = new MemoryStorage().seed({ accounts: [A1, A2], transactions: [], 'device-prefs': { lastAccountByType: { expense: 'deleted-account' } } });
    const env = await render({}, storage);
    expect((env.root.querySelector('select[name=accountId]') as HTMLSelectElement).value).toBe('a1');
    const old = await render({}, new MemoryStorage().seed({ accounts: [A1, A2], transactions: [], 'device-prefs': { lastExportAt: 1 } }));
    expect((old.root.querySelector('select[name=accountId]') as HTMLSelectElement).value).toBe('a1');
  });

  it('dollars and pesos never mix: a dollar account saves US$ and shows the US$ symbol; a peso one saves RD$', async () => {
    const env = await render();
    pick(env, 'accountId', 'usd');
    expect(env.root.querySelector('.transaction-form-amount span')?.textContent).toBe('US$');
    typeAmount(env, '20');
    tapCategory(env, 'Food');
    tapSave(env);
    expect(stored(env)[0]).toMatchObject({ accountId: 'usd', currency: 'USD', amount: 20 });
    expect(env.toasts.current()?.message).toBe('Expense of US$20.00 saved');

    const peso = await render();
    expect(peso.root.querySelector('.transaction-form-amount span')?.textContent).toBe('$');
    typeAmount(peso, '20');
    tapCategory(peso, 'Food');
    tapSave(peso);
    expect(stored(peso)[0].currency).toBe('DOP');
  });
});

describe('new transaction: More options', () => {
  it('is folded by default and holds the fields that used to be on the main form', async () => {
    const { root } = await render();
    const more = root.querySelector('details.transaction-form-more') as HTMLDetailsElement;
    expect(more.open).toBe(false);
    for (const name of ['fee', 'repeat', 'note']) expect(more.querySelector(`[name=${name}]`), name).toBeTruthy();
    // what stays outside: amount, category, account row, date row, Save
    expect(more.querySelector('#tf-amount')).toBeNull();
    expect(more.querySelector('.transaction-form-categories')).toBeNull();
    expect(more.querySelector('.transaction-form-save')).toBeNull();
  });

  it('the note and the bank charge typed inside More options are saved with the movement', async () => {
    const env = await render();
    typeAmount(env, '200');
    tapCategory(env, 'Food');
    const note = env.root.querySelector('input[name=note]') as HTMLInputElement;
    note.value = 'Birthday';
    note.dispatchEvent(new Event('input'));
    const fee = env.root.querySelector('input[name=fee]') as HTMLInputElement;
    fee.value = '0.4';
    fee.dispatchEvent(new Event('input'));
    env.fixture.detectChanges();
    tapSave(env);
    expect(stored(env)[0]).toMatchObject({ amount: 200, note: 'Birthday', fee: 0.4 });
  });

  it('a cash account has no bank charge; a bank account does (rule kept)', async () => {
    const env = await render();
    expect(env.root.querySelector('input[name=fee]')).toBeTruthy();
    pick(env, 'accountId', 'cash');
    expect(env.root.querySelector('input[name=fee]')).toBeNull();
  });

  it('editing a movement opens More options and keeps every value, saves through update and goes to the list', async () => {
    const tx = transaction({ id: 'e1', accountId: 'a1', amount: 99, categoryId: 'cat-food', note: 'Old note', fee: 1, date: '2026-10-05' });
    const storage = new MemoryStorage().seed({ accounts: [A1, A2], transactions: [tx] });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: StorageService, useValue: storage as unknown as StorageService },
        provideRouter([{ path: 'transactions', children: [] }]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'e1' }), queryParamMap: convertToParamMap({}) } } },
      ],
    });
    const fixture = TestBed.createComponent(TransactionFormComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect((root.querySelector('details.transaction-form-more') as HTMLDetailsElement).open).toBe(true);
    expect((root.querySelector('#tf-amount') as HTMLInputElement).value).toBe('99');
    expect((root.querySelector('input[name=note]') as HTMLInputElement).value).toBe('Old note');
    expect((root.querySelector('input[name=fee]') as HTMLInputElement).value).toBe('1');
    expect(root.textContent).not.toContain('Today'); // an old date is shown as a date
    expect(root.querySelector('.transaction-form-capture')).toBeNull();

    const amount = root.querySelector('#tf-amount') as HTMLInputElement;
    amount.value = '120';
    amount.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (root.querySelector('.transaction-form-save') as HTMLButtonElement).click();
    const txs = TestBed.inject(TransactionService);
    expect(txs.byId('e1')).toMatchObject({ amount: 120, note: 'Old note', fee: 1, date: '2026-10-05' });
    expect(txs.transactions().length).toBe(1);
    expect(TestBed.inject(UndoToastService).current()).toBeNull(); // editing is not "new": no toast
  });
});
