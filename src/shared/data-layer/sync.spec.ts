// Sync engine against the real server logic (xmoney-api over the in-memory Db):
// two "devices" with their own local copy talk to one account.
import { TestBed } from '@angular/core/testing';
import { beforeEach, vi } from 'vitest';
import { createApi } from '../../../supabase/functions/xmoney-api/lib/api.ts';
import { MemoryDb } from '../../../supabase/functions/xmoney-api/lib/memory-db.ts';
import { ApiError, ApiTransport, SessionPersistence, XMoneyApiClient } from './api-client';
import { countLocal, countsMatch } from './link';
import { MemoryLocalDb } from './local-db';
import { PullRecord, PushResult, SyncEngine, SyncError, SyncTransport, WireOp } from './sync-engine';
import { StorageService } from '../services/storage.service';
import { ConflictService } from '../services/conflict.service';
import { TransactionService } from '../services/transaction.service';
import { FIXTURE_251, FakeLegacy } from '../testing/fixtures';

const T0 = 1_800_000_000_000;
let clock = T0;
let db: MemoryDb;
let api: ReturnType<typeof createApi>;

beforeEach(() => {
  clock = T0;
  db = new MemoryDb();
  db.clock = () => clock;
  api = createApi({
    db,
    tokenSecret: 's'.repeat(40),
    signupCode: 'invite',
    now: () => clock,
    kdf: { alg: 'PBKDF2-SHA256', iterations: 1000 },
  });
});

// Talks to the real handlers. `offline` fails before reaching the server, `dropResponse`
// applies the request on the server but loses the answer (the nasty case).
class DirectTransport implements SyncTransport {
  offline = false;
  dropResponse = false;
  pushes = 0;
  constructor(private token: string) {}

  private async call<T>(action: string, body: Record<string, unknown>, lose = false): Promise<T> {
    if (this.offline) throw new SyncError('network');
    const r = await api.handle({ action, body, ip: '1.1.1.1', authorization: `Bearer ${this.token}` });
    if (lose) throw new SyncError('network');
    if (r.status === 409) throw new SyncError('outdated');
    if (r.status === 401) throw new SyncError('auth');
    if (r.status !== 200) throw new SyncError('server', String(r.body['error']));
    return r.body as T;
  }
  push(ops: WireOp[]) {
    this.pushes++;
    const lose = this.dropResponse;
    this.dropResponse = false;
    return this.call<{ results: PushResult[] }>('sync/push', { schemaVersion: 1, ops }, lose);
  }
  pull(since: number, limit: number) {
    return this.call<{ records: PullRecord[]; hasMore: boolean; cursor: number }>('sync/pull', { since, limit });
  }
  meta() {
    return this.call<{ schemaVersion: number; counts: Record<string, number> }>('sync/meta', {});
  }
}

async function register(email = 'x@example.com'): Promise<string> {
  const r = await api.handle({
    action: 'auth/signup',
    body: { email, password: 'long enough password', inviteCode: 'invite', deviceId: 'device-reg1' },
    ip: '2.2.2.2',
    authorization: null,
  });
  return r.body['accessToken'] as string;
}

async function login(deviceId: string, email = 'x@example.com'): Promise<string> {
  const r = await api.handle({
    action: 'auth/login',
    body: { email, password: 'long enough password', deviceId },
    ip: '3.3.3.3',
    authorization: null,
  });
  return r.body['accessToken'] as string;
}

async function device(token: string, local = new MemoryLocalDb(), seed?: Record<string, unknown>, batchSize = 200) {
  const storage = new StorageService();
  await storage.hydrate({ local, legacy: new FakeLegacy() });
  for (const [k, v] of Object.entries(seed ?? {})) storage.set(k, v);
  const transport = new DirectTransport(token);
  const engine = new SyncEngine(local, transport, storage, () => clock, batchSize);
  await engine.load();
  storage.setChangeSink((k, p, n) => engine.recordChange(k, p, n));
  return { storage, engine, transport, local };
}

const tx = (id: string, amount: number, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'expense',
  amount,
  categoryId: 'cat-food',
  accountId: 'a-1',
  date: '2026-11-02',
  ...extra,
});
const list = (d: { storage: StorageService }, key = 'transactions') => d.storage.get<{ id: string; amount: number }[]>(key, []);

