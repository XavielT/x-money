import { Injectable, computed, signal } from '@angular/core';
import { StorageService } from './storage.service';

interface DevicePrefs {
  lastExportAt?: number;
  reminderDays?: number;
  cardAlerts?: boolean; // owned by CardNoticeService
  backupSnoozedUntil?: number; // "Later": no backup reminder until then (survives a restart)
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const SNOOZE_DAYS = 7;

// "It has been N days since you exported a backup". Device-only preference.
@Injectable({ providedIn: 'root' })
export class BackupReminderService {
  private _lastExportAt = signal<number | null>(null);
  private _days = signal(30);
  private _now = signal(Date.now());
  private _snoozedUntil = signal<number | null>(null);

  lastExportAt = this._lastExportAt.asReadonly();
  reminderDays = this._days.asReadonly();

  // Days since the last export, or null when there never was one
  daysSince = computed(() => {
    const last = this._lastExportAt();
    return last === null ? null : Math.floor((this._now() - last) / DAY_MS);
  });

  snoozedUntil = this._snoozedUntil.asReadonly();

  // true when a backup is overdue AND the user has not asked to be reminded later
  due = computed(() => {
    const until = this._snoozedUntil();
    if (until !== null && this._now() < until) return false;
    const days = this.daysSince();
    return days === null || days >= this._days();
  });

  constructor(private storage: StorageService) {
    const prefs = this.storage.get<DevicePrefs>('device-prefs', {});
    this._lastExportAt.set(prefs.lastExportAt ?? null);
    this._days.set(prefs.reminderDays ?? 30);
    this._snoozedUntil.set(prefs.backupSnoozedUntil ?? null);
  }

  // the clock the reminder reads is a signal: call this when the screen that shows it opens
  refreshClock(): void {
    this._now.set(Date.now());
  }

  // "Later": stay quiet for a week
  snooze(): void {
    this._now.set(Date.now());
    this._snoozedUntil.set(this._now() + SNOOZE_DAYS * DAY_MS);
    this.persist();
  }

  markExported(): void {
    this._lastExportAt.set(Date.now());
    this._now.set(Date.now());
    this._snoozedUntil.set(null); // the counter restarts; a snooze from before no longer means anything
    this.persist();
  }

  setDays(days: number): void {
    if (!Number.isInteger(days) || days < 1 || days > 365) return;
    this._days.set(days);
    this.persist();
  }

  private persist(): void {
    this.storage.set<DevicePrefs>('device-prefs', {
      ...this.storage.get<DevicePrefs>('device-prefs', {}),
      lastExportAt: this._lastExportAt() ?? undefined,
      reminderDays: this._days(),
      backupSnoozedUntil: this._snoozedUntil() ?? undefined,
    });
  }
}
