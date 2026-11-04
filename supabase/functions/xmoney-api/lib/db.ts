// The only door to the xmoney schema. The edge function ships one implementation
// (db-pg.ts, direct Postgres); tests use memory-db.ts. All times are epoch ms.

export interface AccountRow {
  id: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  kdfParams: { alg: string; iterations: number };
  recoveryHash: string;
  enabled: boolean;
  aiEnabled: boolean;
  failedAttempts: number;
  lockedUntil: number | null;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface SessionRow {
  id: string;
  accountId: string;
  refreshHash: string;
  prevRefreshHash: string | null;
  deviceId: string;
  deviceLabel: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
  revokedAt: number | null;
}

export interface RecordRow {
  accountId: string;
  collection: string;
  id: string;
  data: unknown;
  schemaVersion: number;
  rev: number;
  updatedAt: number;
  clientUpdatedAt: number;
  deviceId: string;
  deletedAt: number | null;
}

export type RecordWrite = Omit<RecordRow, 'rev' | 'updatedAt'>;

export interface RateWindow {
  count: number;
  windowStart: number;
}

export interface Db {
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;

  findAccountByEmail(email: string): Promise<AccountRow | null>;
  findAccountById(id: string): Promise<AccountRow | null>;
  // false when the email is already taken
  insertAccount(row: AccountRow): Promise<boolean>;
  // how many accounts exist (the very first one needs no invite code)
  countAccounts(): Promise<number>;
  updateAccount(id: string, patch: Partial<Omit<AccountRow, 'id'>>): Promise<void>;

  insertSession(row: SessionRow): Promise<void>;
  findSessionById(id: string): Promise<SessionRow | null>;
  // matches the current OR the previous refresh hash (reuse detection)
  findSessionByRefreshHash(hash: string): Promise<SessionRow | null>;
  updateSession(id: string, patch: Partial<Omit<SessionRow, 'id'>>): Promise<void>;
  listSessions(accountId: string): Promise<SessionRow[]>;
  revokeSessions(accountId: string, now: number, exceptId?: string): Promise<void>;

  // Fixed window counter: opens a new window when the old one is older than windowMs
  hitRateLimit(key: string, now: number, windowMs: number): Promise<RateWindow>;
  peekRateLimit(key: string, now: number, windowMs: number): Promise<RateWindow>;

  getRecords(accountId: string, keys: { collection: string; id: string }[]): Promise<RecordRow[]>;
  upsertRecord(row: RecordWrite): Promise<RecordRow>;
  pullRecords(accountId: string, sinceRev: number, limit: number): Promise<RecordRow[]>;
  countRecords(accountId: string): Promise<Record<string, number>>;

  getSchemaVersion(accountId: string): Promise<number>;
  raiseSchemaVersion(accountId: string, version: number, now: number): Promise<void>;
}
