// Pure builders and parsers of the AI functions of the modules (2.17.0). A builder turns numbers
// the app already calculated into (1) the minimized wire input, (2) the values the {{markers}} will
// take, all local, and (3) the deterministic text shown when AI is off, offline or rejected. A
// parser reads a JSON answer strictly: whatever does not fit the expected shape is dropped, and the
// user always confirms before anything is applied.
import { TransactionModel } from '../models/transaction.model';
import { quartiles, fmtMoney, fmtPct } from '../domain/insights/helpers';
import { addDays } from '../domain/dates';
import { isIncomeTx } from '../domain/income';
import { MinimizerContext, safeLabel } from './minimizer';
import { validateOutput } from './output';

// ===== narrations

export interface NarrationRow {
  key: string; // snake_case: the base of its markers
  label?: string; // shown to the model after being made safe (never a name of an account or bank)
  amount?: number; // RD$: marker {{key_amount}}
  percent?: number; // marker {{key_pct}}
  count?: number; // marker {{key_n}}
  text?: string; // a local word (a category, a kind): marker {{key_text}}, never sent
  date?: string; // marker {{key_date}}, never sent
}

export interface NarrationWire {
  figures: Record<string, number>;
  counts: Record<string, number>;
  series: Record<string, number[]>;
  labels: Record<string, string>;
  placeholders: string[];
  context: Record<string, string>;
}

export interface Prepared {
  featureId: string;
  wire: NarrationWire;
  values: Record<string, string>; // what each marker becomes, calculated here
  fallback: string; // the deterministic text (markers already replaced)
}

export const MAX_ROWS = 14;
const KEY_RE = /^[a-z][a-z0-9_]{0,30}$/;
const round2 = (n: number): number => Math.round(n * 100) / 100;

export const slug = (text: string): string => {
  const s = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[a-z]/.test(s) ? s.slice(0, 24) : `x${s}`.slice(0, 24);
};

// The deterministic text uses {name} placeholders (the same names as the {{markers}} of the model);
// a name without a value makes the whole template unusable, never a blank
export function fill(template: string, values: Readonly<Record<string, string>>): string | null {
  let missing = false;
  const out = template.replace(/{([a-z][a-z0-9_]*)}/g, (_m, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      missing = true;
      return '';
    }
    return values[key];
  });
  return missing ? null : out;
}

export function buildNarration(
  featureId: string,
  rows: readonly NarrationRow[],
  fallbackTemplate: string,
  ctx: MinimizerContext,
  options: { context?: Record<string, string>; series?: Record<string, readonly number[]> } = {}
): Prepared {
  const wire: NarrationWire = { figures: {}, counts: {}, series: {}, labels: {}, placeholders: [], context: { ...(options.context ?? {}) } };
  const values: Record<string, string> = {};
  const lines: string[] = [];
  for (const r of rows.slice(0, MAX_ROWS)) {
    if (!KEY_RE.test(r.key)) continue;
    if (r.label) wire.labels[r.key] = safeLabel(r.label, ctx);
    const shown: string[] = [];
    if (r.amount !== undefined && Number.isFinite(r.amount)) {
      wire.figures[`${r.key}_amount`] = round2(r.amount);
      values[`${r.key}_amount`] = fmtMoney(round2(r.amount));
      shown.push(values[`${r.key}_amount`]);
    }
    if (r.percent !== undefined && Number.isFinite(r.percent)) {
      wire.figures[`${r.key}_pct`] = round2(r.percent);
      values[`${r.key}_pct`] = fmtPct(r.percent);
      shown.push(values[`${r.key}_pct`]);
    }
    if (r.count !== undefined && Number.isFinite(r.count)) {
      wire.counts[`${r.key}_n`] = Math.max(0, Math.round(r.count));
      values[`${r.key}_n`] = String(Math.max(0, Math.round(r.count)));
      shown.push(values[`${r.key}_n`]);
    }
    if (r.text !== undefined) values[`${r.key}_text`] = r.text;
    if (r.date !== undefined) {
      values[`${r.key}_date`] = r.date;
      shown.push(r.date);
    }
    if (r.label || shown.length) lines.push(`${r.label ?? r.text ?? r.key}: ${shown.join(' · ')}`);
  }
  for (const [k, v] of Object.entries(options.series ?? {})) if (KEY_RE.test(k)) wire.series[k] = v.filter(Number.isFinite).slice(-24).map(round2);
  wire.placeholders = Object.keys(values).slice(0, 80);
  const filled = fallbackTemplate ? fill(fallbackTemplate, values) : null;
  return { featureId, wire, values, fallback: filled ?? lines.join('\n') };
}

