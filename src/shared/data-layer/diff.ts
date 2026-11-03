import { DOC_ID, SYNCED_COLLECTIONS, isValidRecordId, stableStringify } from './registry';

export interface ChangeOp {
  collection: string;
  id: string;
  deleted: boolean;
  data: Record<string, unknown> | null;
}

// Turns "the collection used to be prev and is now next" into per-record operations.
// Rewriting the same content (or just reordering the list) produces no operations.
export function diffCollection(key: string, prev: unknown, next: unknown): ChangeOp[] {
  const kind = SYNCED_COLLECTIONS[key];
  if (kind === 'doc') {
    if (stableStringify(prev) === stableStringify(next)) return [];
    return next === undefined
      ? [{ collection: key, id: DOC_ID, deleted: true, data: null }]
      : [{ collection: key, id: DOC_ID, deleted: false, data: { value: next } }];
  }
  if (kind !== 'entities') return [];

  const before = indexById(prev);
  const after = indexById(next);
  const ops: ChangeOp[] = [];
  for (const [id, item] of after) {
    const old = before.get(id);
    if (old === undefined || stableStringify(old) !== stableStringify(item)) {
      ops.push({ collection: key, id, deleted: false, data: item });
    }
  }
  for (const id of before.keys()) {
    if (!after.has(id)) ops.push({ collection: key, id, deleted: true, data: null });
  }
  return ops;
}

function indexById(list: unknown): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(list)) return map;
  for (const item of list) {
    const id = (item as { id?: unknown } | null)?.id;
    if (!item || typeof item !== 'object' || !isValidRecordId(id)) {
      console.warn('x-money: item without a valid id is not synced', item);
      continue;
    }
    map.set(id, item as Record<string, unknown>);
  }
  return map;
}
