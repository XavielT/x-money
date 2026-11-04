// Limits of xmoney-ai. Pure: no Deno imports, so vitest can test every rule.
export const DEFAULT_MONTHLY_REQUESTS = 300;
export const DEFAULT_MONTHLY_TOKENS = 400_000;
export const RATE_PER_MINUTE = 10;
export const RATE_WINDOW_MS = 60_000;
export const MAX_BODY_BYTES = 32 * 1024;
export const REQUEST_TIMEOUT_MS = 20_000;
export const MAX_REQUEST_ID_CHARS = 64;

export interface Caps {
  requests: number;
  tokens: number;
}

// An account without its own caps gets the defaults; a cap of 0 or less would lock the account
// out silently, so only positive numbers count as a cap
export function effectiveCaps(row: { requestCap: number | null; tokenCap: number | null }): Caps {
  const pos = (n: number | null, fallback: number) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback);
  return { requests: pos(row.requestCap, DEFAULT_MONTHLY_REQUESTS), tokens: pos(row.tokenCap, DEFAULT_MONTHLY_TOKENS) };
}

// First instant of the calendar month in UTC (the usage window)
export function monthStartUtc(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export const monthKey = (nowMs: number): string => new Date(monthStartUtc(nowMs)).toISOString().slice(0, 7);

export type QuotaResult = null | 'requests' | 'tokens';

export function checkQuota(usage: { requests: number; tokens: number }, caps: Caps): QuotaResult {
  if (usage.requests >= caps.requests) return 'requests';
  if (usage.tokens >= caps.tokens) return 'tokens';
  return null;
}
