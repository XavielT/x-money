// Server-side logic of xmoney-api (accounts, sessions, sync) against the in-memory Db.
import { beforeEach } from 'vitest';
import { createApi, type ApiResponse } from '../../supabase/functions/xmoney-api/lib/api.ts';
import { MemoryDb } from '../../supabase/functions/xmoney-api/lib/memory-db.ts';
import { hashPassword, verifyPassword } from '../../supabase/functions/xmoney-api/lib/crypto.ts';
import { signAccessToken, verifyAccessToken } from '../../supabase/functions/xmoney-api/lib/tokens.ts';

const SECRET = 'x'.repeat(40);
const KDF = { alg: 'PBKDF2-SHA256', iterations: 1000 } as const;
const PW = 'correct horse battery';
const MIN = 60_000;

let t = 1_800_000_000_000;
let db: MemoryDb;
let api: ReturnType<typeof createApi>;

const call = (action: string, body: Record<string, unknown> = {}, token?: string, ip = '1.1.1.1'): Promise<ApiResponse> =>
  api.handle({ action, body, ip, authorization: token ? `Bearer ${token}` : null });

const signup = (email = 'xavier@example.com', device = 'device-aaaa', extra: Record<string, unknown> = {}) =>
  call('auth/signup', { email, password: PW, inviteCode: 'invite-me', deviceId: device, deviceLabel: 'Test', ...extra });

const login = (email = 'xavier@example.com', password = PW, device = 'device-aaaa') =>
  call('auth/login', { email, password, deviceId: device });

async function newUser(email = 'xavier@example.com', device = 'device-aaaa') {
  const r = await signup(email, device);
  expect(r.status).toBe(200);
  return r.body as { accessToken: string; refreshToken: string; recoveryCode: string; sessionId: string; account: { id: string } };
}

beforeEach(() => {
  t = 1_800_000_000_000;
  db = new MemoryDb();
  db.clock = () => t;
  api = createApi({ db, tokenSecret: SECRET, signupCode: 'invite-me', now: () => t, kdf: KDF });
});

describe('passwords', () => {
  it('hashes with a random salt and verifies in constant-time style', async () => {
    const a = await hashPassword(PW, KDF);
    const b = await hashPassword(PW, KDF);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(await verifyPassword(PW, a.hash, a.salt, KDF)).toBe(true);
    expect(await verifyPassword(PW + 'x', a.hash, a.salt, KDF)).toBe(false);
  });

  it('never stores the plain password or the plain recovery code', async () => {
    const u = await newUser();
    const row = [...db.accounts.values()][0];
    const stored = JSON.stringify(row);
    expect(stored).not.toContain(PW);
    expect(stored).not.toContain(u.recoveryCode.replace(/-/g, ''));
    expect(row.kdfParams.iterations).toBe(1000);
  });

  it('rejects short passwords', async () => {
    expect((await signup('a@example.com', 'device-aaaa', { password: 'abcde' })).body['error']).toBe('weak_password');
    expect((await signup('six@example.com', 'device-aaaa', { password: 'abcdef' })).status).toBe(200); // 6 characters is the minimum
  });
});

describe('signup', () => {
  it('requires the invite code and gives the same generic error for everything else', async () => {
    const noCode = await call('auth/signup', { email: 'a@example.com', password: PW, deviceId: 'device-aaaa' });
    const badCode = await signup('a@example.com', 'device-aaaa', { inviteCode: 'wrong' });
    expect(noCode.body['error']).toBe('signup_failed');
    expect(badCode).toEqual(noCode);
    await newUser();
    const duplicate = await signup('XAVIER@example.com ');
    expect(duplicate).toEqual(noCode); // an existing email is indistinguishable
  });

  it('is disabled when no invite code is configured', async () => {
    api = createApi({ db, tokenSecret: SECRET, signupCode: null, now: () => t, kdf: KDF });
    expect((await signup()).body['error']).toBe('signup_failed');
  });

  it('normalizes the email (case, spaces, NFKC)', async () => {
    await newUser('  Xavier@Example.COM ');
    expect([...db.accounts.values()][0].email).toBe('xavier@example.com');
    expect((await login('ＸＡＶＩＥＲ@example.com')).status).toBe(200);
  });

  it('the same email registered elsewhere does not collide (accounts live only in xmoney.accounts)', async () => {
    // "another app" = another store with the same address: only this Db decides uniqueness
    const otherApp = createApi({ db: new MemoryDb(), tokenSecret: SECRET, signupCode: 'invite-me', now: () => t, kdf: KDF });
    const body = { email: 'xavier@example.com', password: PW, inviteCode: 'invite-me', deviceId: 'device-aaaa' };
    expect((await otherApp.handle({ action: 'auth/signup', body, ip: '1.1.1.1', authorization: null })).status).toBe(200);
    expect((await signup()).status).toBe(200);
  });
});