// ===== strict parsing of JSON answers

export function parseJson(raw: string): unknown | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isIndex = (v: unknown, count: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < count;
// a short sentence the model wrote: it may not carry figures or markers
const cleanReason = (v: unknown): string => (typeof v === 'string' && v.length <= 160 && validateOutput(v, new Set()).ok ? v.trim() : '');

export interface Pick {
  option: string;
  confidence: number;
}

// {"results":[{"i":0,"picks":[{"o":"Food","c":0.8}]}]} -> by item, only the given options, at most 3
export function parseClassification(raw: string, count: number, options: readonly string[]): Pick[][] | null {
  const data = parseJson(raw);
  if (!isRec(data) || !Array.isArray(data['results'])) return null;
  const out: Pick[][] = Array.from({ length: count }, () => []);
  for (const r of data['results']) {
    if (!isRec(r) || !isIndex(r['i'], count) || !Array.isArray(r['picks'])) continue;
    const picks: Pick[] = [];
    for (const p of r['picks']) {
      if (!isRec(p) || typeof p['o'] !== 'string' || !options.includes(p['o']) || typeof p['c'] !== 'number' || !Number.isFinite(p['c'])) continue;
      if (!picks.some((x) => x.option === p['o'])) picks.push({ option: p['o'], confidence: Math.min(1, Math.max(0, p['c'])) });
    }
    out[r['i']] = picks.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
  }
  return out;
}

export function parseNames(raw: string, count: number): (string | null)[] | null {
  const data = parseJson(raw);
  if (!isRec(data) || !Array.isArray(data['names'])) return null;
  const out: (string | null)[] = Array.from({ length: count }, () => null);
  for (const n of data['names']) {
    if (!isRec(n) || !isIndex(n['i'], count) || typeof n['name'] !== 'string') continue;
    const name = n['name'].replace(/[\u0000-\u001f]/g, '').trim();
    if (name.length >= 2 && name.length <= 40 && !name.includes('{{')) out[n['i']] = name;
  }
  return out;
}

export interface Group {
  name: string;
  members: number[];
}

export function parseGroups(raw: string, count: number): Group[] | null {
  const data = parseJson(raw);
  if (!isRec(data) || !Array.isArray(data['groups'])) return null;
  const used = new Set<number>();
  const groups: Group[] = [];
  for (const g of data['groups']) {
    if (!isRec(g) || typeof g['name'] !== 'string' || !Array.isArray(g['members'])) continue;
    const members = [...new Set((g['members'] as unknown[]).filter((m): m is number => isIndex(m, count) && !used.has(m)))];
    const name = g['name'].trim();
    if (members.length < 2 || name.length < 2 || name.length > 40) continue;
    members.forEach((m) => used.add(m));
    groups.push({ name, members });
  }
  return groups;
}

export type Verdict = 'duplicate' | 'not-duplicate' | 'doubtful';

export function parseVerdicts(raw: string, count: number): { index: number; verdict: Verdict; reason: string }[] | null {
  const data = parseJson(raw);
  if (!isRec(data) || !Array.isArray(data['verdicts'])) return null;
  const out: { index: number; verdict: Verdict; reason: string }[] = [];
  for (const v of data['verdicts']) {
    if (!isRec(v) || !isIndex(v['i'], count) || (v['verdict'] !== 'duplicate' && v['verdict'] !== 'not-duplicate' && v['verdict'] !== 'doubtful')) continue;
    out.push({ index: v['i'], verdict: v['verdict'], reason: cleanReason(v['reason']) });
  }
  return out;
}

// The model may only reorder the ids it was given; ids it left out go last in their own order
export function parseOrder(raw: string, ids: readonly string[]): string[] | null {
  const data = parseJson(raw);
  if (!isRec(data) || !Array.isArray(data['order'])) return null;
  const order = [...new Set((data['order'] as unknown[]).filter((x): x is string => typeof x === 'string' && ids.includes(x)))];
  return [...order, ...ids.filter((i) => !order.includes(i))];
}

export function parseChoice(raw: string, options: readonly string[]): { choice: string; text: string } | null {
  const data = parseJson(raw);
  if (!isRec(data) || typeof data['choice'] !== 'string' || !options.includes(data['choice']) || typeof data['text'] !== 'string') return null;
  return { choice: data['choice'], text: data['text'] };
}

// ===== local rules: learned words are applied BEFORE calling AI

export interface TextRule {
  id: string; // `${scope}:${word}`
  scope: 'expense' | 'income' | 'item' | 'income-source'; // income-source: who pays -> a source of the user (2.18.0)
  word: string;
  target: string; // a category id, an income kind or the name of an item family
  createdAt: string;
}

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const wordsOf = (text: string): string[] => normalizeText(text).split(' ').filter((w) => w.length >= 3);

// The word worth remembering from a note: the longest one (a brand or a concept, not "de" or "la")
export function ruleWordFor(note: string): string | null {
  return wordsOf(note).sort((a, b) => b.length - a.length)[0] ?? null;
}

export function matchRule(note: string, scope: TextRule['scope'], rules: readonly TextRule[]): TextRule | undefined {
  const words = new Set(wordsOf(note));
  return rules
    .filter((r) => r.scope === scope && words.has(r.word))
    .sort((a, b) => b.word.length - a.word.length)[0];
}

export interface TextGroup {
  key: string;
  text: string;
  ids: string[];
  count: number;
}

// Equal texts together: one question to the model per distinct text, not per movement
export function groupByText(items: readonly { id: string; note: string }[]): TextGroup[] {
  const map = new Map<string, TextGroup>();
  for (const i of items) {
    const key = normalizeText(i.note);
    if (!key) continue;
    const g = map.get(key) ?? { key, text: i.note.trim(), ids: [], count: 0 };
    g.ids.push(i.id);
    g.count++;
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

// ===== unusual income (a candidate for the question of the user)

export interface UnusualIncome {
  txId: string;
  amount: number;
  median: number;
  date: string;
}

export function unusualIncome(txs: readonly TransactionModel[], today: string, recentDays = 45): UnusualIncome[] {
  const incomes = txs.filter(isIncomeTx);
  const from = addDays(today, -recentDays);
  const out: UnusualIncome[] = [];
  for (const t of incomes) {
    if (t.date < from || t.date > today) continue;
    const before = incomes.filter((x) => x.id !== t.id && x.date < t.date && (t.incomeSourceId ? x.incomeSourceId === t.incomeSourceId : true)).map((x) => x.amount);
    if (before.length < 5) continue;
    const q = quartiles(before);
    if (t.amount > q.q3 + 1.5 * q.iqr && t.amount > q.median * 1.5) out.push({ txId: t.id, amount: t.amount, median: q.median, date: t.date });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

// ===== business: the ranking is calculated on the confirmed groups

export interface Seller {
  name: string;
  units: number;
  netProfit: number;
}

export function rankByGroups(items: readonly Seller[], rules: readonly TextRule[]): { group: string; units: number; netProfit: number; members: number }[] {
  const map = new Map<string, { group: string; units: number; netProfit: number; members: number }>();
  for (const i of items) {
    const rule = matchRule(i.name, 'item', rules);
    const group = rule?.target ?? i.name;
    const g = map.get(group) ?? { group, units: 0, netProfit: 0, members: 0 };
    g.units += i.units;
    g.netProfit = round2(g.netProfit + i.netProfit);
    g.members++;
    map.set(group, g);
  }
  return [...map.values()].sort((a, b) => b.units - a.units || b.netProfit - a.netProfit || a.group.localeCompare(b.group));
}
