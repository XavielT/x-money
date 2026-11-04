// Registry of every storage key (x-money:*): synced with x-core or only on this device.
// A new collection MUST be added here (prompts 01+). Unregistered keys are treated as
// device-only and reported with console.error so the omission is noticed.

export type CollectionKind =
  | 'entities' // array of objects with a string `id`: one server record per item
  | 'doc'; // a single JSON value: one server record with data = { value }

// Bump together with a migration in migrations.ts; see docs/ARQUITECTURA.md (schema versioning)
export const CLIENT_SCHEMA_VERSION = 2;

export const SYNCED_COLLECTIONS: Record<string, CollectionKind> = {
  accounts: 'entities',
  transactions: 'entities',
  categories: 'entities',
  budgets: 'entities',
  recurring: 'entities',
  conflicts: 'entities', // losers of edit conflicts, written by the server
  audit: 'entities', // append-only change history (capped), each event names its device
  incomeSources: 'entities', // where income comes from (2.9.0)
  benefits: 'entities', // non-monetary work benefits with their usage notes (2.9.0): never money
  statements: 'entities', // closed credit-card billing periods (ids are the same on every device)
  settings: 'doc', // currency symbol, bank tax %
  lang: 'doc', // interface language
};

// Never leave this device: PIN hash and local preferences of this install
export const DEVICE_ONLY_KEYS: readonly string[] = ['lock', 'device-prefs'];

export const DOC_ID = 'doc';

export const isSyncedKey = (key: string): boolean => key in SYNCED_COLLECTIONS;
export const isKnownKey = (key: string): boolean => isSyncedKey(key) || DEVICE_ONLY_KEYS.includes(key);

// Server ids: letters, digits and _ . : ~ -  (max 128)
const ID_RE = /^[A-Za-z0-9_.:~-]{1,128}$/;
export const isValidRecordId = (id: unknown): id is string => typeof id === 'string' && ID_RE.test(id);

// JSON with sorted object keys, so equality ignores key order
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v
  );
}
