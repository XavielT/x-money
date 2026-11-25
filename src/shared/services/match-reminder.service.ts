import { Injectable, computed, signal } from '@angular/core';
import { MatchDue, accountsToMatch } from '../domain/match-due';
import { AccountService } from './account.service';
import { StorageService } from './storage.service';
import { TransactionService } from './transaction.service';

interface DevicePrefs {
  matchSnoozedUntil?: number; // "Later": no bank-match reminder until then (survives a restart)
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const MATCH_SNOOZE_DAYS = 7;

// "It has been a month since you matched this account with your bank". Device-only, never changes data.
@Injectable({ providedIn: 'root' })
export class MatchReminderService {
  private _now = signal(Date.now());
  private _snoozedUntil = signal<number | null>(null);

  due = computed<MatchDue[]>(() => {
    const until = this._snoozedUntil();
    if (until !== null && this._now() < until) return [];
    return accountsToMatch(this.accounts.accounts(), this.transactions.transactions(), new Date(this._now()));
  });

  constructor(private storage: StorageService, private accounts: AccountService, private transactions: TransactionService) {
    this._snoozedUntil.set(this.storage.get<DevicePrefs>('device-prefs', {}).matchSnoozedUntil ?? null);
  }

  refreshClock(): void {
    this._now.set(Date.now());
  }

  snooze(): void {
    this._now.set(Date.now());
    this._snoozedUntil.set(this._now() + MATCH_SNOOZE_DAYS * DAY_MS);
    this.storage.set<DevicePrefs>('device-prefs', { ...this.storage.get<DevicePrefs>('device-prefs', {}), matchSnoozedUntil: this._snoozedUntil() ?? undefined });
  }
}
