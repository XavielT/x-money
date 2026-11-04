// AiMinimizer (2.16.0): builds what may leave the device. Pure. A function of the app hands it
// numbers it already calculated; the result carries only aggregates, never the name of an account
// or a bank, the last 4 digits of a card, an internal id or the name of a person. The ONE exception
// is the text of a note, when the feature is to categorize or normalize that very text.

export interface MinimizerContext {
  accountNames: readonly string[];
  bankNames: readonly string[];
  knownIds: readonly string[]; // ids of accounts, movements, categories...
  personNames?: readonly string[];
}

export interface AggregateSpec {
  figures?: Record<string, number>; // e.g. income_month: 52000
  counts?: Record<string, number>;
  series?: Record<string, readonly number[]>; // e.g. expenses_by_month, oldest first
  categories?: readonly { name: string; total: number }[];
}

export interface MinimizedInput {
  figures: Record<string, number>;
  counts: Record<string, number>;
  series: Record<string, number[]>;
  categories: { name: string; total: number }[];
  placeholders: string[]; // the {{names}} the model may use instead of writing a figure
}

export const MAX_SERIES = 24;
export const MAX_CATEGORIES = 20;
export const MAX_NOTE_CHARS = 200;

const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

// Identifying patterns. Two forms of each: without the g flag to TEST (a global regex keeps state
// between calls) and with it to REMOVE.
const PATTERNS = {
  uuid: '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
  email: '[^\\s@]+@[^\\s@]+\\.[^\\s@]+',
  last4: '(?:\\*+|x+|terminad[ao]s?\\s+en|ending\\s+in|last\\s*4?)\\s*\\d{4}\\b',
  longDigits: '\\d{6,}',
  fourDigits: '(?<!\\d)\\d{4}(?!\\d)',
};
const TEST: readonly RegExp[] = Object.values(PATTERNS).map((p) => new RegExp(p, 'i'));
const REMOVE: readonly RegExp[] = [PATTERNS.uuid, PATTERNS.email, PATTERNS.last4, PATTERNS.longDigits].map((p) => new RegExp(p, 'gi'));

const money = (n: number): number => Math.round(n * 100) / 100;

const names = (ctx: MinimizerContext): string[] =>
  [...ctx.accountNames, ...ctx.bankNames, ...(ctx.personNames ?? []), ...ctx.knownIds].map((n) => n.trim()).filter((n) => n.length >= 2);

const mentions = (text: string, list: readonly string[]): boolean => {
  const lower = text.toLowerCase();
  return list.some((n) => lower.includes(n.toLowerCase()));
};

// A category label may leave only if it carries nothing identifying; otherwise it becomes "Other"
export function safeLabel(label: string, ctx: MinimizerContext): string {
  const text = label.trim().slice(0, 60);
  if (!text || mentions(text, names(ctx)) || TEST.some((r) => r.test(text))) return 'Other';
  return text;
}

export function minimize(spec: AggregateSpec, ctx: MinimizerContext): MinimizedInput {
  const figures: Record<string, number> = {};
  for (const [k, v] of Object.entries(spec.figures ?? {})) if (KEY_RE.test(k) && Number.isFinite(v)) figures[k] = money(v);
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(spec.counts ?? {})) if (KEY_RE.test(k) && Number.isFinite(v)) counts[k] = Math.max(0, Math.round(v));
  const series: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(spec.series ?? {})) if (KEY_RE.test(k)) series[k] = v.filter(Number.isFinite).slice(-MAX_SERIES).map(money);
  // categories that end up with the same safe label are added together, biggest first
  const byLabel = new Map<string, number>();
  for (const c of spec.categories ?? []) {
    if (!Number.isFinite(c.total)) continue;
    const label = safeLabel(c.name, ctx);
    byLabel.set(label, money((byLabel.get(label) ?? 0) + c.total));
  }
  const categories = [...byLabel.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    .slice(0, MAX_CATEGORIES);
  return { figures, counts, series, categories, placeholders: Object.keys(figures) };
}

// The text of a note, the single case where free text leaves the device: obvious identifiers
// (emails, card digits, ids, the names of the user's own accounts and banks) are removed first.
export function scrubNote(text: string, ctx: MinimizerContext): string {
  let out = text;
  for (const r of REMOVE) out = out.replace(r, ' ');
  for (const n of names(ctx).sort((a, b) => b.length - a.length)) out = out.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
  return out.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE_CHARS);
}