describe('login', () => {
  it('gives one message for unknown email and wrong password', async () => {
    await newUser();
    const wrong = await login('xavier@example.com', 'wrong password!!');
    const unknown = await login('nobody@example.com');
    expect(wrong.status).toBe(401);
    expect(unknown).toEqual(wrong);
    expect(wrong.body['error']).toBe('invalid_credentials');
  });

  it('pays a PBKDF2 for unknown emails too (similar response time)', async () => {
    api = createApi({ db, tokenSecret: SECRET, signupCode: 'invite-me', now: () => t, kdf: { alg: 'PBKDF2-SHA256', iterations: 60_000 } });
    await newUser();
    await login('warm@example.com'); // creates the decoy hash
    const time = async (email: string) => {
      const s = performance.now();
      await login(email, 'wrong password!!');
      return performance.now() - s;
    };
    const known = await time('xavier@example.com');
    const unknown = await time('ghost@example.com');
    expect(unknown).toBeGreaterThan(known * 0.4);
    expect(unknown).toBeLessThan(known * 2.5);
  });

  it('locks the account for 15 minutes after 5 failures, even with the right password', async () => {
    await newUser();
    for (let i = 0; i < 5; i++) expect((await login('xavier@example.com', 'wrong password!!')).status).toBe(401);
    const locked = await login();
    expect(locked.status).toBe(423);
    expect(locked.body['retryAfterSeconds']).toBeGreaterThan(800);
    t += 16 * MIN;
    expect((await login()).status).toBe(200);
  });

  it('applies the same lock to unknown emails (cannot be told apart)', async () => {
    for (let i = 0; i < 5; i++) await login('ghost@example.com');
    expect((await login('ghost@example.com')).status).toBe(423);
  });

  it('rate limits by IP', async () => {
    await newUser();
    let last = 0;
    for (let i = 0; i < 45; i++) last = (await call('auth/login', { email: 'xavier@example.com', password: PW, deviceId: 'device-aaaa' }, undefined, '9.9.9.9')).status;
    expect(last).toBe(429);
  });

  it('a disabled account stops working at once (login and live tokens)', async () => {
    const u = await newUser();
    [...db.accounts.values()][0].enabled = false;
    expect((await call('sync/meta', {}, u.accessToken)).status).toBe(401);
    expect((await login()).status).toBe(403);
    expect((await call('auth/refresh', { refreshToken: u.refreshToken })).status).toBe(401);
  });
});

