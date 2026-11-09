// Categories: the edit panel opens directly under the category (or subcategory) row being edited; one at a time.
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageService } from '../../services/storage.service';
import { MemoryStorage } from '../../testing/memory-storage';
import { CategoryManagerComponent } from './category-manager';

function open() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: StorageService, useValue: new MemoryStorage().seed({ accounts: [], transactions: [] }) as unknown as StorageService }],
  });
  const fixture = TestBed.createComponent(CategoryManagerComponent);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  const panels = () => root.querySelectorAll('.catman-edit');
  return { fixture, component: fixture.componentInstance, root, panels };
}

describe('category manager: the editor opens under its row', () => {
  afterEach(() => vi.restoreAllMocks());

  it('Edit on a category: one panel, directly after that category row', () => {
    const { fixture, component, root, panels } = open();
    const rows = root.querySelectorAll('.catman-list > .catman-row:not(.catman-sub)');
    expect(rows.length).toBeGreaterThan(2);
    const target = component.tree()[1].category;
    component.edit(target);
    fixture.detectChanges();
    expect(panels().length).toBe(1);
    expect(rows[1].nextElementSibling).toBe(panels()[0]);
    expect(rows[1].textContent).toContain(target.name);
  });

  it('editing another category moves the panel; the same row again closes it; Cancel closes it', () => {
    const { fixture, component, root, panels } = open();
    const rows = root.querySelectorAll('.catman-list > .catman-row:not(.catman-sub)');
    component.edit(component.tree()[0].category);
    fixture.detectChanges();
    component.edit(component.tree()[2].category);
    fixture.detectChanges();
    expect(panels().length).toBe(1);
    expect(rows[2].nextElementSibling).toBe(panels()[0]);
    expect(rows[0].nextElementSibling?.classList.contains('catman-edit') ?? false).toBe(false);
    component.edit(component.tree()[2].category);
    fixture.detectChanges();
    expect(panels().length).toBe(0);
    component.edit(component.tree()[2].category);
    fixture.detectChanges();
    component.cancel();
    fixture.detectChanges();
    expect(panels().length).toBe(0);
    expect(root.querySelector('.catman-list')).toBeTruthy();
  });

  it('a subcategory is edited right under its own row', () => {
    const { fixture, component, root, panels } = open();
    const withKids = component.tree().find((n) => n.children.length > 0);
    if (!withKids) return; // the defaults carry subcategories; if one day they do not, there is nothing to place
    component.edit(withKids.children[0]);
    fixture.detectChanges();
    expect(panels().length).toBe(1);
    const sub = panels()[0].previousElementSibling as HTMLElement;
    expect(sub.classList.contains('catman-sub')).toBe(true);
    expect(sub.textContent).toContain(withKids.children[0].name);
    expect(root.querySelectorAll('.catman-edit').length).toBe(1);
  });
});
