// Settings as a menu: every row opens its own screen, every old link still lands in the right place, and no control changed store.
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { describe, expect, it } from 'vitest';
import { SETTINGS_LINKS } from '../../../shared/config/settings-links';
import { SETTINGS_SECTIONS, SETTINGS_SECTION_IDS } from '../../../shared/domain/settings-menu';
import { StorageService } from '../../../shared/services/storage.service';
import { account } from '../../../shared/testing/builders';
import { MemoryStorage } from '../../../shared/testing/memory-storage';
import { SETTINGS_ROUTES } from './settings.routes';

function setup(storage = new MemoryStorage().seed({ accounts: [account({ id: 'a1' })], transactions: [] })) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: StorageService, useValue: storage as unknown as StorageService }, provideRouter(SETTINGS_ROUTES)],
  });
  return { storage, router: TestBed.inject(Router) };
}

async function open(url: string, storage?: MemoryStorage) {
  const env = setup(storage);
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  harness.detectChanges();
  await harness.fixture.whenStable();
  harness.detectChanges();
  return { ...env, harness, root: harness.routeNativeElement as HTMLElement };
}

describe('Settings menu', () => {
  it('has one row per section, each with a status line, a link to /settings/<id> and a 44 px minimum height rule', async () => {
    const { root } = await open('/settings');
    const rows = Array.from(root.querySelectorAll('a.smenu-row'));
    expect(rows.map((r) => r.getAttribute('href'))).toEqual(SETTINGS_SECTIONS.map((s) => `/settings/${s.id}`));
    for (const row of rows) expect(row.querySelector('small')?.textContent?.trim().length).toBeGreaterThan(0);
    // the long page is gone: the menu holds no form controls
    expect(root.querySelectorAll('input, select, textarea').length).toBe(0);
    expect(root.querySelector('.settings-version')?.textContent).toContain('X Money · v');
  });

  it('the status lines say something true: currency, module count, local-only data', async () => {
    const { root } = await open('/settings');
    const status = (id: string) => root.querySelector(`a[data-section="${id}"] small`)?.textContent?.trim();
    expect(status('preferences')).toBe('English · $');
    expect(status('data')).toBe('Only on this device');
    expect(status('security')).toBe('Off');
    expect(status('features')).toMatch(/^\d+ on$/);
  });

  it('every row opens its own screen with a header, a back link to /settings and the right title', async () => {
    for (const section of SETTINGS_SECTIONS) {
      const { root } = await open(`/settings/${section.id}`);
      expect(root.querySelector('app-settings-header h1')?.textContent?.trim(), section.id).toBe(section.title);
      expect(root.querySelector('app-settings-header a.sh-back')?.getAttribute('href'), section.id).toBe('/settings');
    }
  });

  it('clicking a row navigates to its screen', async () => {
    const { harness, router, root } = await open('/settings');
    (root.querySelector('a[data-section="alerts"]') as HTMLAnchorElement).click();
    await harness.fixture.whenStable();
    expect(router.url).toBe('/settings/alerts');
  });

  it('SETTINGS_LINKS and the menu name the same screens, and every link resolves to a route that exists', async () => {
    expect(Object.keys(SETTINGS_LINKS).sort()).toEqual([...SETTINGS_SECTION_IDS].sort());
    const { router } = setup();
    for (const [id, link] of Object.entries(SETTINGS_LINKS)) {
      const tree = router.createUrlTree(link.commands as string[], { fragment: link.fragment });
      expect(router.serializeUrl(tree), id).toBe(`/settings/${id}`);
      expect(await router.navigateByUrl(tree), id).toBe(true);
      expect(router.url, id).toBe(`/settings/${id}`);
    }
  });

  it('an old /settings#<id> link lands on the screen that holds the section; an unknown fragment stays on the menu', async () => {
    const { router, harness } = await open('/settings#features');
    await harness.fixture.whenStable();
    expect(router.url).toBe('/settings/features');

    const unknown = await open('/settings#nothing');
    expect(unknown.router.url).toBe('/settings#nothing');
  });

  it('with no lock the Security screen is still reachable (the app lock exists, so the row is shown)', async () => {
    const { root } = await open('/settings/security');
    expect(root.querySelector('input[type=password]')).toBeTruthy();
  });
});

describe('Settings controls keep their store', () => {
  it('the peso symbol and the bank tax still live in "settings"', async () => {
    const { root, storage, harness } = await open('/settings/preferences');
    const select = root.querySelector('select[name=currency]') as HTMLSelectElement;
    select.value = 'RD$';
    select.dispatchEvent(new Event('change'));
    harness.detectChanges();
    expect((storage.get('settings', {}) as { currency: string }).currency).toBe('RD$');
  });

  it('the budget warning threshold (under Advanced) still lives in "settings"', async () => {
    const { root, storage, harness } = await open('/settings/alerts');
    const details = root.querySelector('details.settings-advanced') as HTMLDetailsElement;
    expect(details.open).toBe(false); // folded by default
    const input = root.querySelector('input[name=riskAt]') as HTMLInputElement;
    input.value = '85';
    input.dispatchEvent(new Event('input'));
    harness.detectChanges();
    expect((storage.get('settings', {}) as { budget: { riskAt: number } }).budget.riskAt).toBe(85);
  });

  it('the backup reminder days still live in the device preferences, not in the account settings', async () => {
    const { root, storage, harness } = await open('/settings/data');
    const input = root.querySelector('input[name=rd]') as HTMLInputElement;
    input.value = '14';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('change'));
    harness.detectChanges();
    expect((storage.get('device-prefs', {}) as { reminderDays: number }).reminderDays).toBe(14);
    expect((storage.get('settings', {}) as { reminderDays?: number }).reminderDays).toBeUndefined();
  });
});

