import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage, boot } from '../../testing/memory-storage';
import { account } from '../../testing/builders';
import { ModuleService } from '../../services/module.service';
import { ModuleSwitchesComponent } from './module-switches';

const goal = { id: 'g1', name: 'Trip', target: 1000, status: 'active', contributions: [], withdrawals: [], createdAt: '2026-11-01T00:00:00.000Z' };

function render(seed: Record<string, unknown> = {}) {
  boot(new MemoryStorage().seed({ accounts: [account({ id: 'a1' })], transactions: [], ...seed }));
  const fixture = TestBed.createComponent(ModuleSwitchesComponent);
  fixture.detectChanges();
  return { fixture, root: fixture.nativeElement as HTMLElement, modules: TestBed.inject(ModuleService) };
}

describe('Settings → Features', () => {
  afterEach(() => vi.restoreAllMocks());

  it('one row per switchable module, with a description, and the id the Settings link points to', () => {
    const { root } = render();
    expect(root.querySelector('#features')).toBeTruthy();
    expect(root.querySelectorAll('.modsw-row').length).toBe(6);
    expect(root.querySelectorAll('.modsw-info small').length).toBeGreaterThanOrEqual(6);
  });

  it('a module with data is on, shows its count and an Open link; one without data has no count', () => {
    const { root } = render({ goals: [goal] });
    const rows = Array.from(root.querySelectorAll('.modsw-row'));
    const goals = rows.find((r) => r.textContent?.includes('Goals'))!;
    expect(goals.querySelector('input')?.checked).toBe(true);
    expect(goals.querySelector('.modsw-count')?.textContent).toContain('1 goal(s) saved');
    expect(goals.querySelector('a.modsw-open')?.getAttribute('href')).toBe('/goals');
    const loans = rows.find((r) => r.textContent?.includes('Loans'))!;
    expect(loans.querySelector('input')?.checked).toBe(false);
    expect(loans.querySelector('.modsw-count')).toBeNull();
    expect(loans.querySelector('a.modsw-open')).toBeNull();
  });

  it('turning off a module that holds data asks first; saying no keeps it on, saying yes turns it off and keeps the data', () => {
    const { fixture, root, modules } = render({ goals: [goal] });
    const input = Array.from(root.querySelectorAll('.modsw-row')).find((r) => r.textContent?.includes('Goals'))!.querySelector('input') as HTMLInputElement;
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    input.checked = false;
    input.dispatchEvent(new Event('change'));
    expect(ask).toHaveBeenCalledTimes(1);
    expect(input.checked).toBe(true);
    expect(modules.isOn('goals')).toBe(true);
    ask.mockReturnValue(true);
    input.checked = false;
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(modules.isOn('goals')).toBe(false);
    expect(modules.counts().goals).toBe(1);
  });

  it('turning on a module without data does not ask', () => {
    const { root, modules } = render();
    const ask = vi.spyOn(window, 'confirm');
    const input = Array.from(root.querySelectorAll('.modsw-row')).find((r) => r.textContent?.includes('Loans'))!.querySelector('input') as HTMLInputElement;
    input.checked = true;
    input.dispatchEvent(new Event('change'));
    expect(ask).not.toHaveBeenCalled();
    expect(modules.isOn('loans')).toBe(true);
  });
});
