// In-memory Db for tests and local experiments. Mirrors what the Postgres
// schema enforces: unique email, rev assigned by the "server" on every write.
import type { AccountRow, Db, RateWindow, RecordRow, RecordWrite, SessionRow } from './db.ts';

export class MemoryDb implements Db {
  accounts = new Map<string, AccountRow>();
  sessions = new Map<string, SessionRow>();
  limits = new Map<string, RateWindow>();
  records = new Map<string, RecordRow>();
  schema = new Map<string, number>();
  private revCounter = 0;
  clock: () => number = () => Date.now();

  async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    const snapshot = {
      records: new Map([...this.records].map(([k, v]) => [k, { ...v }])),
      rev: this.revCounter,
    };
    try {
      return await fn(this);
    } catch (error) {
      this.records = snapshot.records;
      this.revCounter = snapshot.rev;
      throw error;
    }
  }

  async findAccountByEmail(email: string) {
    return [...this.accounts.values()].find((a) => a.email === email) ?? null;
  }
  async findAccountById(id: string) {
    return this.accounts.get(id) ?? null;
  }
  async insertAccount(row: AccountRow) {
    if ([...this.accounts.values()].some((a) => a.email === row.email)) return false;
    this.accounts.set(row.id, { ...row });
    return true;
  }
  async updateAccount(id: string, patch: Partial<Omit<AccountRow, 'id'>>) {
    const row = this.accounts.get(id);
    if (row) Object.assign(row, patch);
  }

  async insertSession(row: SessionRow) {
    this.sessions.set(row.id, { ...row });
  }
  async findSessionById(id: string) {
    return this.sessions.get(id) ?? null;
  }
  async findSessionByRefreshHash(hash: string) {
    return [...this.sessions.values()].find((s) => s.refreshHash === hash || s.prevRefreshHash === hash) ?? null;
  }
  async updateSession(id: string, patch: Partial<Omit<SessionRow, 'id'>>) {
    const row = this.sessions.get(id);
    if (row) Object.assign(row, patch);
  }
  async listSessions(accountId: string) {
    return [...this.sessions.values()].filter((s) => s.accountId === accountId);
  }
  async revokeSessions(accountId: string, now: number, exceptId?: string) {
    for (const s of this.sessions.values()) {
      if (s.accountId === accountId && s.id !== exceptId && !s.revokedAt) s.revokedAt = now;
    }
  }

  async hitRateLimit(key: string, now: number, windowMs: number) {
    const w = this.limits.get(key);
    const next: RateWindow = !w || w.windowStart < now - windowMs ? { count: 1, windowStart: now } : { ...w, count: w.count + 1 };
    this.limits.set(key, next);
    return { ...next };
  }
  async peekRateLimit(key: string, now: number, windowMs: number) {
    const w = this.limits.get(key);
    return !w || w.windowStart < now - windowMs ? { count: 0, windowStart: now } : { ...w };
  }

  async getRecords(accountId: string, keys: { collection: string; id: string }[]) {
    return keys
      .map((k) => this.records.get(`${accountId}/${k.collection}/${k.id}`))
      .filter((r): r is RecordRow => !!r)
      .map((r) => ({ ...r }));
  }
  async upsertRecord(row: RecordWrite) {
    const stored: RecordRow = { ...row, rev: ++this.revCounter, updatedAt: this.clock() };
    this.records.set(`${row.accountId}/${row.collection}/${row.id}`, stored);
    return { ...stored };
  }
  async pullRecords(accountId: string, sinceRev: number, limit: number) {
    return [...this.records.values()]
      .filter((r) => r.accountId === accountId && r.rev > sinceRev)
      .sort((a, b) => a.rev - b.rev)
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }
  async countRecords(accountId: string) {
    const counts: Record<string, number> = {};
    for (const r of this.records.values()) {
      if (r.accountId === accountId && !r.deletedAt) counts[r.collection] = (counts[r.collection] ?? 0) + 1;
    }
    return counts;
  }

  async getSchemaVersion(accountId: string) {
    return this.schema.get(accountId) ?? 1;
  }
  async raiseSchemaVersion(accountId: string, version: number) {
    this.schema.set(accountId, Math.max(version, this.schema.get(accountId) ?? 1));
  }
}