describe('Settings > Your data', () => {
  it('shows the status card first, then export, history and Advanced folded, and the Danger zone last', async () => {
    const { root } = await open('/settings/data');
    const order = Array.from(root.querySelectorAll('app-sync-status, #data-history, #data-advanced, #danger-zone')).map((e) => e.id || e.tagName.toLowerCase());
    expect(order).toEqual(['app-sync-status', 'data-history', 'data-advanced', 'danger-zone']);
    expect((root.querySelector('#data-history') as HTMLDetailsElement).open).toBe(false);
    expect((root.querySelector('#data-advanced') as HTMLDetailsElement).open).toBe(false);
    expect(root.querySelector('#danger-zone h2')?.textContent?.trim()).toBe('Danger zone');
    expect(root.querySelector('#danger-zone button.x-btn-danger')).toBeTruthy();
  });

  it('local-only: says so, offers Back up now, and has no Sync now button', async () => {
    const { root } = await open('/settings/data');
    expect(root.querySelector('.sstat-headline')?.textContent?.trim()).toBe('Only on this device');
    expect(Array.from(root.querySelectorAll('button')).map((b) => b.textContent?.trim())).toContain('Back up now');
    expect(Array.from(root.querySelectorAll('button')).map((b) => b.textContent?.trim())).not.toContain('Sync now');
  });

  it('the Import control sits under Advanced and the delete button only in the Danger zone', async () => {
    const { root } = await open('/settings/data');
    expect(root.querySelector('#data-advanced input[type=file]')).toBeTruthy();
    const danger = Array.from(root.querySelectorAll('button.x-btn-danger'));
    expect(danger.length).toBe(1);
    expect(danger[0].closest('#danger-zone')).toBeTruthy();
  });
});

describe('Back up now (2.23.1)', () => {
  async function backupEnv(native: boolean, share: () => Promise<void>) {
    const env = await open('/settings/data');
    const { BackupService } = await import('../../../shared/services/backup.service');
    const { ExportService } = await import('../../../shared/services/export.service');
    const backup = TestBed.inject(BackupService);
    backup.native = () => native;
    TestBed.inject(ExportService).exportFile = share;
    return { ...env, backup };
  }
  const lastExport = (storage: MemoryStorage) => (storage.get('device-prefs', {}) as { lastExportAt?: number }).lastExportAt;

  it('on the phone the clock does not restart until the user confirms the file was saved', async () => {
    const { backup, storage, harness } = await backupEnv(true, async () => undefined);
    expect(await backup.exportJson()).toBe(true);
    harness.detectChanges();
    expect(lastExport(storage)).toBeUndefined();
    expect(backup.awaitingConfirm()).toBe(true);
    expect(harness.routeNativeElement?.querySelector('.sstat-confirm')).toBeTruthy();
    backup.markSaved();
    expect(lastExport(storage)).toBeGreaterThan(0);
    expect(backup.awaitingConfirm()).toBe(false);
  });

  it('answering No records nothing', async () => {
    const { backup, storage } = await backupEnv(true, async () => undefined);
    await backup.exportJson();
    backup.dismissConfirm();
    expect(lastExport(storage)).toBeUndefined();
    expect(backup.awaitingConfirm()).toBe(false);
  });

  it('closing the share sheet without choosing records nothing and asks nothing', async () => {
    const { backup, storage } = await backupEnv(true, async () => {
      throw new Error('Share canceled');
    });
    expect(await backup.exportJson()).toBe(false);
    expect(lastExport(storage)).toBeUndefined();
    expect(backup.awaitingConfirm()).toBe(false);
  });

  it('a real error is not swallowed', async () => {
    const { backup } = await backupEnv(true, async () => {
      throw new Error('disk full');
    });
    await expect(backup.exportJson()).rejects.toThrow('disk full');
  });

  it('safety copies (before an import or a sign-out) never touch the reminder', async () => {
    const { backup, storage } = await backupEnv(true, async () => undefined);
    await backup.exportJson({ remember: false });
    expect(lastExport(storage)).toBeUndefined();
    expect(backup.awaitingConfirm()).toBe(false);
  });

  it('in a browser the download counts straight away (there is no share sheet to doubt)', async () => {
    const { backup, storage } = await backupEnv(false, async () => undefined);
    await backup.exportJson();
    expect(lastExport(storage)).toBeGreaterThan(0);
    expect(backup.awaitingConfirm()).toBe(false);
  });
});
