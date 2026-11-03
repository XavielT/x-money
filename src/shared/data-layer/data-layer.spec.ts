import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { diffCollection } from './diff';
import { countLocal, countsMatch, decideLink, isPristine } from './link';
import { LocalDb, MemoryLocalDb, StoreName } from './local-db';
import { DEVICE_ONLY_KEYS, SYNCED_COLLECTIONS, isKnownKey, isSyncedKey } from './registry';
import { StorageService } from '../services/storage.service';
import { DEFAULT_ACCOUNTS_MOCK } from '../data/default-accounts';
import { DEFAULT_CATEGORIES_MOCK } from '../data/default-categories';
import { AccountService } from '../services/account.service';
import { TransactionService } from '../services/transaction.service';
import { MemoryStorage, boot } from '../testing/memory-storage';
import { FIXTURE_251, FakeLegacy, asLegacy } from '../testing/fixtures';

describe('registry', () => {
  it('every key the services use is registered as synced or device-only', () => {
    const used = ['accounts', 'transactions', 'categories', 'budgets', 'recurring', 'settings', 'lang', 'lock', 'device-prefs', 'conflicts'];
    for (const key of used) expect(isKnownKey(key), key).toBe(true);
  });

  it('keeps the PIN and local preferences device-only, everything financial synced', () => {
    expect(DEVICE_ONLY_KEYS).toEqual(expect.arrayContaining(['lock', 'device-prefs']));
    expect(isSyncedKey('lock')).toBe(false);
    for (const key of ['accounts', 'transactions', 'categories', 'budgets', 'recurring', 'settings', 'lang']) {
      expect(key in SYNCED_COLLECTIONS, key).toBe(true);
    }
  });

  it('reports an unregistered key instead of silently syncing it', () => {
    const storage = new StorageService();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    storage.set('mystery', [1]);
    expect(error).toHaveBeenCalled();
    expect(isSyncedKey('mystery')).toBe(false);
    error.mockRestore();
  });
});

describe('diffCollection', () => {
  const a = { id: 'a', amount: 1 };
  const b = { id: 'b', amount: 2 };

  it('emits add, edit and delete per record', () => {
    const ops = diffCollection('transactions', [a, b], [{ id: 'a', amount: 9 }, { id: 'c', amount: 3 }]);
    expect(ops.map((o) => [o.id, o.deleted])).toEqual([['a', false], ['c', false], ['b', true]]);
    expect(ops[0].data).toEqual({ id: 'a', amount: 9 });
  });

  it('emits nothing when a collection is rewritten unchanged or only reordered', () => {
    expect(diffCollection('transactions', [a, b], [a, b])).toEqual([]);
    expect(diffCollection('transactions', [a, b], [b, a])).toEqual([]);
    expect(diffCollection('transactions', [{ id: 'x', p: 1, q: 2 }], [{ q: 2, p: 1, id: 'x' }])).toEqual([]);
    expect(diffCollection('transactions', [], [])).toEqual([]);
    expect(diffCollection('transactions', undefined, undefined)).toEqual([]);
  });

  it('handles a collection created from nothing and emptied completely', () => {
    expect(diffCollection('budgets', undefined, [a])).toHaveLength(1);
    expect(diffCollection('budgets', [a, b], [])).toHaveLength(2);
  });

  it('treats settings and language as one document each', () => {
    expect(diffCollection('settings', { currency: '$' }, { currency: 'RD$' })).toEqual([
      { collection: 'settings', id: 'doc', deleted: false, data: { value: { currency: 'RD$' } } },
    ]);
    expect(diffCollection('lang', 'es', 'es')).toEqual([]);
    expect(diffCollection('lang', 'es', undefined)[0].deleted).toBe(true);
  });

  it('skips items without a valid id and never syncs device-only keys', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(diffCollection('transactions', [], [{ amount: 1 }, { id: 'bad id!', amount: 2 }, a])).toHaveLength(1);
    expect(diffCollection('lock', undefined, 'hash')).toEqual([]);
    warn.mockRestore();
  });
});

