import { Injectable, signal } from '@angular/core';
import { BrowserLegacy, LegacySource } from '../data-layer/legacy';
import { IdbLocalDb, LocalDb, MemoryLocalDb } from '../data-layer/local-db';
import { migrateRecord } from '../data-layer/migrations';
import { CLIENT_SCHEMA_VERSION, DOC_ID, SYNCED_COLLECTIONS, isKnownKey, isSyncedKey, stableStringify } from '../data-layer/registry';

type Watcher = (value: unknown) => void;
type ChangeSink = (key: string, prev: unknown, next: unknown) => void;

export interface HydrateOptions {
  local?: LocalDb;
  legacy?: LegacySource;
}

// Data layer with the same get/set/remove API the services always used. The working
// copy lives in memory (services read synchronously), is persisted to IndexedDB, and
// every write of a synced key is handed to the sync engine as per-record operations.
// The server (x-core) is the source of truth; this is the offline copy.
@Injectable({ providedIn: 'root' })
export class StorageService {
  private cache = new Map<string, unknown>();
  private local: LocalDb = new MemoryLocalDb();
  private legacy: LegacySource = new BrowserLegacy();
  private watchers = new Map<string, Set<Watcher>>();
  private sink: ChangeSink | null = null;
  private writes: Promise<unknown> = Promise.resolve();
  private degraded = false; // IndexedDB unavailable: localStorage is the copy again

  // An app older than the server schema must not write (it could corrupt migrated data)
  readOnly = signal(false);
  // A failed data migration: the old data is intact but nothing may be uploaded
  syncBlocked = signal(false);

  get localDb(): LocalDb {
    return this.local;
  }

  async hydrate(options: HydrateOptions = {}): Promise<void> {
    if (options.legacy) this.legacy = options.legacy;
    try {
      this.local = options.local ?? (await IdbLocalDb.open());
    } catch (error) {
      console.error('x-money: IndexedDB unavailable, using localStorage', error);
      this.degraded = true;
      this.local = new MemoryLocalDb();
    }

    if (this.degraded || !(await this.local.get('device', 'migrated'))) {
      await this.migrateFromLegacy();
    } else {
      for (const key of await this.local.keys('kv')) {
        this.cache.set(key, await this.local.get('kv', key));
      }
    }
    // keep asking the browser not to purge this origin's storage (iOS/Safari may otherwise)
    try {
      void navigator.storage?.persist?.();
    } catch {
      /* not supported */
    }
  }

  // 2.5.x -> 2.6: copy localStorage/Preferences into IndexedDB, verify it reads back
  // identical, and only then move the old copy aside (never delete it).
  private async migrateFromLegacy(): Promise<void> {
    const raw = await this.legacy.readAll();
    const parsed = new Map<string, unknown>();
    for (const [key, text] of Object.entries(raw)) {
      if (!isKnownKey(key) || !text) continue;
      try {
        parsed.set(key, JSON.parse(text));
      } catch {
        console.error(`x-money: legacy key "${key}" is not valid JSON, left untouched`);
      }
    }
    for (const [key, value] of parsed) this.cache.set(key, value);
    if (this.degraded) return;

    let verified = true;
    try {
      for (const [key, value] of parsed) await this.local.put('kv', key, value);
      for (const [key, value] of parsed) {
        if (stableStringify(await this.local.get('kv', key)) !== stableStringify(value)) verified = false;
      }
    } catch (error) {
      console.error('x-money: migration to IndexedDB failed, will retry next start', error);
      verified = false;
    }
    if (verified) {
      await this.local.put('device', 'migrated', { at: Date.now(), keys: [...parsed.keys()] });
      await this.legacy.archive([...parsed.keys()]);
    }
  }

  // ----- sync wiring

  setChangeSink(sink: ChangeSink | null): void {
    this.sink = sink;
  }

  watch(key: string, fn: Watcher): () => void {
    const set = this.watchers.get(key) ?? new Set<Watcher>();
    set.add(fn);
    this.watchers.set(key, set);
    return () => set.delete(fn);
  }

  private notify(key: string): void {
    const value = this.cache.has(key) ? structuredClone(this.cache.get(key)) : undefined;
    this.watchers.get(key)?.forEach((fn) => fn(value));
  }

  // Lets the services re-read a key that was changed outside their own methods (restore)
  refresh(key: string): void {
    this.notify(key);
  }

