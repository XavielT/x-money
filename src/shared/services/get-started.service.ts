import { Injectable, computed, signal } from '@angular/core';
import { DEFAULT_ACCOUNTS_MOCK } from '../data/default-accounts';
import { GetStartedState, getStarted, ownAccountCount } from '../domain/get-started';
import { AccountService } from './account.service';
import { ModuleService } from './module.service';
import { StorageService } from './storage.service';
import { TransactionService } from './transaction.service';

interface DevicePrefs {
  getStartedHidden?: boolean;
  getStartedSkipped?: boolean;
}

// "Get started" card of Home. Hide and Skip are device preferences ('device-prefs'), not synced data.
@Injectable({ providedIn: 'root' })
export class GetStartedService {
  private _hidden = signal(false);
  private _skipped = signal(false);

  state = computed<GetStartedState>(() =>
    getStarted({
      accounts: this.accounts.accounts().length,
      ownAccounts: ownAccountCount(this.accounts.accounts(), DEFAULT_ACCOUNTS_MOCK),
      movements: this.transactions.transactions().length,
      modulesTouched: this.modules.touched(),
      skipped: this._skipped(),
      hidden: this._hidden(),
    })
  );

  constructor(
    private storage: StorageService,
    private accounts: AccountService,
    private transactions: TransactionService,
    private modules: ModuleService
  ) {
    const prefs = this.storage.get<DevicePrefs>('device-prefs', {});
    this._hidden.set(!!prefs.getStartedHidden);
    this._skipped.set(!!prefs.getStartedSkipped);
  }

  hide(): void {
    this._hidden.set(true);
    this.persist();
  }

  skip(): void {
    this._skipped.set(true);
    this.persist();
  }

  private persist(): void {
    this.storage.set('device-prefs', { ...this.storage.get<DevicePrefs>('device-prefs', {}), getStartedHidden: this._hidden(), getStartedSkipped: this._skipped() });
  }
}
