// New transaction: the category grid cannot widen the page (3 columns on a phone, 4 from 480 px, names clamped to two
// lines and carried in full in `title`), and there is a compact way into capture. The pixels themselves are on the
// manual checklist: jsdom does not lay out CSS, so here only the structure is checked.
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { MemoryStorage, boot } from '../../../shared/testing/memory-storage';
import { account } from '../../../shared/testing/builders';
import { TransactionFormComponent } from './transaction-form';

function render() {
  boot(new MemoryStorage().seed({ accounts: [account({ id: 'a1', name: 'Corriente' })], transactions: [] }));
  const fixture = TestBed.createComponent(TransactionFormComponent);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('transaction form: category grid', () => {
  it('every category button carries its full name in title, and the long default names are present', () => {
    const root = render();
    const buttons = Array.from(root.querySelectorAll<HTMLElement>('.transaction-form-categories .transaction-form-category:not(.transaction-form-category-new)'));
    expect(buttons.length).toBeGreaterThan(8);
    for (const b of buttons) {
      const name = b.querySelector('.transaction-form-category-name')?.textContent?.trim();
      expect(name).toBeTruthy();
      expect(b.getAttribute('title')).toBe(name);
    }
    const titles = buttons.map((b) => b.getAttribute('title'));
    expect(titles).toContain('Card interest and charges');
    expect(titles).toContain('Loan interest and charges');
  });

  it('the grid and its names use the classes that hold the layout (minmax(0, 1fr) and the two-line clamp live in the SCSS)', () => {
    const root = render();
    expect(root.querySelector('.transaction-form-categories')).toBeTruthy();
    expect(root.querySelectorAll('.transaction-form-category-name').length).toBeGreaterThan(8);
  });
});

describe('transaction form: way into capture', () => {
  it('a new transaction shows a compact row that goes to /capture', () => {
    const root = render();
    const row = root.querySelector('a.transaction-form-capture') as HTMLAnchorElement;
    expect(row).toBeTruthy();
    expect(row.getAttribute('href')).toBe('/capture');
    expect(row.textContent).toContain('Have a screenshot, photo or invoice?');
    // right under the title, before the kind toggle
    const toggle = root.querySelector('.transaction-form-toggle') as HTMLElement;
    expect(row.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
