import { Injectable, computed, signal } from '@angular/core';
import { AccountModel, AccountType } from '../models/account.model';
import { DEFAULT_ACCOUNTS_MOCK } from '../data/default-accounts';
import { StorageService } from './storage.service';
import { AuditLogService } from './audit-log.service';
import { defaultLiquid } from '../domain/networth';

const TYPE_ICONS: Record<AccountType, string> = {
  cash: '💵',
  bank: '🏦',
  card: '💳',
  savings: '💰',
  other: '🏷️',
};

@Injectable({ providedIn: 'root' })
export class AccountService {
  private _accounts = signal<AccountModel[]>([]);
  accounts = this._accounts.asReadonly();

  // Not archived: what selectors and totals show
  activeAccounts = computed(() => this._accounts().filter((a) => !a.archived));

  constructor(
    private storage: StorageService,
    private audit: AuditLogService
  ) {
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
        if (!account.currency) {
          migrated = true;
          account = { ...account, currency: 'DOP' };
        }
        if (account.liquid === undefined) {
          migrated = true;
          account = { ...account, liquid: defaultLiquid(account.type) };
        }
        return account;
      });
      this._accounts.set(withTypes);
      if (migrated) this.persist();
    } else {
      this._accounts.set(DEFAULT_ACCOUNTS_MOCK);
      this.persist();
    }
    this.storage.watch('accounts', (v) => this._accounts.set((v as AccountModel[] | undefined) ?? []));
  }

  byId(id: string): AccountModel | undefined {
    return this._accounts().find((a) => a.id === id);
  }

  // Linked debit cards spend the money of their bank account: balances of the
  // card's transactions belong to the linked account
  effectiveOwnerId(accountId: string): string {
    const account = this.byId(accountId);
    return account?.linkedAccountId && this.byId(account.linkedAccountId)
      ? account.linkedAccountId
      : accountId;
  }

  // Accounts a debit card can link to
  linkableAccounts(excludeId?: string): AccountModel[] {
    return this._accounts().filter((a) => a.type === 'bank' && !a.archived && a.id !== excludeId);
  }

  iconForType(type: AccountType): string {
    return TYPE_ICONS[type];
  }

  add(data: Omit<AccountModel, 'id' | 'icon'> & { icon?: string }): string {
    const account: AccountModel = {
      ...data,
      id: crypto.randomUUID(),
      // "other" accounts carry their own emoji; the rest get the icon of their type
      icon: data.type === 'other' ? data.icon?.trim() || TYPE_ICONS.other : TYPE_ICONS[data.type],
      liquid: data.liquid ?? defaultLiquid(data.type),
    };
    this._accounts.update((list) => [...list, account]);
    this.persist();
    return account.id;
  }

  update(account: AccountModel): void {
    const withIcon = { ...account, icon: account.type === 'other' ? account.icon || TYPE_ICONS.other : TYPE_ICONS[account.type] ?? account.icon };
    this._accounts.update((list) => list.map((a) => (a.id === account.id ? withIcon : a)));
    this.persist();
  }

  // Accounts with movements are archived instead of deleted: hidden from selectors and
  // totals, history kept. Use TransactionService.canDeleteAccount before remove().
  setArchived(id: string, archived: boolean): void {
    const account = this.byId(id);
    if (!account) return;
    this._accounts.update((list) => list.map((a) => (a.id === id ? { ...a, archived: archived || undefined } : a)));
    this.persist();
    this.audit.log({
      type: archived ? 'account-archive' : 'account-unarchive',
      entity: 'account',
      entityId: id,
      accountId: id,
      after: { name: account.name },
    });
  }

  setReconciledAt(id: string, date: string): void {
    this._accounts.update((list) => list.map((a) => (a.id === id ? { ...a, reconciledAt: date } : a)));
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