describe('tokens', () => {
  it('accepts a valid token and rejects forged, tampered and expired ones', async () => {
    const good = await signAccessToken({ sub: 'a', sid: 's' }, SECRET, t);
    expect((await verifyAccessToken(good, SECRET, t))?.sub).toBe('a');
    const [h, p, s] = good.split('.');
    const forgedPayload = btoa(JSON.stringify({ sub: 'attacker', sid: 's', exp: 9_999_999_999 })).replace(/=/g, '');
    expect(await verifyAccessToken(`${h}.${forgedPayload}.${s}`, SECRET, t)).toBeNull();
    expect(await verifyAccessToken(good, 'y'.repeat(40), t)).toBeNull();
    const none = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })).replace(/=/g, '');
    expect(await verifyAccessToken(`${none}.${p}.`, SECRET, t)).toBeNull();
    expect(await verifyAccessToken('garbage', SECRET, t)).toBeNull();
    expect(await verifyAccessToken(good, SECRET, t + 31 * MIN)).toBeNull();
  });

  it('refuses a token secret shorter than 32 bytes', async () => {
    await expect(signAccessToken({ sub: 'a', sid: 's' }, 'short', t)).rejects.toThrow();
  });

  it('a valid token of a revoked session stops working', async () => {
    const u = await newUser();
    expect((await call('sync/meta', {}, u.accessToken)).status).toBe(200);
    await call('auth/logout', {}, u.accessToken);
    expect((await call('sync/meta', {}, u.accessToken)).status).toBe(401);
  });

  it('expired access tokens are refused until refreshed', async () => {
    const u = await newUser();
    t += 31 * MIN;
    expect((await call('sync/meta', {}, u.accessToken)).status).toBe(401);
    const r = await call('auth/refresh', { refreshToken: u.refreshToken });
    expect(r.status).toBe(200);
    expect((await call('sync/meta', {}, r.body['accessToken'] as string)).status).toBe(200);
  });
});

describe('refresh rotation', () => {
  it('rotates the token on every use and slides the 90-day window', async () => {
    const u = await newUser();
    const first = await call('auth/refresh', { refreshToken: u.refreshToken });
    expect(first.body['refreshToken']).not.toBe(u.refreshToken);
    t += 80 * 24 * 60 * MIN;
    const second = await call('auth/refresh', { refreshToken: first.body['refreshToken'] });
    expect(second.status).toBe(200);
    t += 80 * 24 * 60 * MIN; // 160 days since signup, 80 since last use: still alive
    expect((await call('auth/refresh', { refreshToken: second.body['refreshToken'] })).status).toBe(200);
  });

  it('expires after 90 idle days', async () => {
    const u = await newUser();
    t += 91 * 24 * 60 * MIN;
    expect((await call('auth/refresh', { refreshToken: u.refreshToken })).status).toBe(401);
  });

  it('reusing an old refresh token revokes that session', async () => {
    const u = await newUser();
    const next = await call('auth/refresh', { refreshToken: u.refreshToken });
    const replay = await call('auth/refresh', { refreshToken: u.refreshToken });
    expect(replay.body['error']).toBe('refresh_reused');
    expect((await call('auth/refresh', { refreshToken: next.body['refreshToken'] })).status).toBe(401);
    expect((await call('sync/meta', {}, next.body['accessToken'] as string)).status).toBe(401);
  });

  it('stores only the hash of the refresh token', async () => {
    const u = await newUser();
    expect(JSON.stringify([...db.sessions.values()])).not.toContain(u.refreshToken);
  });
});

