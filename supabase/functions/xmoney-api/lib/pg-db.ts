// Db implementation over a parameterized SQL executor. Every query below is a
// constant string: user data only ever travels in the params array ($1, $2...),
// never concatenated into the text. The executor is injected (index.ts wires it
// to a direct Postgres connection), which also lets tests record every query.
import type { AccountRow, Db, RateWindow, RecordRow, RecordWrite, SessionRow } from './db.ts';

export type Row = Record<string, unknown>;
export type Exec = (text: string, params: unknown[]) => Promise<Row[]>;
export type Begin = <T>(fn: (exec: Exec) => Promise<T>) => Promise<T>;

const ms = (col: string) => `(extract(epoch from ${col}) * 1000)::float8`;
const ts = (param: string) => `to_timestamp(${param}::float8 / 1000.0)`;

const ACCOUNT_COLS = `id::text as id, email, password_hash, password_salt, kdf_params, recovery_hash, enabled, ai_enabled,
  failed_attempts, ${ms('locked_until')} as locked_until, ${ms('created_at')} as created_at,
  ${ms('last_login_at')} as last_login_at`;
const SESSION_COLS = `id::text as id, account_id::text as account_id, refresh_hash, prev_refresh_hash, device_id, device_label,
  ${ms('created_at')} as created_at, ${ms('last_used_at')} as last_used_at, ${ms('expires_at')} as expires_at,
  ${ms('revoked_at')} as revoked_at`;
const RECORD_COLS = `account_id::text as account_id, collection, id, data, schema_version, rev::text as rev,
  ${ms('updated_at')} as updated_at, ${ms('client_updated_at')} as client_updated_at, device_id,
  ${ms('deleted_at')} as deleted_at`;

// patch key -> [column, kind]; the column names are constants, never user input
const ACCOUNT_PATCH: Record<string, [string, 'plain' | 'time' | 'json']> = {
  passwordHash: ['password_hash', 'plain'],
  passwordSalt: ['password_salt', 'plain'],
  kdfParams: ['kdf_params', 'json'],
  recoveryHash: ['recovery_hash', 'plain'],
  enabled: ['enabled', 'plain'],
  aiEnabled: ['ai_enabled', 'plain'],
  failedAttempts: ['failed_attempts', 'plain'],
  lockedUntil: ['locked_until', 'time'],
  lastLoginAt: ['last_login_at', 'time'],
};
const SESSION_PATCH: Record<string, [string, 'plain' | 'time' | 'json']> = {
  refreshHash: ['refresh_hash', 'plain'],
  prevRefreshHash: ['prev_refresh_hash', 'plain'],
  lastUsedAt: ['last_used_at', 'time'],
  expiresAt: ['expires_at', 'time'],
  revokedAt: ['revoked_at', 'time'],
};

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function toAccount(r: Row): AccountRow {
  return {
    id: r['id'] as string,
    email: r['email'] as string,
    passwordHash: r['password_hash'] as string,
    passwordSalt: r['password_salt'] as string,
    kdfParams: r['kdf_params'] as AccountRow['kdfParams'],
    recoveryHash: r['recovery_hash'] as string,
    enabled: r['enabled'] as boolean,
    aiEnabled: r['ai_enabled'] as boolean,
    failedAttempts: Number(r['failed_attempts']),
    lockedUntil: num(r['locked_until']),
    createdAt: Number(r['created_at']),
    lastLoginAt: num(r['last_login_at']),
  };
}

function toSession(r: Row): SessionRow {
  return {
    id: r['id'] as string,
    accountId: r['account_id'] as string,
    refreshHash: r['refresh_hash'] as string,
    prevRefreshHash: (r['prev_refresh_hash'] as string | null) ?? null,
    deviceId: r['device_id'] as string,
    deviceLabel: (r['device_label'] as string) ?? '',
    createdAt: Number(r['created_at']),
    lastUsedAt: Number(r['last_used_at']),
    expiresAt: Number(r['expires_at']),
    revokedAt: num(r['revoked_at']),
  };
}