describe('push and pull between two devices', () => {
  it('shows on the other device what one device created, edited and deleted', async () => {
    const token = await register();
    const a = await device(token);
    const b = await device(await login('device-bbbb'));

    a.storage.set('transactions', [tx('t1', 10), tx('t2', 20)]);
    await a.engine.sync();
    await b.engine.sync();
    expect(list(b).map((t) => t.id)).toEqual(['t1', 't2']);

    clock += 1000;
    a.storage.set('transactions', [tx('t1', 11)]); // edit t1, delete t2
    await a.engine.sync();
    await b.engine.sync();
    expect(list(b)).toEqual([expect.objectContaining({ id: 't1', amount: 11 })]);
  });

  it('applies downloaded changes without queueing them back', async () => {
    const token = await register();
    const a = await device(token);
    const b = await device(await login('device-bbbb'));
    a.storage.set('transactions', [tx('t1', 10)]);
    await a.engine.sync();
    await b.engine.sync();
    expect(b.engine.pending).toBe(0);
    await b.engine.sync();
    expect(db.records.size).toBe(1);
  });

  it('both devices compute the same balances from the same movements', async () => {
    const token = await register();
    const a = await device(token, new MemoryLocalDb(), {
      accounts: FIXTURE_251['accounts'],
      transactions: FIXTURE_251['transactions'],
    });
    const b = await device(await login('device-bbbb'));
    a.engine.enqueueSnapshot(a.storage.snapshotSynced(), T0);
    await a.engine.sync();
    await b.engine.sync();

    const balances = async (d: { storage: StorageService }) => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [{ provide: StorageService, useValue: d.storage }] });
      const t = TestBed.inject(TransactionService);
      return [t.totalBalance(), t.accountBalance('a-bank'), t.accountBalance('a-cash'), t.accountBalance('a-usd', 'USD')];
    };
    const expected = await balances(a);
    expect(expected[0]).not.toBe(0);
    expect(await balances(b)).toEqual(expected);
  });

  it('pages through 5,000 records and applies tombstones', async () => {
    const token = await register();
    const a = await device(token, new MemoryLocalDb(), undefined, 500);
    a.storage.set('transactions', Array.from({ length: 5000 }, (_, i) => tx(`t${i}`, i)));
    await a.engine.push();
    expect(a.engine.pending).toBe(0);
    a.storage.set('transactions', list(a).slice(10)); // delete the first 10
    await a.engine.push();

    const b = await device(await login('device-bbbb'));
    await b.engine.pull();
    expect(list(b)).toHaveLength(4990);
    expect(b.engine.cursor).toBeGreaterThan(0);
    expect(await b.engine.pull()).toBe(0); // nothing new
  });
});