describe('first-sync decisions', () => {
  const fresh = { accounts: DEFAULT_ACCOUNTS_MOCK, categories: DEFAULT_CATEGORIES_MOCK };
  const serverWith = (n: number) => ({ transactions: n });

  it('a fresh install (only seeded defaults) is pristine', () => {
    expect(isPristine({})).toBe(true);
    expect(isPristine(fresh)).toBe(true);
  });

  it('any user data makes the device non-pristine', () => {
    expect(isPristine({ ...fresh, transactions: [{ id: 't' }] })).toBe(false);
    expect(isPristine({ ...fresh, budgets: [{ id: 'b' }] })).toBe(false);
    expect(isPristine({ ...fresh, accounts: [{ ...DEFAULT_ACCOUNTS_MOCK[0], initialBalance: 5 }] })).toBe(false);
    expect(isPristine({ ...fresh, categories: [...DEFAULT_CATEGORIES_MOCK, { id: 'custom-1', name: 'x' }] })).toBe(false);
  });

  it('chooses the right path for each combination', () => {
    expect(decideLink(fresh, {})).toBe('link-empty');
    expect(decideLink(FIXTURE_251, {})).toBe('upload');
    expect(decideLink(fresh, serverWith(3))).toBe('download');
    expect(decideLink(FIXTURE_251, serverWith(3))).toBe('choose');
  });

  it('ignores conflicts bookkeeping when deciding', () => {
    expect(decideLink(fresh, { conflicts: 4 })).toBe('link-empty');
  });

  it('verifies uploads by comparing counts', () => {
    const local = countLocal(FIXTURE_251);
    expect(local).toMatchObject({ accounts: 3, transactions: 4, categories: 1, budgets: 1, recurring: 0 });
    expect(countsMatch(local, { accounts: 3, transactions: 4, categories: 1, budgets: 1, conflicts: 9 })).toBe(true);
    expect(countsMatch(local, { accounts: 3, transactions: 3, categories: 1, budgets: 1 })).toBe(false);
  });
});

