import { Injectable, computed, signal } from '@angular/core';
import { StorageService } from './storage.service';

interface DevicePrefs {
  lastExportAt?: number;
  reminderDays?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// "It has been N days since you exported a backup". Device-only preference.
@Injectable({ providedIn: 'root' })
export class BackupReminderService {
  private _lastExportAt = signal<number | null>(null);
  private _days = signal(30);
  private _now = signal(Date.now());

  lastExportAt = this._lastExportAt.asReadonly();
  reminderDays = this._days.asReadonly();

  // Days since the last export, or null when there never was one
  daysSince = computed(() => {
    const last = this._lastExportAt();
    return last === null ? null : Math.floor((this._now() - last) / DAY_MS);
  });

  due = computed(() => {
    const days = this.daysSince();
    return days === null || days >= this._days();
  });

  constructor(private storage: StorageService) {
    const prefs = this.storage.get<DevicePrefs>('device-prefs', {});
    this._lastExportAt.set(prefs.lastExportAt ?? null);
    this._days.set(prefs.reminderDays ?? 30);
  }

  markExported(): void {
    this._lastExportAt.set(Date.now());
    this._now.set(Date.now());
    this.persist();
  }

  setDays(days: number): void {
    if (!Number.isInteger(days) || days < 1 || days > 365) return;
    this._days.set(days);
    this.persist();
  }

  private persist(): void {
    this.storage.set<DevicePrefs>('device-prefs', {
      lastExportAt: this._lastExportAt() ?? undefined,
      reminderDays: this._days(),
    });
  }
}
