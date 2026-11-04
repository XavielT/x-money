// Versioned data migrations. Each one is a pure, idempotent function over ONE record, so
// the same code migrates the local copy at start-up, queued operations, records downloaded
// from another device that still holds an older shape, and imported backups.
import { defaultLiquid } from '../domain/networth';
import { CLIENT_SCHEMA_VERSION, SYNCED_COLLECTIONS } from './registry';

export interface Migration {
  version: number; // the schema version this migration produces
  name: string;
  // collection is the storage key; item is one entity (or, for "doc" collections, the value)
  record(collection: string, item: unknown): unknown;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

export const MIGRATIONS: Migration[] = [
  {
    // 2.7.0: traceability on movements, flags on accounts. Old records get explicit defaults;
    // nothing is guessed (createdAt/updatedAt stay absent for movements that predate it).
    version: 2,
    name: 'traceability-and-account-flags',
    record(collection, item) {
      if (!isObj(item)) return item;
      if (collection === 'transactions') {
        const out = { ...item };
        out['origin'] ??= out['type'] === 'transfer' ? 'transfer' : 'manual';
        out['status'] ??= 'posted';
        return out;
      }
      if (collection === 'accounts') {
        const out = { ...item };
        // explicit, so changing the defaults later never silently changes old accounts.
        // Accounts older than 2.1 have no type yet: AccountService infers it (from the icon)
        // and sets the flag then.
        if (out['liquid'] === undefined && typeof out['type'] === 'string') out['liquid'] = defaultLiquid(out['type'] as never);
        return out;
      }
      return item;
    },
  },
];

export function migrateRecord(
  collection: string,
  item: unknown,
  from: number,
  to = CLIENT_SCHEMA_VERSION,
  migrations: readonly Migration[] = MIGRATIONS
): unknown {
  let current = item;
  for (const m of migrations) {
    if (m.version > from && m.version <= to) current = m.record(collection, current);
  }
  return current;
}

// Migrates a whole snapshot (storage key -> value). Returns a new object; the input is untouched.
export function migrateSnapshot(
  data: Record<string, unknown>,
  from: number,
  to = CLIENT_SCHEMA_VERSION,
  migrations: readonly Migration[] = MIGRATIONS
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const kind = SYNCED_COLLECTIONS[key];
    if (kind === 'entities' && Array.isArray(value)) {
      out[key] = value.map((item) => migrateRecord(key, item, from, to, migrations));
    } else if (kind === 'doc') {
      out[key] = migrateRecord(key, value, from, to, migrations);
    } else {
      out[key] = value;
    }
  }
  return out;
}