describe('outbox', () => {
  it('survives an app restart while offline and delivers afterwards', async () => {
    const token = await register();
    const a = await device(token);
    a.transport.offline = true;
    a.storage.set('transactions', [tx('t1', 10)]);
    await expect(a.engine.push()).rejects.toMatchObject({ kind: 'network' });
    expect(a.engine.pending).toBe(1);
    await a.engine.flush();
    await a.storage.flush();

    // restart: same local database, brand new engine and storage
    const again = await device(token, a.local);
    expect(again.engine.pending).toBe(1);
    expect(list(again).map((t) => t.id)).toEqual(['t1']);
    await again.engine.sync();
    expect(again.engine.pending).toBe(0);
    expect([...db.records.values()].map((r) => r.id)).toEqual(['t1']);
  });

  it('is idempotent when the server applied a push but the answer was lost', async () => {
    const token = await register();
    const a = await device(token);
    a.storage.set('transactions', [tx('t1', 10), tx('t2', 20)]);
    a.transport.dropResponse = true;
    await expect(a.engine.push()).rejects.toBeInstanceOf(SyncError);
    const revsAfterFirst = [...db.records.values()].map((r) => r.rev);
    expect(a.engine.pending).toBe(2); // still queued: it never saw the answer

    await a.engine.push(); // retry
    expect(a.engine.pending).toBe(0);
    expect(db.records.size).toBe(2); // no duplicates
    expect([...db.records.values()].map((r) => r.rev)).toEqual(revsAfterFirst); // nothing rewritten
  });

  it('a failure in the middle does not block or duplicate the rest', async () => {
    const token = await register();
    const a = await device(token, new MemoryLocalDb(), undefined, 2);
    a.storage.set('transactions', [tx('t1', 1), tx('t2', 2), tx('t3', 3), tx('t4', 4), tx('t5', 5)]);
    let calls = 0;
    const real = a.transport.push.bind(a.transport);
    a.transport.push = (ops) => {
      if (++calls === 2) throw new SyncError('network'); // second batch fails
      return real(ops);
    };
    await expect(a.engine.push()).rejects.toBeInstanceOf(SyncError);
    expect(a.engine.pending).toBe(3); // first batch of 2 is done
    a.transport.push = real;
    await a.engine.push();
    expect(a.engine.pending).toBe(0);
    expect(db.records.size).toBe(5);
  });

  it('drops a record that is created and deleted before it ever synced', async () => {
    const token = await register();
    const a = await device(token);
    a.storage.set('transactions', [tx('t1', 1)]);
    a.storage.set('transactions', []);
    expect(a.engine.pending).toBe(0);
  });

  it('an edit made while a push is in flight is not lost', async () => {
    const token = await register();
    const a = await device(token);
    a.storage.set('transactions', [tx('t1', 1)]);
    const real = a.transport.push.bind(a.transport);
    a.transport.push = async (ops) => {
      const result = await real(ops);
      clock += 1000;
      a.storage.set('transactions', [tx('t1', 2)]); // user edits during the request
      return result;
    };
    await a.engine.push();
    a.transport.push = real;
    expect(a.engine.pending).toBe(1);
    await a.engine.push();
    expect([...db.records.values()][0].data).toMatchObject({ amount: 2 });
  });

  it('rejects are counted and removed instead of retried forever', async () => {
    const token = await register();
    const a = await device(token);
    const real = a.transport.push.bind(a.transport);
    a.transport.push = (ops) => real(ops.map((o) => ({ ...o, collection: 'Bad Collection' })));
    a.storage.set('transactions', [tx('t1', 1)]);
    const summary = await a.engine.push();
    expect(summary.rejected).toBe(1);
    expect(a.engine.pending).toBe(0);
    expect(a.engine.rejectedOps).toHaveLength(1);
  });
});

