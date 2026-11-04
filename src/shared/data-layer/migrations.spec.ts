import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { MIGRATIONS, Migration, migrateRecord, migrateSnapshot } from './migrations';
import { parseBackup } from './backup';
import { isSyncedKey } from './registry';
import { MemoryLocalDb } from './local-db';
import { StorageService } from '../services/storage.service';
import { MigrationService } from '../services/migration.service';
import { AccountService } from '../services/account.service';
import { TransactionService } from '../services/transaction.service';
import { FIXTURE_251_FULL, FakeLegacy, asLegacy } from '../testing/fixtures';

async function installed(values: Record<string, unknown>, local = new MemoryLocalDb()) {
  const storage = new StorageService();
  await storage.hydrate({ local, legacy: asLegacy(values) });
  return { storage, local };
}

function services(storage: StorageService) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: StorageService, useValue: storage }] });
  return { migration: TestBed.inject(MigrationService), accounts: () => TestBed.inject(AccountService), tx: () => TestBed.inject(TransactionService) };
}

describe('schema v2 migration (per record)', () => {
  it('gives movements an explicit origin and status, and nothing else', () => {
    expect(migrateRecord('transactions', { id: 'a', type: 'expense', amount: 5 }, 1)).toEqual({ id: 'a', type: 'expense', amount: 5, origin: 'manual', status: 'posted' });
    expect(migrateRecord('transactions', { id: 'b', type: 'transfer', amount: 5 }, 1)).toMatchObject({ origin: 'transfer', status: 'posted' });
  });

  it('is idempotent and never overwrites existing values', () => {
    const once = migrateRecord('transactions', { id: 'a', type: 'expense', amount: 5, origin: 'recurring', status: 'reversed' }, 1);
    expect(once).toMatchObject({ origin: 'recurring', status: 'reversed' });
    const twice = migrateRecord('transactions', once, 1);
    expect(twice).toEqual(once);
    expect(migrateRecord('transactions', { id: 'a', type: 'expense', amount: 5 }, 2)).toEqual({ id: 'a', type: 'expense', amount: 5 }); // already v2: untouched
  });

  it('sets the liquid flag of accounts by type, and leaves untyped legacy accounts to AccountService', () => {
    expect(migrateRecord('accounts', { id: 'a', type: 'bank' }, 1)).toMatchObject({ liquid: true });
    expect(migrateRecord('accounts', { id: 'a', type: 'card' }, 1)).toMatchObject({ liquid: false });
    expect(migrateRecord('accounts', { id: 'a', type: 'other' }, 1)).toMatchObject({ liquid: false });
    expect(migrateRecord('accounts', { id: 'a', type: 'savings', liquid: false }, 1)).toMatchObject({ liquid: false });
    expect(migrateRecord('accounts', { id: 'a', icon: '💳' }, 1)).not.toHaveProperty('liquid');
  });

  it('ignores other collections, odd values and the original object', () => {
    const budget = { id: 'b', monthlyLimit: 1 };
    expect(migrateRecord('budgets', budget, 1)).toBe(budget);
    expect(migrateRecord('transactions', null, 1)).toBeNull();
    const tx = { id: 'a', type: 'expense', amount: 1 };
    migrateRecord('transactions', tx, 1);
    expect(tx).toEqual({ id: 'a', type: 'expense', amount: 1 });
  });

  it('migrates a whole 2.5.1 snapshot (dual cards, transfers with fee, recurring, budgets, custom categories)', () => {
    const out = migrateSnapshot(FIXTURE_251_FULL, 1) as Record<string, any[]>;
    expect(out['transactions']).toHaveLength(7);
    expect(out['transactions'].every((t) => t.origin && t.status === 'posted')).toBe(true);
    expect(out['transactions'].find((t) => t.id === 't3').origin).toBe('transfer');
    expect(out['transactions'].find((t) => t.id === 't3').fee).toBe(2); // nothing else changed
    expect(out['accounts'].find((a) => a.id === 'a-visa')).toMatchObject({ liquid: false, currency: 'dual' });
    expect(out['accounts'].find((a) => a.id === 'a-usd')).toMatchObject({ liquid: true });
    expect(out['recurring']).toEqual((FIXTURE_251_FULL['recurring'] as unknown[]));
    expect(out['budgets']).toEqual(FIXTURE_251_FULL['budgets']);
    expect(out['settings']).toEqual(FIXTURE_251_FULL['settings']);
  });

  it('has migrations in strictly increasing order up to the client version', () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual([...new Set(MIGRATIONS.map((m) => m.version))].sort((a, b) => a - b));
  });
});

