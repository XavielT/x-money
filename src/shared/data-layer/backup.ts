// JSON backup: export format, parsing, migration of old backups and shape validation.
// Pure. Importing validates EVERYTHING before the caller writes anything.
import { isValidIsoDate } from '../domain/dates';
import { CLIENT_SCHEMA_VERSION } from './registry';
import { migrateSnapshot } from './migrations';

// Collections that make up a backup (the PIN hash and the language are device matters)
export const BACKUP_KEYS = ['categories', 'accounts', 'transactions', 'budgets', 'recurring', 'settings', 'audit', 'statements', 'incomeSources', 'benefits', 'buckets', 'budgetMoves', 'businessOperations', 'businessWithdrawals', 'contacts', 'goals', 'loans', 'loanSimulations', 'loanSettings', 'insightStates', 'insightSettings', 'textRules'] as const;
export type BackupKey = (typeof BACKUP_KEYS)[number];

export interface BackupCounts {
  accounts: number;
  transactions: number;
  categories: number;
  budgets: number;
  recurring: number;
}

export type ImportError =
  | { code: 'not-json' }
  | { code: 'not-xmoney' }
  | { code: 'newer-version'; version: number }
  | { code: 'bad-shape'; key: string; index?: number; field?: string };

export type ParsedBackup =
  | { ok: true; data: Partial<Record<BackupKey, unknown>>; counts: BackupCounts; fromVersion: number }
  | { ok: false; error: ImportError };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => typeof v === 'string' && v.length > 0;
const fin = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

type Check = (item: Record<string, unknown>) => string | null; // name of the offending field

const CHECKS: Record<string, Check> = {
  transactions: (t) =>
    !str(t['id']) ? 'id'
    : !['income', 'expense', 'transfer'].includes(t['type'] as string) ? 'type'
    : !fin(t['amount']) ? 'amount'
    : !str(t['accountId']) ? 'accountId'
    : !isValidIsoDate(t['date']) ? 'date'
    : t['fee'] !== undefined && !fin(t['fee']) ? 'fee'
    : null,
  accounts: (a) => (!str(a['id']) ? 'id' : !str(a['name']) ? 'name' : !fin(a['initialBalance']) ? 'initialBalance' : null),
  categories: (c) => (!str(c['id']) ? 'id' : !str(c['name']) ? 'name' : !['income', 'expense'].includes(c['type'] as string) ? 'type' : null),
  budgets: (b) => (!str(b['id']) ? 'id' : !str(b['categoryId']) ? 'categoryId' : !fin(b['monthlyLimit']) ? 'monthlyLimit' : null),
  recurring: (r) =>
    !str(r['id']) ? 'id'
    : !fin(r['amount']) ? 'amount'
    : !str(r['accountId']) ? 'accountId'
    : !['daily', 'weekly', 'monthly', 'yearly'].includes(r['frequency'] as string) ? 'frequency'
    : !isValidIsoDate(r['startDate']) ? 'startDate'
    : !isValidIsoDate(r['nextDate']) ? 'nextDate'
    : null,
  audit: (e) => (!str(e['id']) ? 'id' : !str(e['type']) ? 'type' : null),
  incomeSources: (s) => (!str(s['id']) ? 'id' : !str(s['name']) ? 'name' : !str(s['kind']) ? 'kind' : null),
  benefits: (b) =>
    !str(b['id']) ? 'id'
    : !str(b['name']) ? 'name'
    : !fin(b['monthlyValue']) ? 'monthlyValue'
    : !Array.isArray(b['uses']) ? 'uses'
    : null,
  businessOperations: (o) =>
    !str(o['id']) ? 'id'
    : !str(o['name']) ? 'name'
    : !fin(o['quantity']) ? 'quantity'
    : !fin(o['totalCost']) ? 'totalCost'
    : !isValidIsoDate(o['acquiredAt']) ? 'acquiredAt'
    : !Array.isArray(o['sales']) ? 'sales'
    : !Array.isArray(o['expenses']) ? 'expenses'
    : null,
  textRules: (r) => (!str(r['id']) ? 'id' : !str(r['word']) ? 'word' : !str(r['target']) ? 'target' : null),
  insightStates: (s) => (!str(s['id']) ? 'id' : !str(s['insightId']) ? 'insightId' : !str(s['fingerprint']) ? 'fingerprint' : null),
  loans: (l) => (!str(l['id']) ? 'id' : !str(l['name']) ? 'name' : !fin(l['amount']) ? 'amount' : !Array.isArray(l['schedule']) ? 'schedule' : !Array.isArray(l['payments']) ? 'payments' : null),
  loanSimulations: (l) => (!str(l['id']) ? 'id' : !str(l['name']) ? 'name' : !fin(l['amount']) ? 'amount' : null),
  goals: (g) => (!str(g['id']) ? 'id' : !str(g['name']) ? 'name' : !fin(g['target']) ? 'target' : !Array.isArray(g['entries']) ? 'entries' : null),
  businessWithdrawals: (w) => (!str(w['id']) ? 'id' : !fin(w['amount']) ? 'amount' : !isValidIsoDate(w['date']) ? 'date' : null),
  contacts: (c) => (!str(c['id']) ? 'id' : !str(c['name']) ? 'name' : null),
  buckets: (b) => (!str(b['id']) ? 'id' : !str(b['kind']) ? 'kind' : !fin(b['value']) ? 'value' : !Array.isArray(b['categoryIds']) ? 'categoryIds' : null),
  budgetMoves: (m) => (!str(m['id']) ? 'id' : !str(m['month']) ? 'month' : !fin(m['amount']) ? 'amount' : null),
  statements: (s) =>
    !str(s['id']) ? 'id'
    : !str(s['accountId']) ? 'accountId'
    : !isValidIsoDate(s['cutDate']) ? 'cutDate'
    : !isValidIsoDate(s['dueDate']) ? 'dueDate'
    : !fin(s['calculatedBalance']) ? 'calculatedBalance'
    : null,
};

