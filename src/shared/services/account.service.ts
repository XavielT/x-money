import { Injectable, signal } from '@angular/core';
import { AccountModel, AccountType } from '../models/account.model';
import { DEFAULT_ACCOUNTS_MOCK } from '../data/default-accounts';
import { StorageService } from './storage.service';

const TYPE_ICONS: Record<AccountType, string> = {
  cash: '💵',
  bank: '🏦',
  card: '💳',
  savings: '💰',
};

@Injectable({ providedIn: 'root' })
export class AccountService {
  private _accounts = signal<AccountModel[]>([]);
  accounts = this._accounts.asReadonly();

  constructor(private storage: StorageService) {
    const saved = this.storage.get<AccountModel[]>('accounts', []);
    if (saved.length) {
      // Migrations: pre-v2.1 accounts have no type (infer from icon);
      // pre-v2.2 cards have no credit/debit kind (default to debit)
      let migrated = false;
      const withTypes = saved.map((a) => {
        let account = a;
        if (!account.type) {
          migrated = true;
          account = { ...account, type: this.typeFromIcon(account.icon) };
        }
        if (account.type === 'card' && !account.cardKind) {
          migrated = true;
          account = { ...account, cardKind: 'debit' };
        }
        return account;
      });
      this._accounts.set(withTypes);
      if (migrated) this.persist();
    } else {
      this._accounts.set(DEFAULT_ACCOUNTS_MOCK);
      this.persist();
    }
  }

  byId(id: string): AccountModel | undefined {
    return this._accounts().find((a) => a.id === id);
  }

  iconForType(type: AccountType): string {
    return TYPE_ICONS[type];
  }

  add(data: Omit<AccountModel, 'id' | 'icon'>): void {
    const account: AccountModel = {
      ...data,
      id: crypto.randomUUID(),
      icon: TYPE_ICONS[data.type],
    };
    this._accounts.update((list) => [...list, account]);
    this.persist();
  }

  update(account: AccountModel): void {
    const withIcon = { ...account, icon: TYPE_ICONS[account.type] ?? account.icon };
    this._accounts.update((list) => list.map((a) => (a.id === account.id ? withIcon : a)));
    this.persist();
  }

  remove(id: string): void {
    this._accounts.update((list) => list.filter((a) => a.id !== id));
    this.persist();
  }

  private typeFromIcon(icon: string): AccountType {
    if (icon === '💳') return 'card';
    if (icon === '🏦') return 'bank';
    if (icon === '💰' || icon === '🪙') return 'savings';
    return 'cash';
  }

  private persist(): void {
    this.storage.set('accounts', this._accounts());
  }
}
