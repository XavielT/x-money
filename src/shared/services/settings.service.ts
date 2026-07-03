import { Injectable, signal } from '@angular/core';
import { StorageService } from './storage.service';

interface SettingsState {
  currency: string;
}

// Keys that make up a full backup snapshot
const DATA_KEYS = ['categories', 'accounts', 'transactions', 'budgets', 'recurring', 'settings'] as const;

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private _currency = signal<string>('$');
  currency = this._currency.asReadonly();

  constructor(private storage: StorageService) {
    const saved = this.storage.get<SettingsState>('settings', { currency: '$' });
    this._currency.set(saved.currency);
  }

  setCurrency(symbol: string): void {
    this._currency.set(symbol);
    this.storage.set<SettingsState>('settings', { currency: symbol });
  }

  // Full backup as a JSON string (used for the export file)
  exportData(): string {
    const snapshot: Record<string, unknown> = { app: 'x-money', version: 1 };
    for (const key of DATA_KEYS) {
      snapshot[key] = this.storage.get<unknown>(key, null);
    }
    return JSON.stringify(snapshot, null, 2);
  }

  // Restores a backup. Returns false if the file is not a valid X Money backup.
  importData(json: string): boolean {
    try {
      const snapshot = JSON.parse(json) as Record<string, unknown>;
      if (snapshot['app'] !== 'x-money') return false;
      for (const key of DATA_KEYS) {
        if (snapshot[key] != null) this.storage.set(key, snapshot[key]);
      }
      return true;
    } catch {
      return false;
    }
  }

  wipeData(): void {
    this.storage.clearAll();
  }
}