export function buildBackup(read: (key: BackupKey) => unknown): string {
  const snapshot: Record<string, unknown> = { app: 'x-money', version: 1, schemaVersion: CLIENT_SCHEMA_VERSION };
  for (const key of BACKUP_KEYS) snapshot[key] = read(key) ?? null;
  return JSON.stringify(snapshot, null, 2);
}

export function parseBackup(json: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: { code: 'not-json' } };
  }
  if (!isObj(raw) || raw['app'] !== 'x-money') return { ok: false, error: { code: 'not-xmoney' } };

  // backups of 2.5.x and 2.6.x carry no schemaVersion: they are version 1
  const declared = raw['schemaVersion'];
  const fromVersion = declared === undefined ? 1 : Number(declared);
  if (!Number.isInteger(fromVersion) || fromVersion < 1) return { ok: false, error: { code: 'bad-shape', key: 'schemaVersion' } };
  if (fromVersion > CLIENT_SCHEMA_VERSION) return { ok: false, error: { code: 'newer-version', version: fromVersion } };

  const present: Record<string, unknown> = {};
  for (const key of BACKUP_KEYS) if (raw[key] !== undefined && raw[key] !== null) present[key] = raw[key];

  // shape first (on the original data), then migrate
  for (const [key, value] of Object.entries(present)) {
    if (key === 'settings') {
      if (!isObj(value) || typeof value['currency'] !== 'string') return { ok: false, error: { code: 'bad-shape', key } };
      continue;
    }
    if (key === 'loanSettings' || key === 'insightSettings') {
      if (!isObj(value)) return { ok: false, error: { code: 'bad-shape', key } };
      continue;
    }
    if (!Array.isArray(value)) return { ok: false, error: { code: 'bad-shape', key } };
    const check = CHECKS[key];
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      const field = isObj(item) ? check(item) : 'item';
      if (field) return { ok: false, error: { code: 'bad-shape', key, index: i, field } };
    }
  }

  const data = migrateSnapshot(present, fromVersion) as Partial<Record<BackupKey, unknown>>;
  const len = (k: BackupKey) => (Array.isArray(data[k]) ? (data[k] as unknown[]).length : 0);
  return {
    ok: true,
    data,
    fromVersion,
    counts: { accounts: len('accounts'), transactions: len('transactions'), categories: len('categories'), budgets: len('budgets'), recurring: len('recurring') },
  };
}