describe('password change, recovery and sessions', () => {
  it('changing the password revokes the other sessions and keeps the current one', async () => {
    const a = await newUser('xavier@example.com', 'device-aaaa');
    const bLogin = await login('xavier@example.com', PW, 'device-bbbb');
    const b = bLogin.body as { accessToken: string };
    const r = await call('auth/change-password', { currentPassword: PW, newPassword: 'a brand new password' }, a.accessToken);
    expect(r.status).toBe(200);
    expect((await call('sync/meta', {}, b.accessToken)).status).toBe(401);
    expect((await call('sync/meta', {}, a.accessToken)).status).toBe(200);
    expect((await login('xavier@example.com', 'a brand new password')).status).toBe(200);
    expect((await login()).status).toBe(401);
  });

  it('refuses to change the password with a wrong current one', async () => {
    const u = await newUser();
    expect((await call('auth/change-password', { currentPassword: 'nope nope nope', newPassword: 'another good one' }, u.accessToken)).status).toBe(401);
  });

  it('recovers with the recovery code, revokes every session and rotates the code', async () => {
    const u = await newUser();
    const r = await call('auth/recover', { email: 'xavier@example.com', recoveryCode: u.recoveryCode, newPassword: 'recovered password' });
    expect(r.status).toBe(200);
    const fresh = r.body['recoveryCode'] as string;
    expect(fresh).not.toBe(u.recoveryCode);
    expect((await call('sync/meta', {}, u.accessToken)).status).toBe(401);
    expect((await login('xavier@example.com', 'recovered password')).status).toBe(200);
    const again = await call('auth/recover', { email: 'xavier@example.com', recoveryCode: u.recoveryCode, newPassword: 'hijack password!' });
    expect(again.body['error']).toBe('recovery_failed'); // the old code died
    expect((await call('auth/recover', { email: 'xavier@example.com', recoveryCode: fresh.toLowerCase(), newPassword: 'second recovery' })).status).toBe(200);
  });

  it('recovery fails the same way for unknown emails and wrong codes, and locks after 5 tries', async () => {
    await newUser();
    const wrong = await call('auth/recover', { email: 'xavier@example.com', recoveryCode: 'A'.repeat(32), newPassword: 'whatever it is' });
    const ghost = await call('auth/recover', { email: 'ghost@example.com', recoveryCode: 'A'.repeat(32), newPassword: 'whatever it is' });
    expect(wrong).toEqual(ghost);
    for (let i = 0; i < 4; i++) await call('auth/recover', { email: 'xavier@example.com', recoveryCode: 'B'.repeat(32), newPassword: 'whatever it is' });
    expect((await call('auth/recover', { email: 'xavier@example.com', recoveryCode: 'B'.repeat(32), newPassword: 'whatever it is' })).status).toBe(423);
  });

  it('regenerates the recovery code only with the password', async () => {
    const u = await newUser();
    expect((await call('auth/regenerate-recovery', { password: 'wrong wrong wrong' }, u.accessToken)).status).toBe(401);
    const r = await call('auth/regenerate-recovery', { password: PW }, u.accessToken);
    expect(r.body['recoveryCode']).not.toBe(u.recoveryCode);
    expect((await call('auth/recover', { email: 'xavier@example.com', recoveryCode: u.recoveryCode, newPassword: 'whatever it is' })).status).toBe(400);
  });

  it('lists devices and lets one revoke another, but never another account\'s', async () => {
    const a = await newUser('xavier@example.com', 'device-aaaa');
    const b = (await login('xavier@example.com', PW, 'device-bbbb')).body as { sessionId: string; accessToken: string };
    const list = (await call('auth/sessions', {}, a.accessToken)).body['sessions'] as { id: string; current: boolean }[];
    expect(list).toHaveLength(2);
    expect(list.find((s) => s.current)?.id).toBe(a.sessionId);
    expect((await call('auth/revoke', { sessionId: b.sessionId }, a.accessToken)).status).toBe(200);
    expect((await call('sync/meta', {}, b.accessToken)).status).toBe(401);

    const other = await newUser('other@example.com', 'device-cccc');
    expect((await call('auth/revoke', { sessionId: a.sessionId }, other.accessToken)).status).toBe(404);
  });
});

describe('hostile input', () => {
  const evil = `x';drop-table-records;--`;

  it('treats SQL-looking text as plain data in emails, collections and ids', async () => {
    const u = await newUser();
    expect((await call('auth/login', { email: `${evil}@example.com`, password: evil, deviceId: 'device-aaaa' })).status).toBe(401);
    const r = await call('sync/push', {
      schemaVersion: 1,
      ops: [
        { collection: evil, id: 'a', data: {}, schemaVersion: 1, clientUpdatedAt: t, baseRev: 0 },
        { collection: 'notes', id: evil, data: {}, schemaVersion: 1, clientUpdatedAt: t, baseRev: 0 },
        { collection: 'notes', id: 'ok-1', data: { text: evil }, schemaVersion: 1, clientUpdatedAt: t, baseRev: 0 },
      ],
    }, u.accessToken);
    const results = r.body['results'] as { status: string }[];
    expect(results.map((x) => x.status)).toEqual(['invalid', 'invalid', 'ok']);
    expect([...db.records.values()].find((x) => x.id === 'ok-1')?.data).toEqual({ text: evil });
  });
});