describe('conflicts between devices', () => {
  async function twoDevicesEditingTheSame() {
    const token = await register();
    const a = await device(token);
    const b = await device(await login('device-bbbb'));
    a.storage.set('transactions', [tx('t1', 10)]);
    await a.engine.sync();
    await b.engine.sync();
    return { a, b };
  }

  it('the newer edit wins on both devices and the loser is kept in conflicts', async () => {
    const { a, b } = await twoDevicesEditingTheSame();
    clock += 1000;
    a.storage.set('transactions', [tx('t1', 55)]); // offline edit on A (older)
    clock += 5000;
    b.storage.set('transactions', [tx('t1', 99)]); // offline edit on B (newer)

    await b.engine.sync(); // B reaches the server first
    await a.engine.sync(); // A's older edit loses
    await b.engine.sync();

    expect(list(a)[0].amount).toBe(99);
    expect(list(b)[0].amount).toBe(99);
    const losers = list(a, 'conflicts') as unknown as { collection: string; data: { amount: number } }[];
    expect(losers).toHaveLength(1);
    expect(losers[0]).toMatchObject({ collection: 'transactions', data: { amount: 55 } });
    expect(list(b, 'conflicts')).toHaveLength(1); // visible on both devices
  });

  it('even when the older edit arrives last the newer one stays; the older one is kept', async () => {
    const { a, b } = await twoDevicesEditingTheSame();
    clock += 1000;
    a.storage.set('transactions', [tx('t1', 55)]);
    clock += 5000;
    b.storage.set('transactions', [tx('t1', 99)]);
    await a.engine.sync(); // older edit reaches the server first
    await b.engine.sync(); // newer edit wins over it
    await a.engine.sync();
    expect(list(a)[0].amount).toBe(99);
    const losers = list(a, 'conflicts') as unknown as { data: { amount: number } }[];
    expect(losers.map((c) => c.data.amount)).toEqual([55]);
  });

  it('a delete against a newer edit loses and is reported', async () => {
    const { a, b } = await twoDevicesEditingTheSame();
    clock += 1000;
    a.storage.set('transactions', []); // A deletes
    clock += 5000;
    b.storage.set('transactions', [tx('t1', 77)]); // B edits later
    await b.engine.sync();
    await a.engine.sync();
    await b.engine.sync();
    expect(list(a)).toEqual([expect.objectContaining({ amount: 77 })]); // record is back on A
    expect((list(a, 'conflicts') as unknown as { deleted: boolean }[])[0].deleted).toBe(true);
  });

  it('restoring a saved version puts it back as a normal edit that syncs', async () => {
    const { a, b } = await twoDevicesEditingTheSame();
    clock += 1000;
    a.storage.set('transactions', [tx('t1', 55)]);
    clock += 5000;
    b.storage.set('transactions', [tx('t1', 99)]);
    await b.engine.sync();
    await a.engine.sync();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: StorageService, useValue: a.storage }] });
    const conflicts = TestBed.inject(ConflictService);
    expect(conflicts.conflicts()).toHaveLength(1);
    clock += 10_000;
    conflicts.restore(conflicts.conflicts()[0]);
    expect(list(a)[0].amount).toBe(55);
    expect(conflicts.conflicts()).toHaveLength(0);

    await a.engine.sync();
    await b.engine.sync();
    expect(list(b)[0].amount).toBe(55);
  });

  it('the same change made on two devices (e.g. a recurring occurrence) is not a conflict', async () => {
    const token = await register();
    const a = await device(token);
    const b = await device(await login('device-bbbb'));
    const occurrence = tx('rec-r1-2026-11-01', 100);
    a.storage.set('transactions', [occurrence]);
    clock += 50;
    b.storage.set('transactions', [occurrence]);
    await a.engine.sync();
    await b.engine.sync();
    await a.engine.sync();
    expect(list(a)).toHaveLength(1);
    expect(list(b)).toHaveLength(1);
    expect(list(a, 'conflicts')).toEqual([]);
  });

  it('a local edit waiting in the outbox is not overwritten by a download', async () => {
    const { a, b } = await twoDevicesEditingTheSame();
    clock += 1000;
    b.storage.set('transactions', [tx('t1', 99)]);
    await b.engine.sync();
    clock += 1000;
    a.storage.set('transactions', [tx('t1', 55)]); // pending on A, newer
    a.transport.offline = false;
    await a.engine.pull();
    expect(list(a)[0].amount).toBe(55); // still the local one until push resolves it
    await a.engine.sync();
    expect(list(a)[0].amount).toBe(55); // newer edit won
  });
});

describe('first sync with existing data', () => {
  it('uploads local data in batches, resumable, and the counts match', async () => {
    const token = await register();
    const a = await device(token, new MemoryLocalDb(), FIXTURE_251, 3);
    const snapshot = a.storage.snapshotSynced();
    const queued = a.engine.enqueueSnapshot(snapshot, 0);
    expect(queued).toBeGreaterThan(0);
    // interrupted halfway
    let calls = 0;
    const real = a.transport.push.bind(a.transport);
    a.transport.push = (ops) => {
      if (++calls === 3) throw new SyncError('network');
      return real(ops);
    };
    await expect(a.engine.push()).rejects.toBeInstanceOf(SyncError);
    expect(a.engine.pending).toBeGreaterThan(0);
    const resumed = await device(token, a.local, undefined, 3); // app reopened
    await resumed.engine.push();
    expect(resumed.engine.pending).toBe(0);
    const meta = await resumed.transport.meta();
    expect(countsMatch(countLocal(snapshot), meta.counts)).toBe(true);
  });

  it('merge by id: matching records keep the server version, the other is kept in conflicts, local-only ones are added', async () => {
    const token = await register();
    const server = await device(token);
    server.storage.set('transactions', [tx('t1', 10), tx('t2', 20)]);
    clock += 1000;
    await server.engine.sync();

    const phone = await device(await login('device-bbbb'), new MemoryLocalDb(), {
      transactions: [tx('t1', 999), tx('t9', 90)],
    });
    phone.engine.enqueueSnapshot(phone.storage.snapshotSynced(), 0);
    await phone.engine.push();
    await phone.engine.pull();

    expect(list(phone).map((t) => [t.id, t.amount]).sort()).toEqual([['t1', 10], ['t2', 20], ['t9', 90]]);
    const losers = list(phone, 'conflicts') as unknown as { data: { amount: number } }[];
    expect(losers.map((c) => c.data.amount)).toEqual([999]);
    const meta = await phone.transport.meta();
    expect(countsMatch(countLocal(phone.storage.snapshotSynced()), meta.counts)).toBe(true);
  });

  it('keep the server copy: wipe, reset and pull leaves exactly the server data', async () => {
    const token = await register();
    const server = await device(token);
    server.storage.set('transactions', [tx('t1', 10)]);
    await server.engine.sync();

    const phone = await device(await login('device-bbbb'), new MemoryLocalDb(), { transactions: [tx('local', 1)] });
    phone.storage.wipeSynced();
    await phone.engine.reset();
    await phone.engine.pull();
    expect(list(phone).map((t) => t.id)).toEqual(['t1']);
    expect(phone.engine.pending).toBe(0);
  });
});