describe('MigrationService', () => {
  it('migrates an installed 2.6.x copy: snapshot first, then data, version, queue and upload flag', async () => {
    const { storage, local } = await installed(FIXTURE_251_FULL);
    await local.put('device', 'queue', [{ collection: 'transactions', id: 'q1', deleted: false, data: { id: 'q1', type: 'expense', amount: 3, accountId: 'a-bank', date: '2026-11-03' }, schemaVersion: 1, clientUpdatedAt: 1, baseRev: 0, seq: 1 }]);
    const { migration } = services(storage);

    await migration.run();

    expect(storage.get<any[]>('transactions', []).every((t) => t.origin === 'manual' || t.origin === 'transfer')).toBe(true);
    expect(await local.get('device', 'schemaVersion')).toBe(2);
    expect(await local.get('device', 'uploadAfterMigration')).toBe(true);
    const queue = (await local.get<any[]>('device', 'queue'))!;
    expect(queue[0]).toMatchObject({ schemaVersion: 2, data: { origin: 'manual', status: 'posted' } });

    const snapshots = await migration.snapshots();
    expect(snapshots).toHaveLength(1);
    const before = JSON.parse(snapshots[0].json);
    expect(before.transactions[0]).not.toHaveProperty('origin'); // the snapshot is the pre-migration data
    expect(snapshots[0].fromVersion).toBe(1);
    expect(storage.get<any[]>('audit', []).map((e) => e.type)).toContain('migration');
    expect(migration.failure()).toBeNull();
  });

  it('keeps only the two most recent snapshots', async () => {
    const { storage, local } = await installed(FIXTURE_251_FULL);
    const { migration } = services(storage);
    const second: Migration = { version: 3, name: 'noop', record: (_c, item) => item };
    const third: Migration = { version: 4, name: 'noop', record: (_c, item) => item };
    await migration.run(MIGRATIONS, 2);
    await migration.run([...MIGRATIONS, second], 3);
    await migration.run([...MIGRATIONS, second, third], 4);
    const snaps = await migration.snapshots();
    expect(snaps.map((s) => s.fromVersion)).toEqual([2, 3]);
    expect(await local.get('device', 'schemaVersion')).toBe(4);
  });

  it('is idempotent: a second run does nothing', async () => {
    const { storage, local } = await installed(FIXTURE_251_FULL);
    const { migration } = services(storage);
    await migration.run();
    const after = JSON.stringify(storage.snapshotAll());
    await migration.run();
    expect(JSON.stringify(storage.snapshotAll())).toBe(after);
    expect(await migration.snapshots()).toHaveLength(1);
    expect(await local.get('device', 'schemaVersion')).toBe(2);
  });

  it('a fresh install is born current: no snapshot, no migration', async () => {
    const storage = new StorageService();
    await storage.hydrate({ local: new MemoryLocalDb(), legacy: new FakeLegacy() });
    const { migration } = services(storage);
    await migration.run();
    expect(await storage.localDb.get('device', 'schemaVersion')).toBe(2);
    expect(await migration.snapshots()).toEqual([]);
  });

  it('a failing migration restores the old data, blocks sync and says so; nothing is half done', async () => {
    const { storage, local } = await installed(FIXTURE_251_FULL);
    const original = JSON.stringify(storage.snapshotAll());
    const boom: Migration = {
      version: 2,
      name: 'boom',
      record(collection, item) {
        if (collection === 'transactions' && (item as { id: string }).id === 't4') throw new Error('cannot migrate t4');
        return item;
      },
    };
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { migration } = services(storage);

    await migration.run([boom]);

    expect(JSON.stringify(storage.snapshotAll())).toBe(original); // old data untouched
    expect(await local.get('device', 'schemaVersion')).toBeUndefined(); // no version bump
    expect(await local.get('device', 'uploadAfterMigration')).toBeUndefined(); // nothing queued for upload
    expect(storage.syncBlocked()).toBe(true);
    expect(migration.failure()).toContain('cannot migrate t4');
    error.mockRestore();
  });

  it('a write failure in the middle puts every key back as it was', async () => {
    const { storage, local } = await installed(FIXTURE_251_FULL);
    const original = JSON.stringify(storage.snapshotAll());
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const realPut = local.put.bind(local);
    local.put = async (store, key, value) => {
      if (store === 'device' && key === 'schemaVersion') throw new Error('disk full');
      return realPut(store, key, value);
    };
    const { migration } = services(storage);
    await migration.run();
    expect(JSON.stringify(storage.snapshotAll())).toBe(original);
    expect(storage.syncBlocked()).toBe(true);
    error.mockRestore();
  });

  it('the services then read the migrated data and balances do not change', async () => {
    const { storage } = await installed(FIXTURE_251_FULL);
    const before = services(storage);
    const figures = () => [before.tx().totalBalance(), before.tx().totalBalanceUsd(), before.tx().accountBalance('a-bank'), before.tx().accountBalance('a-visa'), before.tx().accountBalance('a-visa', 'USD')];
    const old = figures();
    // fresh services over the migrated data
    await before.migration.run();
    const after = services(storage);
    const migrated = [after.tx().totalBalance(), after.tx().totalBalanceUsd(), after.tx().accountBalance('a-bank'), after.tx().accountBalance('a-visa'), after.tx().accountBalance('a-visa', 'USD')];
    expect(migrated).toEqual(old);
    expect(after.accounts().accounts().find((a) => a.id === 'a-cash')).toMatchObject({ type: 'cash', liquid: true });
  });
});

