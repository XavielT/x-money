// Local copy store. `kv` holds the working copy of every storage key (the same
// values the services read); `device` holds sync bookkeeping that never leaves the
// device (queue, cursor, known revs, device id, migration flag).
export type StoreName = 'kv' | 'device';

export interface LocalDb {
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  put(store: StoreName, key: string, value: unknown): Promise<void>;
  delete(store: StoreName, key: string): Promise<void>;
  keys(store: StoreName): Promise<string[]>;
  clear(store: StoreName): Promise<void>;
}

export class MemoryLocalDb implements LocalDb {
  private stores: Record<StoreName, Map<string, unknown>> = { kv: new Map(), device: new Map() };

  async get<T>(store: StoreName, key: string) {
    const v = this.stores[store].get(key);
    return v === undefined ? undefined : (structuredClone(v) as T);
  }
  async put(store: StoreName, key: string, value: unknown) {
    this.stores[store].set(key, structuredClone(value));
  }
  async delete(store: StoreName, key: string) {
    this.stores[store].delete(key);
  }
  async keys(store: StoreName) {
    return [...this.stores[store].keys()];
  }
  async clear(store: StoreName) {
    this.stores[store].clear();
  }
}

const DB_NAME = 'x-money-db';
const STORES: StoreName[] = ['kv', 'device'];

const done = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const finished = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });

// Own thin wrapper over IndexedDB (no dependency). Throws on open when IndexedDB is
// unavailable (e.g. some private modes) so the caller can fall back.
export class IdbLocalDb implements LocalDb {
  private constructor(private db: IDBDatabase) {}

  static async open(): Promise<IdbLocalDb> {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is not available');
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      for (const name of STORES) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      }
    };
    return new IdbLocalDb(await done(request));
  }

  private store(name: StoreName, mode: IDBTransactionMode) {
    const tx = this.db.transaction(name, mode);
    return { store: tx.objectStore(name), tx };
  }

  async get<T>(name: StoreName, key: string) {
    return (await done(this.store(name, 'readonly').store.get(key))) as T | undefined;
  }
  async put(name: StoreName, key: string, value: unknown) {
    const { store, tx } = this.store(name, 'readwrite');
    store.put(value, key);
    await finished(tx);
  }
  async delete(name: StoreName, key: string) {
    const { store, tx } = this.store(name, 'readwrite');
    store.delete(key);
    await finished(tx);
  }
  async keys(name: StoreName) {
    return (await done(this.store(name, 'readonly').store.getAllKeys())).map(String);
  }
  async clear(name: StoreName) {
    const { store, tx } = this.store(name, 'readwrite');
    store.clear();
    await finished(tx);
  }
}