describe('sign out and sessions', () => {
  it('pending changes survive signing out and are delivered after signing in again', async () => {
    const token = await register();
    const a = await device(token);
    a.transport.offline = true;
    a.storage.set('transactions', [tx('t1', 10)]);
    await a.engine.flush();
    await a.storage.flush();
    // signed out without erasing: the outbox stays in the local copy
    const later = await device(await login('device-reg1'), a.local);
    expect(later.engine.pending).toBe(1);
    await later.engine.sync();
    expect(db.records.size).toBe(1);
  });

  it('erasing the local copy leaves no trace of the account data or outbox', async () => {
    const token = await register();
    const a = await device(token);
    a.storage.set('transactions', [tx('t1', 10)]);
    a.storage.wipeSynced();
    await a.engine.reset();
    await a.storage.flush();
    expect(a.storage.get('transactions', [])).toEqual([]);
    expect(await a.local.get('kv', 'transactions')).toBeUndefined();
    expect(a.engine.pending).toBe(0);
    expect(a.engine.cursor).toBe(0);
  });

  it('a revoked device gets an auth error from the engine and keeps its local data', async () => {
    const token = await register();
    const b = await device(await login('device-bbbb'));
    b.storage.set('transactions', [tx('t1', 10)]);
    await api.handle({ action: 'auth/revoke', body: { sessionId: [...db.sessions.values()].find((s) => s.deviceId === 'device-bbbb')!.id }, ip: '1.1.1.1', authorization: `Bearer ${token}` });
    await expect(b.engine.sync()).rejects.toMatchObject({ kind: 'auth' });
    expect(list(b)).toHaveLength(1);
    expect(b.engine.pending).toBe(1);
  });

  it('an app older than the server schema is told so (read-only)', async () => {
    const token = await register();
    await api.handle({ action: 'sync/meta', body: { schemaVersion: 2 }, ip: '1.1.1.1', authorization: `Bearer ${token}` });
    const a = await device(token);
    a.storage.set('transactions', [tx('t1', 1)]);
    await expect(a.engine.push()).rejects.toMatchObject({ kind: 'outdated' });
  });
});

