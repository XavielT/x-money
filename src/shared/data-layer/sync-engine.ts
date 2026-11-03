// Offline-first sync engine, no Angular: a persistent outbox of per-record operations
// (upserts by primary key, so retries are idempotent), a server cursor (rev) for
// downloads, and the revs this device already knows. Network and storage are injected.
import { ChangeOp, diffCollection } from './diff';
import { CLIENT_SCHEMA_VERSION, SYNCED_COLLECTIONS } from './registry';
import { LocalDb } from './local-db';

export interface WireOp {
  collection: string;
  id: string;
  deleted: boolean;
  data: Record<string, unknown> | null;
  schemaVersion: number;
  clientUpdatedAt: number;
  baseRev: number;
}

export interface PushResult {
  index: number;
  status: 'ok' | 'won' | 'lost' | 'invalid';
  rev?: number;
}

export interface PullRecord {
  collection: string;
  id: string;
  data: Record<string, unknown> | null;
  schemaVersion: number;
  rev: number;
  clientUpdatedAt: number;
  deviceId: string;
  deleted: boolean;
}

export interface SyncTransport {
  push(ops: WireOp[]): Promise<{ results: PushResult[] }>;
  pull(since: number, limit: number): Promise<{ records: PullRecord[]; hasMore: boolean; cursor: number }>;
}

export interface RemoteApplier {
  applyRemote(collection: string, upserts: { id: string; data: Record<string, unknown> }[], deletes: string[]): void;
}

export type SyncErrorKind = 'network' | 'auth' | 'outdated' | 'forbidden' | 'server' | 'bad_request';

export class SyncError extends Error {
  constructor(
    public kind: SyncErrorKind,
    message: string = kind
  ) {
    super(message);
  }
}

interface QueuedOp extends WireOp {
  seq: number;
}

export interface PushSummary {
  pushed: number;
  won: number;
  lost: number;
  rejected: number;
}

const opKey = (collection: string, id: string) => `${collection}/${id}`;

export class SyncEngine {
  private queue = new Map<string, QueuedOp>();
  private revs: Record<string, number> = {};
  private cursorValue = 0;
  private rejected: { collection: string; id: string; at: number }[] = [];
  private seq = 0;
  private inflight = new Set<string>();
  private lock: Promise<unknown> = Promise.resolve();
  private writes: Promise<unknown> = Promise.resolve();

  onEnqueue: (() => void) | null = null;

  constructor(
    private local: LocalDb,
    private transport: SyncTransport,
    private applier: RemoteApplier,
    private now: () => number = () => Date.now(),
    private batchSize = 200
  ) {}

  async load(): Promise<void> {
    const queue = (await this.local.get<QueuedOp[]>('device', 'queue')) ?? [];
    this.queue = new Map(queue.map((op) => [opKey(op.collection, op.id), op]));
    this.seq = queue.reduce((max, op) => Math.max(max, op.seq), 0);
    this.revs = (await this.local.get<Record<string, number>>('device', 'revs')) ?? {};
    this.cursorValue = (await this.local.get<number>('device', 'cursor')) ?? 0;
    this.rejected = (await this.local.get<typeof this.rejected>('device', 'rejected')) ?? [];
  }

  get pending(): number {
    return this.queue.size;
  }
  get cursor(): number {
    return this.cursorValue;
  }
  get rejectedOps() {
    return this.rejected;
  }
  hasPending(collection: string, id: string): boolean {
    return this.queue.has(opKey(collection, id));
  }

  // Called by StorageService for every write of a synced key
  recordChange(key: string, prev: unknown, next: unknown): void {
    const ops = diffCollection(key, prev, next);
    if (!ops.length) return;
    const at = this.now();
    for (const op of ops) this.enqueue(op, at);
    this.persistQueue();
    this.onEnqueue?.();
  }

  // Queues every record of a snapshot (first upload / merge). clientUpdatedAt 0 makes
  // server copies win overlaps; the losers are kept in "conflicts", never dropped.
  enqueueSnapshot(snapshot: Record<string, unknown>, clientUpdatedAt = 0): number {
    let count = 0;
    for (const key of Object.keys(SYNCED_COLLECTIONS)) {
      if (!(key in snapshot) || key === 'conflicts') continue;
      for (const op of diffCollection(key, undefined, snapshot[key])) {
        this.enqueue(op, clientUpdatedAt);
        count++;
      }
    }
    this.persistQueue();
    return count;
  }

