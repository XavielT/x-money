import { Injectable } from '@angular/core';
import { TransactionKind } from '../models/transaction.model';
import { StorageService } from './storage.service';

interface DevicePrefs {
  lastAccountByType?: Partial<Record<TransactionKind, string>>; // optional: an old install simply has none
  [key: string]: unknown; // the other owners of device-prefs (backup reminder, card alerts...) are kept as they are
}

// The account the user used last for each kind of movement, so the next one starts there. Device-only preference.
@Injectable({ providedIn: 'root' })
export class LastAccountService {
  constructor(private storage: StorageService) {}

  get(type: TransactionKind): string | undefined {
    return this.storage.get<DevicePrefs>('device-prefs', {}).lastAccountByType?.[type];
  }

  set(type: TransactionKind, accountId: string): void {
    const prefs = this.storage.get<DevicePrefs>('device-prefs', {});
    if (prefs.lastAccountByType?.[type] === accountId) return;
    this.storage.set<DevicePrefs>('device-prefs', { ...prefs, lastAccountByType: { ...prefs.lastAccountByType, [type]: accountId } });
  }

  // The remembered account when it can still be used, else the first usable one
  pick(type: TransactionKind, usableIds: readonly string[]): string {
    const last = this.get(type);
    return last && usableIds.includes(last) ? last : usableIds[0] ?? '';
  }
}
