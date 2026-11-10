// Budgets that explain themselves: an empty state with one button, three taps to create one with the amount already suggested
// from the user's own months, "Left" as the figure of each row, and the edit form under the row it belongs to.
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BudgetService } from '../../../shared/services/budget.service';
import { account, transaction } from '../../../shared/testing/builders';
import { MemoryStorage, boot } from '../../../shared/testing/memory-storage';
import { BudgetsComponent } from './budgets';

const A1 = account({ id: 'a1', name: 'Corriente' });

// the 15th of the month `back` months ago, so the test never depends on today's date
function monthsAgo(back: number): string {
  const d = new Date();
  const index = d.getFullYear() * 12 + d.getMonth() - back;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-15`;
}
const spend = (back: number, amount: number, categoryId = 'cat-food') => transaction({ accountId: 'a1', categoryId, amount, date: monthsAgo(back) });

async function render(seed: Record<string, unknown> = {}) {
  boot(new MemoryStorage().seed({ accounts: [A1], transactions: [], ...seed }));
  const fixture = TestBed.createComponent(BudgetsComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, root: fixture.nativeElement as HTMLElement, budgets: TestBed.inject(BudgetService) };
}
type Env = Awaited<ReturnType<typeof render>>;

const button = (root: HTMLElement, text: string) => Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;

async function choose(env: Env, categoryId: string) {
  const select = env.root.querySelector('select[name=category]') as HTMLSelectElement;
  select.value = categoryId;
  select.dispatchEvent(new Event('change'));
  env.fixture.detectChanges();
  await env.fixture.whenStable();
  env.fixture.detectChanges();
}

const budgetsBudget = (budgets: BudgetService) => budgets.budgets().map((b) => ({ categoryId: b.categoryId, monthlyLimit: b.monthlyLimit }));

describe('Budgets: empty state', () => {
  afterEach(() => vi.restoreAllMocks());

  it('says what a budget is for and offers ONE button; no form is on screen', async () => {
    const { root } = await render();
    expect(root.querySelector('.budgets-empty')?.textContent).toContain('Set a limit per category and see how much you have left each month.');
    expect(root.querySelectorAll('.budgets-empty button').length).toBe(1);
    expect(button(root, 'Create your first budget')).toBeTruthy();
    expect(root.querySelector('.budgets-form')).toBeNull();
    expect(root.querySelector('select[name=category]')).toBeNull();
    expect(root.querySelector('input[name=limit]')).toBeNull();
  });

  it('tapping the button opens the form and hides the empty card', async () => {
    const env = await render();
    button(env.root, 'Create your first budget')!.click();
    env.fixture.detectChanges();
    expect(env.root.querySelector('.budgets-form')).toBeTruthy();
    expect(env.root.querySelector('.budgets-empty')).toBeNull();
  });
});

describe('Budgets: create in three taps', () => {
  it('button, category, Save: the amount is the average of the last months and nothing is saved before Save', async () => {
    const env = await render({ transactions: [spend(1, 1000), spend(2, 2000), spend(3, 3000)] });
    let taps = 0;
    button(env.root, 'Create your first budget')!.click();
    taps++;
    env.fixture.detectChanges();
    await choose(env, 'cat-food');
    taps++;
    const limit = env.root.querySelector('input[name=limit]') as HTMLInputElement;
    expect(limit.value).toBe('2000');
    expect(env.root.querySelector('.budgets-hint')?.textContent).toContain('Suggested: your average over the last 3 month(s)');
    expect(env.budgets.budgets().length).toBe(0); // a suggestion is not a budget

    button(env.root, 'Set budget')!.click();
    taps++;
    env.fixture.detectChanges();
    expect(taps).toBe(3);
    expect(budgetsBudget(env.budgets)).toEqual([{ categoryId: 'cat-food', monthlyLimit: 2000 }]);
    expect(env.root.querySelector('.budgets-form')).toBeNull();
    expect(env.root.querySelectorAll('.budgets-row').length).toBe(1);
  });

  it('the suggested amount is editable and what the user types is what is saved', async () => {
    const env = await render({ transactions: [spend(1, 1000)] });
    button(env.root, 'Create your first budget')!.click();
    env.fixture.detectChanges();
    await choose(env, 'cat-food');
    const limit = env.root.querySelector('input[name=limit]') as HTMLInputElement;
    limit.value = '1500';
    limit.dispatchEvent(new Event('input'));
    env.fixture.detectChanges();
    button(env.root, 'Set budget')!.click();
    expect(budgetsBudget(env.budgets)).toEqual([{ categoryId: 'cat-food', monthlyLimit: 1500 }]);
  });

  it('a category with no history leaves the amount empty and suggests nothing; Save stays off until there is an amount', async () => {
    const env = await render({ transactions: [spend(1, 1000)] });
    button(env.root, 'Create your first budget')!.click();
    env.fixture.detectChanges();
    await choose(env, 'cat-travel');
    expect((env.root.querySelector('input[name=limit]') as HTMLInputElement).value).toBe('');
    expect(env.root.querySelector('.budgets-hint')).toBeNull();
    expect(button(env.root, 'Set budget')!.disabled).toBe(true);
  });

  it('the categories you already spend in come first, and one that already has a budget is not offered again', async () => {
    const env = await render({ transactions: [spend(1, 100, 'cat-transport')] });
    env.budgets.upsert('cat-food', 500);
    env.fixture.detectChanges();
    button(env.root, 'New budget')!.click();
    env.fixture.detectChanges();
    const groups = Array.from(env.root.querySelectorAll('select[name=category] optgroup'));
    expect(groups.map((g) => g.getAttribute('label'))).toEqual(['Your categories', 'Other categories']);
    const used = Array.from(groups[0].querySelectorAll('option')).map((o) => o.getAttribute('value'));
    expect(used).toEqual(['cat-transport']);
    const all = Array.from(env.root.querySelectorAll('select[name=category] option')).map((o) => o.getAttribute('value'));
    expect(all).not.toContain('cat-food');
  });

  it('dollars are not part of the suggestion', async () => {
    const env = await render({ transactions: [spend(1, 1000), { ...spend(1, 9000), currency: 'USD' }] });
    button(env.root, 'Create your first budget')!.click();
    env.fixture.detectChanges();
    await choose(env, 'cat-food');
    expect((env.root.querySelector('input[name=limit]') as HTMLInputElement).value).toBe('1000');
  });
});

describe('Budgets: the list and editing in place', () => {
  it('each row leads with "Left" (or "Over budget by"), with the bar and numbers as support, not the only signal', async () => {
    const thisMonth = new Date().toISOString().slice(0, 8) + '01';
    const env = await render({
      transactions: [
        transaction({ accountId: 'a1', categoryId: 'cat-food', amount: 100, date: thisMonth }),
        transaction({ accountId: 'a1', categoryId: 'cat-transport', amount: 900, date: thisMonth }),
        transaction({ accountId: 'a1', categoryId: 'cat-health', amount: 1500, date: thisMonth }),
      ],
    });
    env.budgets.upsert('cat-food', 1000);
    env.budgets.upsert('cat-transport', 1000);
    env.budgets.upsert('cat-health', 1000);
    env.fixture.detectChanges();
    const rows = Array.from(env.root.querySelectorAll('.budgets-row'));
    const text = (i: number) => rows[i].querySelector('.budgets-row-left')?.textContent?.replace(/\s+/g, ' ').trim();
    expect(text(0)).toMatch(/^Left:\s*\$900\.00$/);
    expect(text(1)).toMatch(/^Left:\s*\$100\.00$/);
    expect(rows[1].textContent).toContain('Close to the limit'); // words, not just colour
    expect(text(2)).toMatch(/^Over budget by:\s*\$500\.00$/);
    expect(rows[0].querySelector('.budgets-row-bar')).toBeTruthy();
  });

  it('Edit opens the form right under that row, one at a time; Save changes the limit', async () => {
    const env = await render();
    env.budgets.upsert('cat-food', 500);
    env.budgets.upsert('cat-transport', 700);
    env.fixture.detectChanges();
    const edits = () => Array.from(env.root.querySelectorAll<HTMLButtonElement>('.budgets-row-edit'));
    edits()[0].click();
    env.fixture.detectChanges();
    await env.fixture.whenStable();
    env.fixture.detectChanges();
    const rows = Array.from(env.root.querySelectorAll('.budgets-row'));
    expect(rows[0].nextElementSibling?.classList.contains('budgets-edit')).toBe(true);
    expect(env.root.querySelectorAll('.budgets-edit').length).toBe(1);
    expect((env.root.querySelector('.budgets-edit input') as HTMLInputElement).value).toBe('500');

    // opening another one moves the form
    edits()[1].click();
    env.fixture.detectChanges();
    await env.fixture.whenStable();
    env.fixture.detectChanges();
    expect(env.root.querySelectorAll('.budgets-edit').length).toBe(1);
    expect(Array.from(env.root.querySelectorAll('.budgets-row'))[1].nextElementSibling?.classList.contains('budgets-edit')).toBe(true);

    const input = env.root.querySelector('.budgets-edit input') as HTMLInputElement;
    input.value = '900';
    input.dispatchEvent(new Event('input'));
    env.fixture.detectChanges();
    button(env.root, 'Save')!.click();
    env.fixture.detectChanges();
    expect(budgetsBudget(env.budgets)).toEqual([
      { categoryId: 'cat-food', monthlyLimit: 500 },
      { categoryId: 'cat-transport', monthlyLimit: 900 },
    ]);
    expect(env.root.querySelector('.budgets-edit')).toBeNull();
  });

  it('removing a budget keeps its confirmation: saying no keeps it, yes removes it', async () => {
    const env = await render();
    env.budgets.upsert('cat-food', 500);
    env.fixture.detectChanges();
    (env.root.querySelector('.budgets-row-edit') as HTMLButtonElement).click();
    env.fixture.detectChanges();
    const spy = vi.spyOn(window, 'confirm');
    spy.mockReturnValueOnce(false);
    button(env.root, 'Remove budget')!.click();
    expect(env.budgets.budgets().length).toBe(1);
    spy.mockReturnValueOnce(true);
    button(env.root, 'Remove budget')!.click();
    expect(env.budgets.budgets().length).toBe(0);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('with budgets, the form is not on screen until "New budget"', async () => {
    const env = await render();
    env.budgets.upsert('cat-food', 500);
    env.fixture.detectChanges();
    expect(env.root.querySelector('.budgets-form')).toBeNull();
    expect(env.root.querySelector('.budgets-empty')).toBeNull();
    expect(button(env.root, 'New budget')).toBeTruthy();
  });
});
