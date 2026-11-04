// Storage of the mail connection. Holds the ENCRYPTED refresh token, the cursor and the last read
// time; never the body of a message. Postgres through the same direct connection as xmoney-api
// (parameterized queries only); the memory one serves the tests.
import type { Exec } from '../../xmoney-api/lib/pg-db.ts';

export interface MailConnection {
  accountId: string;
  provider: 'gmail';
  email: string | null;
  refreshTokenEnc: string;
  connectedAt: number;
  lastReadAt: number | null;
  cursorMs: number;
}

export interface MailStore {
  get(accountId: string): Promise<MailConnection | null>;
  upsert(c: Omit<MailConnection, 'lastReadAt' | 'cursorMs' | 'connectedAt'>, nowMs: number): Promise<void>;
  touch(accountId: string, nowMs: number, cursorMs: number): Promise<void>;
  remove(accountId: string): Promise<void>;
}

export class MemoryMailStore implements MailStore {
  rows = new Map<string, MailConnection>();
  async get(id: string) {
    return this.rows.get(id) ?? null;
  }
  async upsert(c: Omit<MailConnection, 'lastReadAt' | 'cursorMs' | 'connectedAt'>, nowMs: number) {
    this.rows.set(c.accountId, { ...c, connectedAt: nowMs, lastReadAt: null, cursorMs: 0 });
  }
  async touch(id: string, nowMs: number, cursorMs: number) {
    const r = this.rows.get(id);
    if (r) this.rows.set(id, { ...r, lastReadAt: nowMs, cursorMs: Math.max(r.cursorMs, cursorMs) });
  }
  async remove(id: string) {
    this.rows.delete(id);
  }
}

export class PgMailStore implements MailStore {
  constructor(private exec: Exec) {}

  async get(accountId: string) {
    const rows = await this.exec(
      `select email, refresh_token_enc, extract(epoch from connected_at) * 1000 as connected_ms, extract(epoch from last_read_at) * 1000 as read_ms, cursor_ms
         from xmoney.mail_connections where account_id = $1::uuid`,
      [accountId]
    );
    const r = rows[0];
    if (!r) return null;
    return {
      accountId,
      provider: 'gmail' as const,
      email: (r['email'] as string | null) ?? null,
      refreshTokenEnc: String(r['refresh_token_enc']),
      connectedAt: Number(r['connected_ms']),
      lastReadAt: r['read_ms'] === null || r['read_ms'] === undefined ? null : Number(r['read_ms']),
      cursorMs: Number(r['cursor_ms'] ?? 0),
    };
  }

  async upsert(c: Omit<MailConnection, 'lastReadAt' | 'cursorMs' | 'connectedAt'>) {
    await this.exec(
      `insert into xmoney.mail_connections (account_id, provider, email, refresh_token_enc)
       values ($1::uuid, 'gmail', $2, $3)
       on conflict (account_id) do update set email = excluded.email, refresh_token_enc = excluded.refresh_token_enc, connected_at = now(), last_read_at = null, cursor_ms = 0`,
      [c.accountId, c.email, c.refreshTokenEnc]
    );
  }

  async touch(accountId: string, nowMs: number, cursorMs: number) {
    await this.exec(`update xmoney.mail_connections set last_read_at = to_timestamp($2::float8 / 1000.0), cursor_ms = greatest(cursor_ms, $3::bigint) where account_id = $1::uuid`, [accountId, nowMs, cursorMs]);
  }

  async remove(accountId: string) {
    await this.exec(`delete from xmoney.mail_connections where account_id = $1::uuid`, [accountId]);
  }
}