function toRecord(r: Row): RecordRow {
  return {
    accountId: r['account_id'] as string,
    collection: r['collection'] as string,
    id: r['id'] as string,
    data: r['data'],
    schemaVersion: Number(r['schema_version']),
    rev: Number(r['rev']),
    updatedAt: Number(r['updated_at']),
    clientUpdatedAt: Number(r['client_updated_at']),
    deviceId: (r['device_id'] as string) ?? '',
    deletedAt: num(r['deleted_at']),
  };
}

export class PgDb implements Db {
  constructor(
    private exec: Exec,
    private begin: Begin | null
  ) {}

  tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    // already inside a transaction: just keep going on the same connection
    if (!this.begin) return fn(this);
    return this.begin((exec) => fn(new PgDb(exec, null)));
  }

  private async patch(
    table: string,
    map: Record<string, [string, 'plain' | 'time' | 'json']>,
    id: string,
    patch: Record<string, unknown>
  ) {
    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const [key, value] of Object.entries(patch)) {
      const target = map[key];
      if (!target) continue;
      params.push(value); // jsonb params are serialized by the driver: pass the object, not a string
      const p = `$${params.length}`;
      sets.push(
        `${target[0]} = ${target[1] === 'time' ? `case when ${p}::float8 is null then null else ${ts(p)} end` : target[1] === 'json' ? `${p}::jsonb` : p}`
      );
    }
    if (!sets.length) return;
    await this.exec(`update xmoney.${table} set ${sets.join(', ')} where id = $1::uuid`, params);
  }

  async findAccountByEmail(email: string) {
    const rows = await this.exec(`select ${ACCOUNT_COLS} from xmoney.accounts where email = $1`, [email]);
    return rows[0] ? toAccount(rows[0]) : null;
  }

  async findAccountById(id: string) {
    const rows = await this.exec(`select ${ACCOUNT_COLS} from xmoney.accounts where id = $1::uuid`, [id]);
    return rows[0] ? toAccount(rows[0]) : null;
  }

  async countAccounts() {
    const rows = await this.exec(`select count(*)::int as n from xmoney.accounts`, []);
    return Number(rows[0]?.['n'] ?? 0);
  }

  async insertAccount(a: AccountRow) {
    const rows = await this.exec(
      `insert into xmoney.accounts (id, email, password_hash, password_salt, kdf_params, recovery_hash, enabled,
         ai_enabled, failed_attempts, locked_until, created_at, last_login_at)
       values ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, null, ${ts('$10')}, ${ts('$11')})
       on conflict (email) do nothing returning id`,
      [
        a.id,
        a.email,
        a.passwordHash,
        a.passwordSalt,
        a.kdfParams,
        a.recoveryHash,
        a.enabled,
        a.aiEnabled,
        a.failedAttempts,
        a.createdAt,
        a.lastLoginAt ?? a.createdAt,
      ]
    );
    return rows.length > 0;
  }

  updateAccount(id: string, patch: Partial<Omit<AccountRow, 'id'>>) {
    return this.patch('accounts', ACCOUNT_PATCH, id, patch as Record<string, unknown>);
  }

  async insertSession(s: SessionRow) {
    await this.exec(
      `insert into xmoney.sessions (id, account_id, refresh_hash, prev_refresh_hash, device_id, device_label,
         created_at, last_used_at, expires_at, revoked_at)
       values ($1::uuid, $2::uuid, $3, $4, $5, $6, ${ts('$7')}, ${ts('$8')}, ${ts('$9')}, null)`,
      [s.id, s.accountId, s.refreshHash, s.prevRefreshHash, s.deviceId, s.deviceLabel, s.createdAt, s.lastUsedAt, s.expiresAt]
    );
  }

  async findSessionById(id: string) {
    const rows = await this.exec(`select ${SESSION_COLS} from xmoney.sessions where id = $1::uuid`, [id]);
    return rows[0] ? toSession(rows[0]) : null;
  }

  async findSessionByRefreshHash(hash: string) {
    const rows = await this.exec(
      `select ${SESSION_COLS} from xmoney.sessions where refresh_hash = $1 or prev_refresh_hash = $1 limit 1`,
      [hash]
    );
    return rows[0] ? toSession(rows[0]) : null;
  }

  updateSession(id: string, patch: Partial<Omit<SessionRow, 'id'>>) {
    return this.patch('sessions', SESSION_PATCH, id, patch as Record<string, unknown>);
  }

  async listSessions(accountId: string) {
    const rows = await this.exec(
      `select ${SESSION_COLS} from xmoney.sessions where account_id = $1::uuid order by created_at desc limit 200`,
      [accountId]
    );
    return rows.map(toSession);
  }

  async revokeSessions(accountId: string, now: number, exceptId?: string) {
    await this.exec(
      `update xmoney.sessions set revoked_at = ${ts('$2')}
       where account_id = $1::uuid and revoked_at is null and ($3::uuid is null or id <> $3::uuid)`,
      [accountId, now, exceptId ?? null]
    );
  }

  async hitRateLimit(key: string, now: number, windowMs: number): Promise<RateWindow> {
    const rows = await this.exec(
      `insert into xmoney.rate_limits as r (key, window_start, count)
       values ($1, ${ts('$2')}, 1)
       on conflict (key) do update set
         count = case when r.window_start < ${ts('($2::float8 - $3::float8)')} then 1 else r.count + 1 end,
         window_start = case when r.window_start < ${ts('($2::float8 - $3::float8)')}
                             then excluded.window_start else r.window_start end
       returning count, ${ms('window_start')} as window_start`,
      [key, now, windowMs]
    );
    return { count: Number(rows[0]['count']), windowStart: Number(rows[0]['window_start']) };
  }

  async peekRateLimit(key: string, now: number, windowMs: number): Promise<RateWindow> {
    const rows = await this.exec(
      `select count, ${ms('window_start')} as window_start from xmoney.rate_limits where key = $1`,
      [key]
    );
    const row = rows[0];
    if (!row || Number(row['window_start']) < now - windowMs) return { count: 0, windowStart: now };
    return { count: Number(row['count']), windowStart: Number(row['window_start']) };
  }

  async getRecords(accountId: string, keys: { collection: string; id: string }[]) {
    if (!keys.length) return [];
    const rows = await this.exec(
      `select ${RECORD_COLS} from xmoney.records r
       where r.account_id = $1::uuid
         and (r.collection, r.id) in (select k.collection, k.id from jsonb_to_recordset($2::jsonb) as k(collection text, id text))`,
      [accountId, keys]
    );
    return rows.map(toRecord);
  }

  async upsertRecord(w: RecordWrite) {
    const rows = await this.exec(
      `insert into xmoney.records (account_id, collection, id, data, schema_version, client_updated_at, device_id, deleted_at)
       values ($1::uuid, $2, $3, $4::jsonb, $5, ${ts('$6')}, $7, case when $8::float8 is null then null else ${ts('$8')} end)
       on conflict (account_id, collection, id) do update set
         data = excluded.data, schema_version = excluded.schema_version,
         client_updated_at = excluded.client_updated_at, device_id = excluded.device_id,
         deleted_at = excluded.deleted_at
       returning ${RECORD_COLS}`,
      [w.accountId, w.collection, w.id, w.data ?? {}, w.schemaVersion, w.clientUpdatedAt, w.deviceId, w.deletedAt]
    );
    return toRecord(rows[0]);
  }

  async pullRecords(accountId: string, sinceRev: number, limit: number) {
    const rows = await this.exec(
      `select ${RECORD_COLS} from xmoney.records where account_id = $1::uuid and rev > $2::bigint order by rev limit $3::int`,
      [accountId, sinceRev, limit]
    );
    return rows.map(toRecord);
  }

  async countRecords(accountId: string) {
    const rows = await this.exec(
      `select collection, count(*)::int as n from xmoney.records
       where account_id = $1::uuid and deleted_at is null group by collection`,
      [accountId]
    );
    return Object.fromEntries(rows.map((r) => [r['collection'] as string, Number(r['n'])]));
  }

  async getSchemaVersion(accountId: string) {
    const rows = await this.exec(`select schema_version from xmoney.meta where account_id = $1::uuid`, [accountId]);
    return rows[0] ? Number(rows[0]['schema_version']) : 1;
  }

  async raiseSchemaVersion(accountId: string, version: number, now: number) {
    await this.exec(
      `insert into xmoney.meta as m (account_id, schema_version, updated_at) values ($1::uuid, $2::int, ${ts('$3')})
       on conflict (account_id) do update set schema_version = greatest(m.schema_version, excluded.schema_version),
         updated_at = excluded.updated_at`,
      [accountId, version, now]
    );
  }
}
