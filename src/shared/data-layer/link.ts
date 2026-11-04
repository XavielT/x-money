// First sync of a device with an account: decides what to do from the local and
// server contents. Pure, so every scenario is tested without a server.
import { DEFAULT_ACCOUNTS_MOCK } from '../data/default-accounts';
import { DEFAULT_CATEGORIES_MOCK } from '../data/default-categories';
import { SYNCED_COLLECTIONS, stableStringify } from './registry';

export type Counts = Record<string, number>;

// "conflicts" is server-made bookkeeping, not user data: it never counts for decisions
const COUNTED = Object.keys(SYNCED_COLLECTIONS).filter((k) => k !== 'conflicts' && SYNCED_COLLECTIONS[k] === 'entities');

export function countLocal(snapshot: Record<string, unknown>): Counts {
  const counts: Counts = {};
  for (const key of COUNTED) {
    const value = snapshot[key];
    counts[key] = Array.isArray(value) ? value.length : 0;
  }
  return counts;
}

export function countServer(counts: Counts): Counts {
  return Object.fromEntries(COUNTED.map((key) => [key, counts[key] ?? 0]));
}

export const total = (counts: Counts): number => Object.values(counts).reduce((a, b) => a + b, 0);

// Only the seeded defaults (what a fresh install creates): nothing the user typed
export function isPristine(snapshot: Record<string, unknown>): boolean {
  const empty = (key: string) => !Array.isArray(snapshot[key]) || (snapshot[key] as unknown[]).length === 0;
  if (!empty('transactions') || !empty('budgets') || !empty('recurring')) return false;
  const accounts = snapshot['accounts'];
  // flags added by data migrations (liquid, archived) do not make an account "user data"
  const bare = (list: unknown[]) => list.map((a) => ({ ...(a as object), liquid: undefined, archived: undefined }));
  if (Array.isArray(accounts) && accounts.length && stableStringify(bare(accounts)) !== stableStringify(bare(DEFAULT_ACCOUNTS_MOCK))) {
    return false;
  }
  const categories = snapshot['categories'];
  if (Array.isArray(categories)) {
    const defaults = new Map(DEFAULT_CATEGORIES_MOCK.map((c) => [c.id, stableStringify(c)]));
    if (categories.some((c) => defaults.get((c as { id: string }).id) !== stableStringify(c))) return false;
  }
  return true;
}

export type LinkDecision =
  | 'link-empty' // nothing on either side: just link (and upload the seeds)
  | 'upload' // local data, empty server: "Upload my data" wizard
  | 'download' // server data, pristine device: take the server copy
  | 'choose'; // data on both sides: the user decides, nothing happens before

export function decideLink(local: Record<string, unknown>, server: Counts): LinkDecision {
  const localHasData = !isPristine(local);
  const serverHasData = total(countServer(server)) > 0;
  if (!serverHasData) return localHasData ? 'upload' : 'link-empty';
  return localHasData ? 'choose' : 'download';
}

// After uploading/merging, both sides must hold the same number of records
export function countsMatch(local: Counts, server: Counts): boolean {
  const s = countServer(server);
  return COUNTED.every((key) => (local[key] ?? 0) === s[key]);
}