  private enqueue(op: ChangeOp, clientUpdatedAt: number): void {
    const key = opKey(op.collection, op.id);
    const known = this.revs[key];
    const existing = this.queue.get(key);
    if (existing) {
      // created and deleted before it ever reached the server: nothing to send
      if (op.deleted && !existing.deleted && existing.baseRev === 0 && known === undefined && !this.inflight.has(key)) {
        this.queue.delete(key);
        return;
      }
      this.queue.set(key, { ...existing, deleted: op.deleted, data: op.data, clientUpdatedAt, seq: ++this.seq });
      return;
    }
    this.queue.set(key, {
      collection: op.collection,
      id: op.id,
      deleted: op.deleted,
      data: op.data,
      schemaVersion: CLIENT_SCHEMA_VERSION,
      clientUpdatedAt,
      baseRev: known ?? 0,
      seq: ++this.seq,
    });
  }

  // Serializes push/pull so two triggers (timer + "online" event) never interleave
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  push(onProgress?: (remaining: number) => void): Promise<PushSummary> {
    return this.exclusive(() => this.pushNow(onProgress));
  }

  pull(): Promise<number> {
    return this.exclusive(() => this.pullNow());
  }

  sync(): Promise<{ push: PushSummary; pulled: number }> {
    return this.exclusive(async () => {
      const push = await this.pushNow();
      const pulled = await this.pullNow();
      return { push, pulled };
    });
  }

  private async pushNow(onProgress?: (remaining: number) => void): Promise<PushSummary> {
    const summary: PushSummary = { pushed: 0, won: 0, lost: 0, rejected: 0 };
    while (this.queue.size) {
      const batch = [...this.queue.values()].slice(0, this.batchSize);
      const before = this.queue.size;
      batch.forEach((op) => this.inflight.add(opKey(op.collection, op.id)));
      let response: { results: PushResult[] };
      try {
        response = await this.transport.push(batch.map(({ seq: _seq, ...wire }) => wire));
      } finally {
        this.inflight.clear();
      }
      for (const result of response.results) {
        const sent = batch[result.index];
        if (!sent) continue;
        const key = opKey(sent.collection, sent.id);
        const current = this.queue.get(key);
        const unchanged = current?.seq === sent.seq;
        if (result.status === 'invalid') {
          if (unchanged) this.queue.delete(key);
          this.rejected = [...this.rejected, { collection: sent.collection, id: sent.id, at: this.now() }].slice(-20);
          summary.rejected++;
          continue;
        }
        // after a loss the server keeps another version: leave the known rev alone so the
        // next pull applies the winner locally
        const accepted = result.status !== 'lost' && result.rev !== undefined;
        if (accepted) this.revs[key] = result.rev!;
        if (unchanged) this.queue.delete(key);
        else if (current && accepted) current.baseRev = result.rev!; // edited while in flight
        if (result.status === 'ok') summary.pushed++;
        else if (result.status === 'won') summary.won++;
        else summary.lost++;
      }
      await this.persistAll();
      onProgress?.(this.queue.size);
      if (this.queue.size >= before) break; // no progress: do not spin
    }
    return summary;
  }

  private async pullNow(): Promise<number> {
    let applied = 0;
    for (;;) {
      const page = await this.transport.pull(this.cursorValue, 500);
      const grouped = new Map<string, { upserts: { id: string; data: Record<string, unknown> }[]; deletes: string[] }>();
      for (const record of page.records) {
        const key = opKey(record.collection, record.id);
        // a local edit waits in the outbox: keep it, the server resolves the conflict on push
        if (this.queue.has(key)) continue;
        if (this.revs[key] === record.rev) continue; // our own write coming back
        this.revs[key] = record.rev;
        const group = grouped.get(record.collection) ?? { upserts: [], deletes: [] };
        if (record.deleted || !record.data) group.deletes.push(record.id);
        else group.upserts.push({ id: record.id, data: record.data });
        grouped.set(record.collection, group);
      }
      for (const [collection, group] of grouped) {
        this.applier.applyRemote(collection, group.upserts, group.deletes);
        applied += group.upserts.length + group.deletes.length;
      }
      this.cursorValue = page.cursor;
      await this.persistAll();
      if (!page.hasMore) break;
    }
    return applied;
  }

  // Forget sync state (sign out / "keep the server copy")
  async reset(): Promise<void> {
    this.queue.clear();
    this.revs = {};
    this.cursorValue = 0;
    this.rejected = [];
    await this.persistAll();
  }

  private persistQueue(): void {
    const queue = [...this.queue.values()];
    this.writes = this.writes.then(() => this.local.put('device', 'queue', queue)).catch(() => undefined);
  }

  private async persistAll(): Promise<void> {
    const queue = [...this.queue.values()];
    const revs = { ...this.revs };
    const cursor = this.cursorValue;
    const rejected = this.rejected;
    this.writes = this.writes
      .then(async () => {
        await this.local.put('device', 'queue', queue);
        await this.local.put('device', 'revs', revs);
        await this.local.put('device', 'cursor', cursor);
        await this.local.put('device', 'rejected', rejected);
      })
      .catch(() => undefined);
    await this.writes;
  }

  flush(): Promise<unknown> {
    return this.writes;
  }
}
