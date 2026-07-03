import { Injectable, signal } from '@angular/core';
import { AccountModel } from '../models/account.model';
import { DEFAULT_ACCOUNTS_MOCK } from '../data/default-accounts';
import { StorageService } from './storage.service';

@Injectable({ providedIn: 'root' })
export class AccountService {
  private _accounts = signal<AccountModel[]>([]);
  accounts = this._accounts.asReadonly();

  constructor(private storage: StorageService) {
    const saved = this.storage.get<AccountModel[]>('accounts', []);
    if (saved.length) {
      this._accounts.set(saved);
    } else {
      this._accounts.set(DEFAULT_ACCOUNTS_MOCK);
      this.persist();
    }
  }

  byId(id: string): AccountModel | undefined {
    return this._accounts().find((a) => a.id === id);
  }

  add(name: string, icon: string, initialBalance: number): void {
    const account: AccountModel = { id: crypto.randomUUID(), name, icon, initialBalance };
    this._accounts.update((list) => [...list, account]);
    this.persist();
  }

  update(account: AccountModel): void {
    this._accounts.update((list) => list.map((a) => (a.id === account.id ? account : a)));
    this.persist();
  }

  remove(id: string): void {
    this._accounts.update((list) => list.filter((a) => a.id !== id));
    this.persist();
  }

  private persist(): void {
    this.storage.set('accounts', this._accounts());
  }
}
