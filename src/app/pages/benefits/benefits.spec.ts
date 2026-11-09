// Benefits: "Add benefit" is on top with its form under it; "Edit" opens the form right under that benefit; one at a time.
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageService } from '../../../shared/services/storage.service';
import { MemoryStorage } from '../../../shared/testing/memory-storage';
import { BenefitsComponent } from './benefits';

const benefit = (id: string, name: string) => ({
  id,
  name,
  kind: 'meals',
  provider: '',
  monthlyValue: 100,
  uses: [],
  active: true,
  notes: '',
  createdAt: '2026-11-01T00:00:00.000Z',
});

function open() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: StorageService, useValue: new MemoryStorage().seed({ accounts: [], transactions: [], benefits: [benefit('b1', 'Meals'), benefit('b2', 'Fuel'), benefit('b3', 'Gym')] }) as unknown as StorageService },
    ],
  });
  const fixture = TestBed.createComponent(BenefitsComponent);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  const cardEl = (id: string) => root.querySelector('[data-benefit-id="' + id + '"]') as HTMLElement;
  const forms = () => root.querySelectorAll('.benefits-form');
  return { fixture, component: fixture.componentInstance, root, cardEl, forms };
}

describe('benefits: forms open in place', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists the three benefits (the seed is read)', () => {
    const { root } = open();
    expect(root.querySelectorAll('[data-benefit-id]').length).toBe(3);
  });

  it('"Add benefit" is above the first benefit and its form opens right under the button', () => {
    const { fixture, component, root, forms } = open();
    const add = root.querySelector('.benefits-add') as HTMLElement;
    const first = root.querySelector('[data-benefit-id]') as HTMLElement;
    expect(add.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    add.click();
    fixture.detectChanges();
    expect(forms().length).toBe(1);
    expect(add.nextElementSibling).toBe(forms()[0]);
    expect(component.editingId).toBeNull();
  });

  it('Edit on a benefit opens the form right under that card; on another, it moves; the same one closes it', () => {
    const { fixture, component, cardEl, forms } = open();
    const b = (id: string) => component.benefits.byId(id)!;
    component.openForm(b('b2'));
    fixture.detectChanges();
    expect(forms().length).toBe(1);
    expect(cardEl('b2').nextElementSibling).toBe(forms()[0]);
    component.openForm(b('b3'));
    fixture.detectChanges();
    expect(forms().length).toBe(1);
    expect(cardEl('b3').nextElementSibling).toBe(forms()[0]);
    expect(cardEl('b2').nextElementSibling).toBe(cardEl('b3'));
    component.openForm(b('b3'));
    fixture.detectChanges();
    expect(forms().length).toBe(0);
  });

  it('Cancel and Save close it, and an edit really saves', () => {
    const { fixture, component, forms } = open();
    component.openForm(component.benefits.byId('b1')!);
    fixture.detectChanges();
    component.closeForm();
    fixture.detectChanges();
    expect(forms().length).toBe(0);
    component.openForm(component.benefits.byId('b1')!);
    component.fName = 'Meals card';
    component.save();
    fixture.detectChanges();
    expect(forms().length).toBe(0);
    expect(component.benefits.byId('b1')?.name).toBe('Meals card');
  });
});
