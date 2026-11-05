// X Money API: accounts, sessions and sync. Pure logic over the Db interface (no
// Deno imports) so vitest can exercise it with the in-memory Db.
import type { AccountRow, Db, RecordRow, SessionRow } from './db.ts';
import {
  DEFAULT_KDF,
  hashPassword,
  randomBytes,
  randomToken,
  sha256Hex,
  timingSafeEqualText,
  verifyPassword,
  type KdfParams,
} from './crypto.ts';
import { ACCESS_TTL_SECONDS, signAccessToken, verifyAccessToken } from './tokens.ts';
import {
  MAX_BATCH_OPS,
  MAX_RECORD_BYTES,
  cleanLabel,
  isCollection,
  isDeviceId,
  isRecordId,
  isStrongEnough,
  newRecoveryCode,
  normalizeEmail,
  normalizeRecoveryCode,
} from './validate.ts';

const MAX_ACTIVE_INVITES = 5;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// no 0/O/1/I/L: a code is read aloud and typed on a phone
const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// "ABCDE-FGHJK": 10 characters from 31 symbols (about 49 bits), single use, expires in 7 days
export function newInviteCode(bytes: Uint8Array): string {
  const chars = [...bytes.slice(0, 10)].map((b) => INVITE_ALPHABET[b % INVITE_ALPHABET.length]);
  while (chars.length < 10) chars.push(INVITE_ALPHABET[0]);
  return `${chars.slice(0, 5).join('')}-${chars.slice(5).join('')}`;
}

// Case, spaces and the hyphen do not matter when typing a code
const inviteHash = (code: string): Promise<string> => sha256Hex('invite:' + code.toUpperCase().replace(/[^A-Z0-9]/g, ''));

export interface ApiDeps {
  db: Db;
  tokenSecret: string;
  signupCode: string | null; // null = signup disabled
  now: () => number;
  kdf?: KdfParams; // tests lower it for speed
}

export interface ApiRequest {
  action: string;
  body: Record<string, unknown>;
  ip: string;
  authorization: string | null;
}

export interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SESSION_MS = 90 * DAY;
const MAX_FAILS = 5;
const LOCK_MS = 15 * MINUTE;
const MAX_CLOCK_AHEAD_MS = 5 * MINUTE;

// key-order independent comparison (jsonb does not keep key order)
function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v
  );
}
const sameJson = (a: unknown, b: unknown) => stable(a) === stable(b);

type Auth = { account: AccountRow; session: SessionRow };
type Json = Record<string, unknown>;

const reply = (status: number, body: Json = {}): ApiResponse => ({ status, body });
const fail = (status: number, error: string, extra: Json = {}): ApiResponse =>
  reply(status, { error, ...extra });