describe('sync', () => {
  let u: Awaited<ReturnType<typeof newUser>>;
  beforeEach(async () => {
    u = await newUser('xavier@example.com', 'device-aaaa');
  });

  const op = (id: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    collection: 'transactions',
    id,
    data,
    schemaVersion: 1,
    clientUpdatedAt: t,
    baseRev: 0,
    ...extra,
  });
  const push = (ops: unknown[], token = u.accessToken) => call('sync/push', { schemaVersion: 1, ops }, token);
  const pull = async (since = 0, limit = 500, token = u.accessToken) =>
    (await call('sync/pull', { since, limit }, token)).body as {
      records: { id: string; collection: string; rev: number; deleted: boolean; data: unknown }[];
      hasMore: boolean;
      cursor: number;
    };

  it('pushes and pulls records, with a server-assigned rev', async () => {
    const r = await push([op('t1', { amount: 10 }), op('t2', { amount: 20 })]);
    expect((r.body['results'] as { status: string }[]).map((x) => x.status)).toEqual(['ok', 'ok']);
    const p = await pull();
    expect(p.records.map((x) => x.id)).toEqual(['t1', 't2']);
    expect(p.records[1].rev).toBeGreaterThan(p.records[0].rev);
  });

  it('is idempotent: repeating the same batch does not duplicate or bump revs', async () => {
    const batch = [op('t1', { amount: 10 })];
    await push(batch);
    const rev = (await pull()).records[0].rev;
    await push(batch);
    await push(batch);
    const p = await pull();
    expect(p.records).toHaveLength(1);
    expect(p.records[0].rev).toBe(rev);
  });

  it('ignores an invalid op without blocking the rest of the batch', async () => {
    const r = await push([{ collection: 'x' }, op('t1', { a: 1 }), op('t2', 'nope' as never)]);
    expect((r.body['results'] as { status: string }[]).map((x) => x.status)).toEqual(['invalid', 'ok', 'invalid']);
  });

  it('rejects oversized records and batches', async () => {
    const big = (await push([op('t1', { blob: 'x'.repeat(300_000) })])).body['results'] as { status: string }[];
    expect(big[0].status).toBe('invalid');
    expect((await push(Array.from({ length: 501 }, (_, i) => op(`t${i}`, {})))).status).toBe(400);
  });

  it('paginates 5,000 records by rev cursor without gaps or repeats', async () => {
    for (let i = 0; i < 10; i++) {
      await push(Array.from({ length: 500 }, (_, j) => op(`t${i * 500 + j}`, { n: i * 500 + j })));
    }
    const seen = new Set<string>();
    let cursor = 0;
    let pages = 0;
    for (;;) {
      const p = await pull(cursor, 1000);
      p.records.forEach((r) => seen.add(r.id));
      cursor = p.cursor;
      pages++;
      if (!p.hasMore) break;
    }
    expect(seen.size).toBe(5000);
    expect(pages).toBe(5);
    expect((await pull(cursor)).records).toEqual([]);
  });

  it('delivers deletes as tombstones and keeps the data recoverable server-side', async () => {
    await push([op('t1', { amount: 10 })]);
    const rev = (await pull()).records[0].rev;
    await push([{ collection: 'transactions', id: 't1', deleted: true, schemaVersion: 1, clientUpdatedAt: t + 1000, baseRev: rev }]);
    const p = await pull(rev);
    expect(p.records[0]).toMatchObject({ id: 't1', deleted: true, data: null });
    expect([...db.records.values()][0].data).toEqual({ amount: 10 });
  });

  it('newer edit from another device wins and the older version goes to conflicts', async () => {
    await push([op('t1', { amount: 10 }, { clientUpdatedAt: t })]);
    const rev = (await pull()).records[0].rev;
    const b = (await login('xavier@example.com', PW, 'device-bbbb')).body as { accessToken: string };
    await push([op('t1', { amount: 99 }, { clientUpdatedAt: t + 5000, baseRev: rev })], b.accessToken);
    // device A, still based on `rev`, edited earlier than B: it loses and is kept
    const lost = await push([op('t1', { amount: 55 }, { clientUpdatedAt: t + 1000, baseRev: rev })]);
    expect((lost.body['results'] as { status: string }[])[0].status).toBe('lost');
    const all = (await pull()).records;
    expect(all.find((r) => r.collection === 'transactions')?.data).toEqual({ amount: 99 });
    const conflicts = all.filter((r) => r.collection === 'conflicts').map((r) => r.data as { data: { amount: number }; recordId: string });
    expect(conflicts.map((c) => c.data.amount).sort()).toEqual([55]);
    expect(conflicts[0].recordId).toBe('t1');
  });

  it('when the op is the newest it wins and the previous server version is kept as a conflict', async () => {
    await push([op('t1', { amount: 10 }, { clientUpdatedAt: t })]);
    const rev = (await pull()).records[0].rev;
    const b = (await login('xavier@example.com', PW, 'device-bbbb')).body as { accessToken: string };
    await push([op('t1', { amount: 20 }, { clientUpdatedAt: t + 1000, baseRev: rev })], b.accessToken);
    const won = await push([op('t1', { amount: 30 }, { clientUpdatedAt: t + 9000, baseRev: rev })]);
    expect((won.body['results'] as { status: string }[])[0].status).toBe('won');
    const all = (await pull()).records;
    expect(all.find((r) => r.collection === 'transactions')?.data).toEqual({ amount: 30 });
    expect(all.filter((r) => r.collection === 'conflicts').map((r) => (r.data as { data: { amount: number } }).data.amount)).toEqual([20]);
  });

  it('a delete against a newer edit loses and the delete is recorded', async () => {
    await push([op('t1', { amount: 10 })]);
    const rev = (await pull()).records[0].rev;
    const b = (await login('xavier@example.com', PW, 'device-bbbb')).body as { accessToken: string };
    await push([op('t1', { amount: 77 }, { clientUpdatedAt: t + 5000, baseRev: rev })], b.accessToken);
    const r = await push([{ collection: 'transactions', id: 't1', deleted: true, schemaVersion: 1, clientUpdatedAt: t + 1000, baseRev: rev }]);
    expect((r.body['results'] as { status: string }[])[0].status).toBe('lost');
    const all = (await pull()).records;
    expect(all.find((x) => x.collection === 'transactions')).toMatchObject({ deleted: false, data: { amount: 77 } });
    expect(all.find((x) => x.collection === 'conflicts')?.data).toMatchObject({ deleted: true });
  });

  it('caps a device clock that runs far ahead so it cannot win every conflict', async () => {
    await push([op('t1', { amount: 1 }, { clientUpdatedAt: t + 365 * 24 * 60 * MIN })]);
    expect([...db.records.values()][0].clientUpdatedAt).toBeLessThanOrEqual(t + 5 * MIN);
  });

  it('serves each account only its own records', async () => {
    await push([op('t1', { amount: 10 })]);
    const other = await newUser('other@example.com', 'device-cccc');
    expect((await pull(0, 500, other.accessToken)).records).toEqual([]);
    await push([op('t1', { amount: 5 })], other.accessToken);
    expect((await pull()).records.map((r) => r.data)).toEqual([{ amount: 10 }]);
  });

  it('puts an outdated client in read-only mode and lets the new schema be announced in order', async () => {
    await call('sync/meta', { schemaVersion: 2 }, u.accessToken);
    const r = await call('sync/push', { schemaVersion: 1, ops: [] }, u.accessToken);
    expect(r.status).toBe(409);
    expect(r.body['error']).toBe('client_outdated');
    expect((await call('sync/push', { schemaVersion: 2, ops: [] }, u.accessToken)).status).toBe(200);
    expect((await call('sync/meta', { schemaVersion: 1 }, u.accessToken)).status).toBe(400); // never goes down
  });

  it('reports record counts for the first-sync wizard', async () => {
    await push([op('t1', {}), op('t2', {}), { collection: 'accounts', id: 'a1', data: {}, schemaVersion: 1, clientUpdatedAt: t, baseRev: 0 }]);
    const m = await call('sync/meta', {}, u.accessToken);
    expect(m.body['counts']).toEqual({ transactions: 2, accounts: 1 });
  });

  it('requires authentication for everything under sync/', async () => {
    expect((await call('sync/pull', {})).status).toBe(401);
    expect((await call('sync/push', { ops: [] }, 'bogus')).status).toBe(401);
  });
});
