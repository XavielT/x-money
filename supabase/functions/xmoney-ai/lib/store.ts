// Storage of the AI usage log. It keeps counts and tokens, NEVER the content of a request or of an
// answer. The Postgres implementation talks to the xmoney schema through the same direct connection
// as xmoney-api (parameterized queries only); the memory one serves the tests.
import type { Db } from '../../xmoney-api/lib/db.ts';
import type { Exec } from '../../xmoney-api/lib/pg-db.ts';

export type UsageStatus = 'ok' | 'timeout' | 'provider_error' | 'rate_limited';

export interface UsageRow {
  accountId: string;
  feature: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estCostUsd: number | null;
  status: UsageStatus;
  latencyMs: number;
  createdAt: number;
}

export interface AiStore {
  // requests and tokens used since an instant (every logged attempt counts as a request)
  usageSince(accountId: string, sinceMs: number): Promise<{ requests: number; tokens: number }>;
  record(row: Omit<UsageRow, 'createdAt'>, nowMs: number): Promise<void>;
  // calls of ONE feature since an instant (the daily capture cap) and the estimated cost since an instant
  // The user's own switch: AI is turned on (or off) for the account by the account itself
  setAiEnabled(accountId: string, on: boolean): Promise<void>;
  featureCountSince(accountId: string, feature: string, sinceMs: number): Promise<number>;
  costSince(accountId: string, sinceMs: number): Promise<number>;
  // fixed window counter per key (per minute rate limit)
  hit(key: string, nowMs: number, windowMs: number): Promise<{ count: number }>;
}

export class MemoryAiStore implements AiStore {
  rows: UsageRow[] = [];
  windows = new Map<string, { count: number; start: number }>();

  async usageSince(accountId: string, sinceMs: number) {
    const mine = this.rows.filter((r) => r.accountId === accountId && r.createdAt >= sinceMs);
    return { requests: mine.length, tokens: mine.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0) };
  }

  async record(row: Omit<UsageRow, 'createdAt'>, nowMs: number) {
    this.rows.push({ ...row, createdAt: nowMs });
  }

  enabled = new Map<string, boolean>();

  async setAiEnabled(accountId: string, on: boolean) {
    this.enabled.set(accountId, on);
  }

  async featureCountSince(accountId: string, feature: string, sinceMs: number) {
    return this.rows.filter((r) => r.accountId === accountId && r.feature === feature && r.createdAt >= sinceMs).length;
  }

  async costSince(accountId: string, sinceMs: number) {
    return this.rows.filter((r) => r.accountId === accountId && r.createdAt >= sinceMs).reduce((s, r) => s + (r.estCostUsd ?? 0), 0);
  }

  async hit(key: string, nowMs: number, windowMs: number) {
    const w = this.windows.get(key);
    if (!w || nowMs - w.start >= windowMs) {
      this.windows.set(key, { count: 1, start: nowMs });
      return { count: 1 };
    }
    w.count++;
    return { count: w.count };
  }
}

export class PgAiStore implements AiStore {
  constructor(
    private exec: Exec,
    private db: Pick<Db, 'hitRateLimit'>
  ) {}

  async usageSince(accountId: string, sinceMs: number) {
    const rows = await this.exec(
      `select count(*)::int as requests, coalesce(sum(input_tokens + output_tokens), 0)::bigint as tokens
         from xmoney.ai_usage
        where account_id = $1::uuid and created_at >= to_timestamp($2::float8 / 1000.0)`,
      [accountId, sinceMs]
    );
    return { requests: Number(rows[0]?.['requests'] ?? 0), tokens: Number(rows[0]?.['tokens'] ?? 0) };
  }

  async record(row: Omit<UsageRow, 'createdAt'>) {
    await this.exec(
      `insert into xmoney.ai_usage (account_id, feature, model, input_tokens, output_tokens, est_cost_usd, status, latency_ms)
       values ($1::uuid, $2, $3, $4::int, $5::int, $6::numeric, $7, $8::int)`,
      [row.accountId, row.feature, row.model, row.inputTokens, row.outputTokens, row.estCostUsd, row.status, row.latencyMs]
    );
  }

  async setAiEnabled(accountId: string, on: boolean) {
    await this.exec(`update xmoney.accounts set ai_enabled = $2::boolean where id = $1::uuid`, [accountId, on]);
  }

  async featureCountSince(accountId: string, feature: string, sinceMs: number) {
    const rows = await this.exec(
      `select count(*)::int as n from xmoney.ai_usage where account_id = $1::uuid and feature = $2 and created_at >= to_timestamp($3::float8 / 1000.0)`,
      [accountId, feature, sinceMs]
    );
    return Number(rows[0]?.['n'] ?? 0);
  }

  async costSince(accountId: string, sinceMs: number) {
    const rows = await this.exec(
      `select coalesce(sum(est_cost_usd), 0)::float8 as cost from xmoney.ai_usage where account_id = $1::uuid and created_at >= to_timestamp($2::float8 / 1000.0)`,
      [accountId, sinceMs]
    );
    return Number(rows[0]?.['cost'] ?? 0);
  }

  async hit(key: string, nowMs: number, windowMs: number) {
    const w = await this.db.hitRateLimit(key, nowMs, windowMs);
    return { count: w.count };
  }

  // The caps of one account (null = the defaults apply)
  async caps(accountId: string): Promise<{ requestCap: number | null; tokenCap: number | null }> {
    const rows = await this.exec(`select monthly_request_cap, monthly_token_cap from xmoney.accounts where id = $1::uuid`, [accountId]);
    const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    return { requestCap: n(rows[0]?.['monthly_request_cap']), tokenCap: n(rows[0]?.['monthly_token_cap']) };
  }
}