export function createApi(deps: ApiDeps) {
  const { db, tokenSecret, now } = deps;
  const kdf = deps.kdf ?? DEFAULT_KDF;
  let decoy: Promise<{ hash: string; salt: string; kdf: KdfParams }> | null = null;

  // Hash of a throwaway password: unknown emails still pay one PBKDF2 so response
  // time does not reveal which emails exist
  const decoyVerify = async (password: string) => {
    decoy ??= hashPassword('decoy-password-for-timing', kdf);
    const d = await decoy;
    await verifyPassword(password, d.hash, d.salt, d.kdf);
  };

  const lockedReply = (ms: number) => fail(423, 'locked', { retryAfterSeconds: Math.max(1, Math.ceil(ms / 1000)) });

  async function startSession(account: AccountRow, deviceId: string, label: string) {
    const t = now();
    // one live session per device: logging in again replaces the previous one
    for (const old of await db.listSessions(account.id)) {
      if (old.deviceId === deviceId && !old.revokedAt) await db.updateSession(old.id, { revokedAt: t });
    }
    const refreshToken = randomToken(32);
    const session: SessionRow = {
      id: crypto.randomUUID(),
      accountId: account.id,
      refreshHash: await sha256Hex(refreshToken),
      prevRefreshHash: null,
      deviceId,
      deviceLabel: label,
      createdAt: t,
      lastUsedAt: t,
      expiresAt: t + SESSION_MS,
      revokedAt: null,
    };
    await db.insertSession(session);
    return {
      accessToken: await signAccessToken({ sub: account.id, sid: session.id }, tokenSecret, t),
      refreshToken,
      expiresIn: ACCESS_TTL_SECONDS,
      sessionId: session.id,
      account: { id: account.id, email: account.email },
      serverNow: t,
    };
  }

  async function authenticate(header: string | null): Promise<Auth | null> {
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return null;
    const claims = await verifyAccessToken(token, tokenSecret, now());
    if (!claims) return null;
    const session = await db.findSessionById(claims.sid);
    if (!session || session.accountId !== claims.sub || session.revokedAt || session.expiresAt <= now()) return null;
    const account = await db.findAccountById(claims.sub);
    return account?.enabled ? { account, session } : null;
  }

  // Password check for an existing account that also counts failures and locks
  async function tryPassword(account: AccountRow, password: string): Promise<'ok' | 'bad' | 'locked'> {
    const t = now();
    if (account.lockedUntil && account.lockedUntil > t) return 'locked';
    const ok = await verifyPassword(password, account.passwordHash, account.passwordSalt, account.kdfParams as KdfParams);
    if (ok) {
      if (account.failedAttempts || account.lockedUntil) {
        await db.updateAccount(account.id, { failedAttempts: 0, lockedUntil: null });
      }
      return 'ok';
    }
    const failed = account.failedAttempts + 1;
    await db.updateAccount(
      account.id,
      failed >= MAX_FAILS ? { failedAttempts: 0, lockedUntil: t + LOCK_MS } : { failedAttempts: failed }
    );
    return 'bad';
  }

  // ---------------------------------------------------------------- auth

  async function signup(req: ApiRequest): Promise<ApiResponse> {
    const b = req.body;
    const ip = await db.hitRateLimit(`signup-ip:${req.ip}`, now(), HOUR);
    if (ip.count > 10) return fail(429, 'too_many_requests');
    const email = normalizeEmail(b['email']);
    if (!email || !isDeviceId(b['deviceId'])) return fail(400, 'bad_request');
    if (!isStrongEnough(b['password'])) return fail(400, 'weak_password');
    // from here on every failure looks the same, so signup cannot probe for emails
    const generic = fail(400, 'signup_failed');
    // The invite code keeps strangers out of a personal backend. The very FIRST account (the owner's)
    // needs none: while no account exists there is nobody to protect and no code to have shared yet.
    // Codes that work: the shared secret of the server, or a one-time invite made by the owner in Settings.
    const code = typeof b['inviteCode'] === 'string' ? b['inviteCode'] : '';
    const secretOk = !!deps.signupCode && !!code && timingSafeEqualText(code, deps.signupCode);
    let claimed: string | null = null; // the invite taken by this signup, given back if the signup does not finish
    if (!secretOk && (await db.countAccounts()) > 0) {
      const hash = await inviteHash(code);
      if (!code || !(await db.claimInvite(hash, now()))) return generic;
      claimed = hash;
    }

    const pw = await hashPassword(b['password'], kdf);
    const recovery = newRecoveryCode(randomBytes(32));
    const t = now();
    const account: AccountRow = {
      id: crypto.randomUUID(),
      email,
      passwordHash: pw.hash,
      passwordSalt: pw.salt,
      kdfParams: pw.kdf,
      recoveryHash: await sha256Hex(recovery.code),
      enabled: true,
      aiEnabled: false,
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: t,
      lastLoginAt: t,
    };
    if (!(await db.insertAccount(account))) {
      if (claimed) await db.releaseInvite(claimed); // the email was taken: the invite is not spent
      return generic;
    }
    const session = await startSession(account, b['deviceId'], cleanLabel(b['deviceLabel']));
    return reply(200, { ...session, recoveryCode: recovery.display });
  }

  // ---------------------------------------------------------------- invites

  // Only the owner (the first account) can invite. The code is shown ONCE: only its hash is stored.
  async function createInvite(auth: Auth): Promise<ApiResponse> {
    if ((await db.ownerAccountId()) !== auth.account.id) return fail(403, 'not_owner');
    const t = now();
    if ((await db.countActiveInvites(auth.account.id, t)) >= MAX_ACTIVE_INVITES) return fail(429, 'too_many_invites');
    const code = newInviteCode(randomBytes(8));
    await db.insertInvite({ codeHash: await inviteHash(code), createdBy: auth.account.id, createdAt: t, expiresAt: t + INVITE_TTL_MS });
    return reply(200, { code, expiresAt: t + INVITE_TTL_MS });
  }

  async function login(req: ApiRequest): Promise<ApiResponse> {
    const b = req.body;
    const email = normalizeEmail(b['email']);
    const password = b['password'];
    if (!email || typeof password !== 'string' || password.length > 200 || !isDeviceId(b['deviceId'])) {
      return fail(400, 'bad_request');
    }
    const t = now();
    const ip = await db.hitRateLimit(`login-ip:${req.ip}`, t, 10 * MINUTE);
    if (ip.count > 40) return fail(429, 'too_many_requests');

    const account = await db.findAccountByEmail(email);
    if (!account) {
      // unknown emails get the same failure counter, lock and timing as real ones
      const w = await db.peekRateLimit(`login-fail:${email}`, t, LOCK_MS);
      if (w.count >= MAX_FAILS) return lockedReply(w.windowStart + LOCK_MS - t);
      await decoyVerify(password);
      await db.hitRateLimit(`login-fail:${email}`, t, LOCK_MS);
      return fail(401, 'invalid_credentials');
    }
    const outcome = await tryPassword(account, password);
    if (outcome === 'locked') return lockedReply((account.lockedUntil ?? t) - t);
    if (outcome === 'bad') return fail(401, 'invalid_credentials');
    if (!account.enabled) return fail(403, 'account_disabled');
    await db.updateAccount(account.id, { lastLoginAt: t });
    return reply(200, await startSession(account, b['deviceId'], cleanLabel(b['deviceLabel'])));
  }

  async function refresh(req: ApiRequest): Promise<ApiResponse> {
    const token = req.body['refreshToken'];
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) return fail(401, 'invalid_refresh');
    const hash = await sha256Hex(token);
    const session = await db.findSessionByRefreshHash(hash);
    if (!session) return fail(401, 'invalid_refresh');
    const t = now();
    if (session.refreshHash !== hash) {
      // an already-rotated token came back: someone copied it. Kill the session.
      await db.updateSession(session.id, { revokedAt: t });
      return fail(401, 'refresh_reused');
    }
    if (session.revokedAt || session.expiresAt <= t) return fail(401, 'invalid_refresh');
    const account = await db.findAccountById(session.accountId);
    if (!account?.enabled) return fail(401, 'invalid_refresh');

    const next = randomToken(32);
    await db.updateSession(session.id, {
      refreshHash: await sha256Hex(next),
      prevRefreshHash: hash,
      lastUsedAt: t,
      expiresAt: t + SESSION_MS,
    });
    return reply(200, {
      accessToken: await signAccessToken({ sub: account.id, sid: session.id }, tokenSecret, t),
      refreshToken: next,
      expiresIn: ACCESS_TTL_SECONDS,
      sessionId: session.id,
      account: { id: account.id, email: account.email },
      serverNow: t,
    });
  }

  async function logout(auth: Auth): Promise<ApiResponse> {
    await db.updateSession(auth.session.id, { revokedAt: now() });
    return reply(200, { ok: true });
  }

  async function changePassword(auth: Auth, b: Json): Promise<ApiResponse> {
    if (typeof b['currentPassword'] !== 'string') return fail(400, 'bad_request');
    if (!isStrongEnough(b['newPassword'])) return fail(400, 'weak_password');
    const outcome = await tryPassword(auth.account, b['currentPassword']);
    if (outcome === 'locked') return lockedReply((auth.account.lockedUntil ?? now()) - now());
    if (outcome === 'bad') return fail(401, 'invalid_credentials');
    const pw = await hashPassword(b['newPassword'], kdf);
    await db.updateAccount(auth.account.id, { passwordHash: pw.hash, passwordSalt: pw.salt, kdfParams: pw.kdf });
    await db.revokeSessions(auth.account.id, now(), auth.session.id);
    return reply(200, { ok: true });
  }

  async function regenerateRecovery(auth: Auth, b: Json): Promise<ApiResponse> {
    if (typeof b['password'] !== 'string') return fail(400, 'bad_request');
    const outcome = await tryPassword(auth.account, b['password']);
    if (outcome === 'locked') return lockedReply((auth.account.lockedUntil ?? now()) - now());
    if (outcome === 'bad') return fail(401, 'invalid_credentials');
    const recovery = newRecoveryCode(randomBytes(32));
    await db.updateAccount(auth.account.id, { recoveryHash: await sha256Hex(recovery.code) });
    return reply(200, { recoveryCode: recovery.display });
  }

  async function recover(req: ApiRequest): Promise<ApiResponse> {
    const b = req.body;
    const t = now();
    const ip = await db.hitRateLimit(`recover-ip:${req.ip}`, t, HOUR);
    if (ip.count > 10) return fail(429, 'too_many_requests');
    const email = normalizeEmail(b['email']);
    const code = normalizeRecoveryCode(b['recoveryCode']);
    if (!email || !code) return fail(400, 'recovery_failed');
    if (!isStrongEnough(b['newPassword'])) return fail(400, 'weak_password');

    const w = await db.peekRateLimit(`recover-fail:${email}`, t, LOCK_MS);
    if (w.count >= MAX_FAILS) return lockedReply(w.windowStart + LOCK_MS - t);
    const account = await db.findAccountByEmail(email);
    const supplied = await sha256Hex(code);
    const match = account ? timingSafeEqualText(supplied, account.recoveryHash) : !timingSafeEqualText(supplied, supplied);
    if (!account || !match) {
      await db.hitRateLimit(`recover-fail:${email}`, t, LOCK_MS);
      return fail(400, 'recovery_failed');
    }
    const pw = await hashPassword(b['newPassword'], kdf);
    const fresh = newRecoveryCode(randomBytes(32));
    await db.updateAccount(account.id, {
      passwordHash: pw.hash,
      passwordSalt: pw.salt,
      kdfParams: pw.kdf,
      recoveryHash: await sha256Hex(fresh.code),
      failedAttempts: 0,
      lockedUntil: null,
    });
    await db.revokeSessions(account.id, t);
    return reply(200, { recoveryCode: fresh.display });
  }

  async function sessions(auth: Auth): Promise<ApiResponse> {
    const t = now();
    const live = (await db.listSessions(auth.account.id)).filter((s) => !s.revokedAt && s.expiresAt > t);
    return reply(200, {
      sessions: live.map((s) => ({
        id: s.id,
        deviceLabel: s.deviceLabel,
        createdAt: s.createdAt,
        lastUsedAt: s.lastUsedAt,
        current: s.id === auth.session.id,
      })),
    });
  }

  async function revoke(auth: Auth, b: Json): Promise<ApiResponse> {
    const target = typeof b['sessionId'] === 'string' ? await db.findSessionById(b['sessionId']) : null;
    if (!target || target.accountId !== auth.account.id) return fail(404, 'not_found');
    await db.updateSession(target.id, { revokedAt: now() });
    return reply(200, { ok: true });
  }

  // ---------------------------------------------------------------- sync

  interface PushOp {
    collection: string;
    id: string;
    deleted: boolean;
    data: Record<string, unknown> | null;
    schemaVersion: number;
    clientUpdatedAt: number;
    baseRev: number;
  }

  function parseOp(raw: unknown, t: number): PushOp | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Json;
    if (!isCollection(o['collection']) || !isRecordId(o['id'])) return null;
    const deleted = o['deleted'] === true;
    let data: Record<string, unknown> | null = null;
    if (!deleted) {
      if (!o['data'] || typeof o['data'] !== 'object' || Array.isArray(o['data'])) return null;
      data = o['data'] as Record<string, unknown>;
      if (JSON.stringify(data).length > MAX_RECORD_BYTES) return null;
    }
    const schemaVersion = Number(o['schemaVersion']);
    const clientUpdatedAt = Number(o['clientUpdatedAt']);
    const baseRev = Number(o['baseRev'] ?? 0);
    if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > 1000) return null;
    if (!Number.isFinite(clientUpdatedAt) || clientUpdatedAt < 0) return null;
    if (!Number.isInteger(baseRev) || baseRev < 0) return null;
    return {
      collection: o['collection'],
      id: o['id'],
      deleted,
      data,
      schemaVersion,
      // a clock far in the future would win every conflict: cap it
      clientUpdatedAt: Math.min(Math.floor(clientUpdatedAt), t + MAX_CLOCK_AHEAD_MS),
      baseRev,
    };
  }

  async function conflictId(parts: (string | number)[]): Promise<string> {
    return 'c' + (await sha256Hex(parts.join('|'))).slice(0, 40);
  }

  async function push(auth: Auth, b: Json): Promise<ApiResponse> {
    const ops = b['ops'];
    if (!Array.isArray(ops) || ops.length > MAX_BATCH_OPS) return fail(400, 'bad_request');
    const clientSchema = Number(b['schemaVersion']);
    const serverSchema = await db.getSchemaVersion(auth.account.id);
    if (!Number.isInteger(clientSchema) || clientSchema < serverSchema) {
      return fail(409, 'client_outdated', { serverSchemaVersion: serverSchema });
    }
    const accountId = auth.account.id;
    const deviceId = auth.session.deviceId;
    const t = now();

    const results = await db.tx(async (tx) => {
      const parsed = ops.map((o) => parseOp(o, t));
      const keys = parsed.filter((o): o is PushOp => !!o).map((o) => ({ collection: o.collection, id: o.id }));
      const current = new Map<string, RecordRow>();
      for (const r of keys.length ? await tx.getRecords(accountId, keys) : []) {
        current.set(`${r.collection}/${r.id}`, r);
      }

      const out: Json[] = [];
      for (let i = 0; i < parsed.length; i++) {
        const op = parsed[i];
        if (!op) {
          out.push({ index: i, status: 'invalid' });
          continue;
        }
        const key = `${op.collection}/${op.id}`;
        const existing = current.get(key) ?? null;
        const base = { index: i, collection: op.collection, id: op.id };

        const write = async (): Promise<RecordRow> => {
          const row = await tx.upsertRecord({
            accountId,
            collection: op.collection,
            id: op.id,
            data: op.deleted ? (existing?.data ?? {}) : op.data,
            schemaVersion: op.schemaVersion,
            clientUpdatedAt: op.clientUpdatedAt,
            deviceId,
            deletedAt: op.deleted ? t : null,
          });
          current.set(key, row);
          return row;
        };
        // the loser is always kept in full under "conflicts", never dropped
        const keepLoser = async (loser: { data: unknown; deleted: boolean; deviceId: string; at: number; tag: string | number }) => {
          const id = await conflictId([op.collection, op.id, loser.deviceId, loser.at, loser.tag]);
          await tx.upsertRecord({
            accountId,
            collection: 'conflicts',
            id,
            data: {
              collection: op.collection,
              recordId: op.id,
              deleted: loser.deleted,
              data: loser.data,
              deviceId: loser.deviceId,
              clientUpdatedAt: loser.at,
              detectedAt: t,
            },
            schemaVersion: op.schemaVersion,
            clientUpdatedAt: t,
            deviceId: 'server',
            deletedAt: null,
          });
        };

        const sameContent =
          !!existing &&
          (op.deleted ? existing.deletedAt !== null : existing.deletedAt === null && sameJson(existing.data, op.data));

        if (!existing || existing.rev <= op.baseRev) {
          out.push({ ...base, status: 'ok', rev: (await write()).rev });
        } else if (sameContent || (existing.deviceId === deviceId && existing.clientUpdatedAt === op.clientUpdatedAt)) {
          out.push({ ...base, status: 'ok', rev: existing.rev }); // retry, or the same change made on two devices
        } else if (op.clientUpdatedAt > existing.clientUpdatedAt) {
          if (!existing.deletedAt) {
            await keepLoser({
              data: existing.data,
              deleted: false,
              deviceId: existing.deviceId,
              at: existing.clientUpdatedAt,
              tag: existing.rev,
            });
          }
          out.push({ ...base, status: 'won', rev: (await write()).rev });
        } else {
          await keepLoser({
            data: op.data,
            deleted: op.deleted,
            deviceId,
            at: op.clientUpdatedAt,
            tag: 'op',
          });
          out.push({ ...base, status: 'lost', rev: existing.rev });
        }
      }
      return out;
    });
    return reply(200, { results, serverNow: now() });
  }

  async function pull(auth: Auth, b: Json): Promise<ApiResponse> {
    const since = Number(b['since'] ?? 0);
    const limit = Math.min(Math.max(Number(b['limit'] ?? 500), 1), 1000);
    if (!Number.isInteger(since) || since < 0 || !Number.isInteger(limit)) return fail(400, 'bad_request');
    const rows = await db.pullRecords(auth.account.id, since, limit + 1);
    const page = rows.slice(0, limit);
    return reply(200, {
      records: page.map((r) => ({
        collection: r.collection,
        id: r.id,
        data: r.deletedAt ? null : r.data,
        schemaVersion: r.schemaVersion,
        rev: r.rev,
        clientUpdatedAt: r.clientUpdatedAt,
        deviceId: r.deviceId,
        deleted: r.deletedAt !== null,
      })),
      hasMore: rows.length > limit,
      cursor: page.length ? page[page.length - 1].rev : since,
      serverNow: now(),
    });
  }

  async function meta(auth: Auth, b: Json): Promise<ApiResponse> {
    const wanted = b['schemaVersion'];
    if (wanted !== undefined) {
      const current = await db.getSchemaVersion(auth.account.id);
      if (!Number.isInteger(wanted) || (wanted as number) < current || (wanted as number) > 1000) {
        return fail(400, 'bad_request');
      }
      if ((wanted as number) > current) await db.raiseSchemaVersion(auth.account.id, wanted as number, now());
    }
    return reply(200, {
      schemaVersion: await db.getSchemaVersion(auth.account.id),
      counts: await db.countRecords(auth.account.id),
      serverNow: now(),
    });
  }

  // ---------------------------------------------------------------- router

  async function handle(req: ApiRequest): Promise<ApiResponse> {
    try {
      switch (req.action) {
        case 'auth/signup':
          return await signup(req);
        case 'auth/login':
          return await login(req);
        case 'auth/refresh':
          return await refresh(req);
        case 'auth/recover':
          return await recover(req);
      }
      const auth = await authenticate(req.authorization);
      if (!auth) return fail(401, 'unauthorized');
      switch (req.action) {
        case 'auth/logout':
          return await logout(auth);
        case 'auth/change-password':
          return await changePassword(auth, req.body);
        case 'auth/regenerate-recovery':
          return await regenerateRecovery(auth, req.body);
        case 'auth/invite/create':
          return await createInvite(auth);
        case 'auth/sessions':
          return await sessions(auth);
        case 'auth/revoke':
          return await revoke(auth, req.body);
        case 'sync/push':
          return await push(auth, req.body);
        case 'sync/pull':
          return await pull(auth, req.body);
        case 'sync/meta':
          return await meta(auth, req.body);
        default:
          return fail(404, 'not_found');
      }
    } catch {
      // never echo internals (they could contain secrets or SQL)
      return fail(500, 'server_error');
    }
  }

  return { handle };
}