describe('StorageService: migration from 2.5.1', () => {
  it('moves every legacy key into IndexedDB, verifies it, then archives the old copy', async () => {
    const legacy = asLegacy(FIXTURE_251);
    const local = new MemoryLocalDb();
    const storage = new StorageService();
    await storage.hydrate({ local, legacy });

    for (const [key, value] of Object.entries(FIXTURE_251)) {
      expect(storage.get(key, null), key).toEqual(value);
      expect(await local.get('kv', key), key).toEqual(value);
    }
    expect(await local.get('device', 'migrated')).toBeTruthy();
    expect(legacy.archived.sort()).toEqual(Object.keys(FIXTURE_251).sort());
  });

  it('does not import again on later starts, even if the old copy changed', async () => {
    const local = new MemoryLocalDb();
    await new StorageService().hydrate({ local, legacy: asLegacy(FIXTURE_251) });
    const second = new StorageService();
    await second.hydrate({ local, legacy: asLegacy({ transactions: [], accounts: [] }) });
    expect(second.get<unknown[]>('transactions', [])).toHaveLength(4);
  });

  it('keeps working from the legacy values and retries next start if the verified copy fails', async () => {
    const legacy = asLegacy(FIXTURE_251);
    class BrokenDb extends MemoryLocalDb {
      override async put(store: StoreName, key: string, value: unknown) {
        if (store === 'kv') throw new Error('disk full');
        return super.put(store, key, value);
      }
    }
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const local: LocalDb = new BrokenDb();
    const storage = new StorageService();
    await storage.hydrate({ local, legacy });
    expect(storage.get<unknown[]>('transactions', [])).toHaveLength(4); // app still has its data
    expect(await local.get('device', 'migrated')).toBeUndefined(); // not confirmed
    expect(legacy.archived).toEqual([]); // old copy untouched
    error.mockRestore();
  });

  it('leaves unknown or malformed legacy keys alone', async () => {
    const legacy = new FakeLegacy({ transactions: '[{"id":"t"', accounts: '[]', other: '1' });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const storage = new StorageService();
    await storage.hydrate({ local: new MemoryLocalDb(), legacy });
    expect(storage.get('transactions', 'fallback')).toBe('fallback');
    expect(legacy.archived).toEqual(['accounts']);
    error.mockRestore();
  });

  it('a fresh install with nothing legacy starts empty', async () => {
    const storage = new StorageService();
    await storage.hydrate({ local: new MemoryLocalDb(), legacy: new FakeLegacy() });
    expect(storage.get('transactions', [])).toEqual([]);
  });

  it('writes persist to the local copy and survive a restart', async () => {
    const local = new MemoryLocalDb();
    const first = new StorageService();
    await first.hydrate({ local, legacy: new FakeLegacy() });
    first.set('budgets', [{ id: 'b', categoryId: 'cat-food', monthlyLimit: 5 }]);
    await first.flush();
    const second = new StorageService();
    await second.hydrate({ local, legacy: new FakeLegacy() });
    expect(second.get<unknown[]>('budgets', [])).toHaveLength(1);
  });

  it('is read-only when the app is older than the server schema', async () => {
    const storage = new StorageService();
    await storage.hydrate({ local: new MemoryLocalDb(), legacy: new FakeLegacy() });
    storage.readOnly.set(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    storage.set('budgets', [{ id: 'b' }]);
    expect(storage.get('budgets', [])).toEqual([]);
    warn.mockRestore();
  });

  it('returns copies: mutating what get() returned never changes the stored value', async () => {
    const storage = new StorageService();
    await storage.hydrate({ local: new MemoryLocalDb(), legacy: new FakeLegacy() });
    storage.set('budgets', [{ id: 'b', monthlyLimit: 1 }]);
    storage.get<{ monthlyLimit: number }[]>('budgets', [])[0].monthlyLimit = 99;
    expect(storage.get<{ monthlyLimit: number }[]>('budgets', [])[0].monthlyLimit).toBe(1);
  });
});

describe('no regression: balances before and after the data layer', () => {
  function figures(s: ReturnType<typeof boot>) {
    const t = s.transactions;
    return {
      total: t.totalBalance(),
      totalUsd: t.totalBalanceUsd(),
      cash: t.accountBalance('a-cash'),
      bank: t.accountBalance('a-bank'),
      usd: t.accountBalance('a-usd', 'USD'),
      month: t.monthSummary(2026, 11),
      cats: t.categoryTotals(2026, 11, 'expense'),
    };
  }

  it('the 2.5.1 fixture gives identical numbers through the old and the new storage', async () => {
    const before = figures(boot(new MemoryStorage().seed(FIXTURE_251)));

    const storage = new StorageService();
    await storage.hydrate({ local: new MemoryLocalDb(), legacy: asLegacy(FIXTURE_251) });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: StorageService, useValue: storage }] });
    const after = {
      total: TestBed.inject(TransactionService).totalBalance(),
      totalUsd: TestBed.inject(TransactionService).totalBalanceUsd(),
      cash: TestBed.inject(TransactionService).accountBalance('a-cash'),
      bank: TestBed.inject(TransactionService).accountBalance('a-bank'),
      usd: TestBed.inject(TransactionService).accountBalance('a-usd', 'USD'),
      month: TestBed.inject(TransactionService).monthSummary(2026, 11),
      cats: TestBed.inject(TransactionService).categoryTotals(2026, 11, 'expense'),
    };
    expect(after).toEqual(before);
    expect(TestBed.inject(AccountService).accounts()[0].type).toBe('cash'); // migrations still run
  });
});