describe('XMoneyApiClient', () => {
  class MemorySession implements SessionPersistence {
    data: { refreshToken: string; accountId: string; email: string } | null = { refreshToken: 'r'.repeat(30), accountId: 'a', email: 'x@example.com' };
    async load() {
      return this.data;
    }
    async save(d: { refreshToken: string; accountId: string; email: string }) {
      this.data = d;
    }
    async clear() {
      this.data = null;
    }
    async deviceId() {
      return 'device-test1';
    }
  }
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const authOk = { accessToken: 'acc2', refreshToken: 'n'.repeat(30), sessionId: 's', account: { id: 'a', email: 'x@example.com' }, serverNow: Date.now() };

  it('shares one refresh between parallel requests and retries them with the new token', async () => {
    const session = new MemorySession();
    let refreshes = 0;
    const seen: (string | undefined)[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/auth/refresh')) {
        refreshes++;
        return json(200, authOk);
      }
      const auth = (init?.headers as Record<string, string>)['Authorization'];
      seen.push(auth);
      return auth === 'Bearer acc2' ? json(200, { ok: true }) : json(401, { error: 'unauthorized' });
    }) as unknown as typeof fetch;
    const client = new XMoneyApiClient('https://x.test/api', session, fetchFn);
    await Promise.all([client.call('sync/meta'), client.call('sync/pull'), client.call('auth/sessions')]);
    expect(refreshes).toBe(1);
    expect(session.data?.refreshToken).toBe(authOk.refreshToken); // rotated token persisted
  });

  it('a revoked session clears the token but reports it so the data is kept and the user signs in again', async () => {
    const session = new MemorySession();
    const lost = vi.fn();
    const fetchFn = (async (url: string | URL | Request) =>
      String(url).endsWith('/auth/refresh') ? json(401, { error: 'refresh_reused' }) : json(401, { error: 'unauthorized' })) as typeof fetch;
    const client = new XMoneyApiClient('https://x.test/api', session, fetchFn);
    client.onSessionLost = lost;
    await expect(client.call('sync/meta')).rejects.toMatchObject({ status: 401 });
    expect(lost).toHaveBeenCalled();
    expect(session.data).toBeNull();
  });

  it('retries sync calls on network errors and 5xx, but never the ones that are not idempotent', async () => {
    const session = new MemorySession();
    let calls = 0;
    const flaky = (async (url: string | URL | Request) => {
      if (String(url).endsWith('/auth/refresh')) return json(200, authOk);
      if (++calls < 3) throw new TypeError('offline');
      return json(200, { ok: true });
    }) as unknown as typeof fetch;
    const sleep = vi.fn(async () => undefined);
    const client = new XMoneyApiClient('https://x.test/api', session, flaky, sleep);
    await expect(client.call('sync/pull', {}, { retry: true })).resolves.toEqual({ ok: true });
    expect(calls).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);

    calls = 0;
    await expect(client.call('auth/login', {}, { auth: false })).rejects.toMatchObject({ status: 0, code: 'network' });
    expect(calls).toBe(1);

    const always500 = (async () => json(500, { error: 'server_error' })) as typeof fetch;
    const c2 = new XMoneyApiClient('https://x.test/api', new MemorySession(), always500, async () => undefined);
    await expect(c2.call('sync/pull', {}, { auth: false, retry: true })).rejects.toMatchObject({ status: 500 });
  });

  it('times out hanging requests', async () => {
    const hang = ((_u: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as unknown as typeof fetch;
    const client = new XMoneyApiClient('https://x.test/api', new MemorySession(), hang, async () => undefined, 20);
    await expect(client.call('auth/login', {}, { auth: false })).rejects.toBeInstanceOf(ApiError);
  });

  it('maps API failures to sync error kinds', async () => {
    const make = (status: number) =>
      new ApiTransport(new XMoneyApiClient('https://x.test/api', new MemorySession(), (async (url: string | URL | Request) =>
        String(url).endsWith('/auth/refresh') ? json(200, authOk) : json(status, { error: 'x' })) as typeof fetch, async () => undefined));
    await expect(make(409).pull(0, 1)).rejects.toMatchObject({ kind: 'outdated' });
    await expect(make(403).pull(0, 1)).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(make(429).pull(0, 1)).rejects.toMatchObject({ kind: 'server' });
  });

  it('sends no credentials with sign-in calls and never puts the token in the URL', async () => {
    let init: RequestInit | undefined;
    let url = '';
    const fetchFn = (async (u: string | URL | Request, i?: RequestInit) => {
      url = String(u);
      init = i;
      return json(200, authOk);
    }) as typeof fetch;
    const client = new XMoneyApiClient('https://x.test/api', new MemorySession(), fetchFn);
    await client.call('auth/login', { email: 'x' }, { auth: false });
    expect((init?.headers as Record<string, string>)['Authorization']).toBeUndefined();
    expect(init?.credentials).toBe('omit');
    expect(url).toBe('https://x.test/api/auth/login');
  });
});
