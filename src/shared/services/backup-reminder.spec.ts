// "Time to back up": due after the interval, "Later" quiets it for 7 days (kept across a restart), exporting resets it, and
// it shows on Home only, never in the global banner.
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupReminderComponent } from '../components/backup-reminder/backup-reminder';
import { SyncBannerComponent } from '../components/sync-banner/sync-banner';
import { account, transaction } from '../testing/builders';
import { MemoryStorage, boot } from '../testing/memory-storage';
import { BackupReminderService } from './backup-reminder.service';

const DAY = 24 * 60 * 60 * 1000;
const seed = { accounts: [account({ id: 'a1' })], transactions: [transaction({ id: 't1', accountId: 'a1' })] };

function session(storage = new MemoryStorage().seed(seed)) {
  boot(storage);
  return { storage, reminder: TestBed.inject(BackupReminderService) };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-09T12:00:00'));
});
afterEach(() => vi.useRealTimers());

describe('backup reminder: snooze', () => {
  it('never exported: due; "Later" makes it not due', () => {
    const { reminder } = session();
    expect(reminder.due()).toBe(true);
    reminder.snooze();
    expect(reminder.due()).toBe(false);
  });

  it('the snooze survives a restart and ends after 7 days', () => {
    const { storage, reminder } = session();
    reminder.snooze();
    vi.setSystemTime(Date.now() + 6 * DAY);
    const again = session(storage as MemoryStorage).reminder;
    expect(again.due()).toBe(false);
    vi.setSystemTime(Date.now() + 2 * DAY); // day 8
    again.refreshClock();
    expect(again.due()).toBe(true);
  });

  it('exporting during the snooze restarts the counter as before and clears the snooze', () => {
    const { storage, reminder } = session();
    reminder.snooze();
    reminder.markExported();
    expect(reminder.snoozedUntil()).toBeNull();
    expect(reminder.due()).toBe(false);
    expect(session(storage as MemoryStorage).reminder.daysSince()).toBe(0);
    vi.setSystemTime(Date.now() + 31 * DAY);
    const later = session(storage as MemoryStorage).reminder;
    expect(later.due()).toBe(true); // 30 days after the export, no old snooze in the way
  });

  it('an old device-prefs without the field loads fine', () => {
    const storage = new MemoryStorage().seed({ ...seed, 'device-prefs': { lastExportAt: Date.now() - 40 * DAY, reminderDays: 30 } });
    const { reminder } = session(storage);
    expect(reminder.snoozedUntil()).toBeNull();
    expect(reminder.due()).toBe(true);
  });

  it('the other device preferences are kept when snoozing', () => {
    const storage = new MemoryStorage().seed({ ...seed, 'device-prefs': { cardAlerts: true, reminderDays: 14 } });
    const { reminder } = session(storage);
    reminder.snooze();
    const saved = storage.get<Record<string, unknown>>('device-prefs', {});
    expect(saved['cardAlerts']).toBe(true);
    expect(saved['reminderDays']).toBe(14);
    expect(typeof saved['backupSnoozedUntil']).toBe('number');
  });
});

describe('backup reminder: where it shows', () => {
  it('the component shows when due, goes to Settings → Your data, and "Later" hides it', () => {
    session();
    const f = TestBed.createComponent(BackupReminderComponent);
    f.detectChanges();
    const root = f.nativeElement as HTMLElement;
    expect(root.querySelector('.bk')).toBeTruthy();
    expect(root.querySelector('a.bk-now')?.getAttribute('href')).toBe('/settings#data');
    (root.querySelector('.bk-later') as HTMLButtonElement).click();
    f.detectChanges();
    expect(root.querySelector('.bk')).toBeNull();
  });

  it('with no movements there is nothing to back up yet: no reminder', () => {
    session(new MemoryStorage().seed({ accounts: [account({ id: 'a1' })], transactions: [] }));
    const f = TestBed.createComponent(BackupReminderComponent);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('.bk')).toBeNull();
  });

  it('the global banner no longer carries it', () => {
    session();
    const f = TestBed.createComponent(SyncBannerComponent);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).textContent).not.toContain('back up');
    expect((f.nativeElement as HTMLElement).textContent).not.toContain('backup');
  });
});