describe('records from another device and backups of older versions', () => {
  it('a record downloaded in the old shape is migrated when applied', async () => {
    const { storage } = await installed({});
    storage.applyRemote('transactions', [{ id: 'old', data: { id: 'old', type: 'expense', amount: 5, accountId: 'x', date: '2026-11-01' }, schemaVersion: 1 }], []);
    expect(storage.get<any[]>('transactions', [])[0]).toMatchObject({ origin: 'manual', status: 'posted' });
    storage.applyRemote('transactions', [{ id: 'new', data: { id: 'new', type: 'expense', amount: 5, accountId: 'x', date: '2026-11-01' }, schemaVersion: 2 }], []);
    expect(storage.get<any[]>('transactions', [])[1]).not.toHaveProperty('origin'); // already v2: as sent
  });

  it('a 2.5.1 backup is migrated and validated on import (no schema version)', () => {
    const parsed = parseBackup(JSON.stringify({ app: 'x-money', version: 1, ...FIXTURE_251_FULL }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.fromVersion).toBe(1);
    expect(parsed.counts).toEqual({ accounts: 5, transactions: 7, categories: 1, budgets: 1, recurring: 1 });
    expect((parsed.data['transactions'] as any[])[0]).toMatchObject({ origin: 'manual' });
  });

  it('rejects malformed backups with a precise reason', () => {
    const base = { app: 'x-money' };
    expect(parseBackup('nope')).toEqual({ ok: false, error: { code: 'not-json' } });
    expect(parseBackup('[]')).toEqual({ ok: false, error: { code: 'not-xmoney' } });
    expect(parseBackup(JSON.stringify({ ...base, schemaVersion: 7 }))).toEqual({ ok: false, error: { code: 'newer-version', version: 7 } });
    expect(parseBackup(JSON.stringify({ ...base, schemaVersion: 'x' }))).toMatchObject({ ok: false });
    expect(parseBackup(JSON.stringify({ ...base, transactions: 'x' }))).toEqual({ ok: false, error: { code: 'bad-shape', key: 'transactions' } });
    const tx = (o: object) => parseBackup(JSON.stringify({ ...base, transactions: [{ id: 't', type: 'expense', amount: 1, accountId: 'a', date: '2026-11-01', ...o }] }));
    expect(tx({}).ok).toBe(true);
    expect(tx({ amount: NaN })).toMatchObject({ error: { field: 'amount' } }); // NaN becomes null in JSON
    expect(tx({ date: '2026-13-01' })).toMatchObject({ error: { field: 'date' } });
    expect(tx({ type: 'loan' })).toMatchObject({ error: { field: 'type' } });
    expect(tx({ fee: 'a' })).toMatchObject({ error: { field: 'fee' } });
    expect(parseBackup(JSON.stringify({ ...base, accounts: [{ id: 'a', name: 'x', initialBalance: null }] }))).toMatchObject({ error: { key: 'accounts', field: 'initialBalance' } });
    expect(parseBackup(JSON.stringify({ ...base, settings: 5 }))).toMatchObject({ error: { key: 'settings' } });
  });
});

// 2.8.0 added optional card data and the "statements" collection. Nothing old needs rewriting,
// and that is the point: a 2.7.0 card must come through untouched, with no invented data.
describe('2.8.0 additions (credit cards): no migration needed, old shapes survive', () => {
  const card27 = { id: 'visa', name: 'Visa', icon: '💳', type: 'card', cardKind: 'credit', currency: 'DOP', initialBalance: -2500, liquid: false };

  it('a 2.7.0 credit card passes through the migrations unchanged (no limit, cut or due is guessed)', () => {
    const out = migrateSnapshot({ accounts: [card27] }, 2) as { accounts: any[] };
    expect(out.accounts[0]).toEqual(card27);
    expect(out.accounts[0]).not.toHaveProperty('card');
    // and a 2.5.1 card gets the 2.7.0 flags only
    const old = migrateSnapshot({ accounts: [{ id: 'v', name: 'Visa', icon: '💳', type: 'card', cardKind: 'credit', initialBalance: 0 }] }, 1) as { accounts: any[] };
    expect(old.accounts[0]).toMatchObject({ liquid: false });
    expect(old.accounts[0]).not.toHaveProperty('card');
  });

  it('the statements collection is registered as synced and travels in backups', () => {
    expect(isSyncedKey('statements')).toBe(true);
    const stmt = { id: 'stmt-visa-DOP-2026-11-15', accountId: 'visa', cutDate: '2026-11-15', dueDate: '2026-12-05', calculatedBalance: 100 };
    const parsed = parseBackup(JSON.stringify({ app: 'x-money', schemaVersion: 2, accounts: [{ ...card27, card: { creditLimit: 5000, cutDay: 15 } }], statements: [stmt] }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect((parsed.data as any).statements).toEqual([stmt]);
  });

  it('a backup of 2.7.0 or older has no statements and imports fine; a malformed statement is rejected before any write', () => {
    expect(parseBackup(JSON.stringify({ app: 'x-money', schemaVersion: 2, accounts: [card27] })).ok).toBe(true);
    const bad = parseBackup(JSON.stringify({ app: 'x-money', schemaVersion: 2, statements: [{ id: 's', accountId: 'a', cutDate: 'nope', dueDate: '2026-12-05', calculatedBalance: 1 }] }));
    expect(bad).toEqual({ ok: false, error: { code: 'bad-shape', key: 'statements', index: 0, field: 'cutDate' } });
  });
});