  // Copy of every synced collection, as the services see them
  snapshotSynced(): Record<string, unknown> {
    const snapshot: Record<string, unknown> = {};
    for (const key of Object.keys(SYNCED_COLLECTIONS)) {
      if (this.cache.has(key)) snapshot[key] = structuredClone(this.cache.get(key));
    }
    return snapshot;
  }

  // Applies records downloaded from the server (no outbox operations are generated)
  applyRemote(
    key: string,
    upserts: { id: string; data: Record<string, unknown>; schemaVersion?: number }[],
    deletes: string[]
  ): void {
    const kind = SYNCED_COLLECTIONS[key];
    if (!kind) return; // collection from a newer app version: ignore, the cursor still advances
    // records written by an older app still have the old shape: bring them up to date
    const shaped = (u: { data: Record<string, unknown>; schemaVersion?: number }) =>
      (u.schemaVersion ?? 1) < CLIENT_SCHEMA_VERSION ? migrateRecord(key, u.data, u.schemaVersion ?? 1) : u.data;
    if (kind === 'doc') {
      if (upserts.length) this.cache.set(key, (shaped(upserts[upserts.length - 1]) as { value: unknown }).value);
      else if (deletes.includes(DOC_ID)) this.cache.delete(key);
    } else {
      const list = ((this.cache.get(key) as Record<string, unknown>[] | undefined) ?? []).slice();
      const at = new Map(list.map((item, i) => [item['id'] as string, i]));
      for (const u of upserts) {
        const { id } = u;
        const data = shaped(u) as Record<string, unknown>;
        const item = data['id'] === id ? data : { ...data, id }; // server-made records carry the id only in the key
        const i = at.get(id);
        if (i === undefined) list.push(item);
        else list[i] = item;
      }
      const gone = new Set(deletes);
      this.cache.set(key, list.filter((item) => !gone.has(item['id'] as string)));
    }
    this.persistKey(key);
    this.notify(key);
  }

  // Drops the local copy of every synced collection (sign out / keep-server choice).
  // Nothing is sent to the server.
  wipeSynced(): void {
    for (const key of Object.keys(SYNCED_COLLECTIONS)) {
      this.cache.delete(key);
      this.persistKey(key);
      this.notify(key);
    }
  }

  // Every value of every key (synced and device-only), for the pre-migration snapshot
  snapshotAll(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of this.cache) out[key] = structuredClone(value);
    return out;
  }

  hasSyncedData(): boolean {
    return Object.keys(SYNCED_COLLECTIONS).some((key) => this.cache.has(key));
  }

  // Writes migrated values (or restores a snapshot) without producing outbox operations:
  // the migration upload is queued explicitly once the whole migration succeeded
  writeLocal(values: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(values)) {
      this.cache.set(key, structuredClone(value));
      this.persistKey(key);
    }
  }

  // ----- the API every service uses

  get<T>(key: string, fallback: T): T {
    return this.cache.has(key) ? (structuredClone(this.cache.get(key)) as T) : fallback;
  }

  set<T>(key: string, value: T): void {
    if (this.readOnly()) {
      console.warn(`x-money: read-only (update the app), "${key}" was not saved`);
      return;
    }
    if (!isKnownKey(key)) console.error(`x-money: "${key}" is not registered in data-layer/registry.ts`);
    const prev = this.cache.get(key);
    this.cache.set(key, structuredClone(value));
    this.persistKey(key);
    if (isSyncedKey(key)) this.sink?.(key, prev, this.cache.get(key));
  }

  remove(key: string): void {
    if (this.readOnly()) return;
    const prev = this.cache.get(key);
    this.cache.delete(key);
    this.persistKey(key);
    if (isSyncedKey(key)) this.sink?.(key, prev, undefined);
  }

  // Wipes this device's copy (local-only mode). With an account use sign-out instead.
  clearAll(): void {
    this.cache.clear();
    this.writes = this.writes
      .then(() => this.local.clear('kv'))
      .then(() => this.legacy.clearAll())
      .catch(() => undefined);
  }

  flush(): Promise<unknown> {
    return this.writes;
  }

  private persistKey(key: string): void {
    const has = this.cache.has(key);
    const value = has ? structuredClone(this.cache.get(key)) : undefined;
    this.writes = this.writes
      .then(() => (has ? this.local.put('kv', key, value) : this.local.delete('kv', key)))
      .catch((error) => console.error(`x-money: could not persist "${key}"`, error));
    if (this.degraded) this.legacy.writeLocal(key, has ? JSON.stringify(value) : null);
    this.legacy.mirror(key, has ? JSON.stringify(value) : null);
  }
}
