import { TransactionModel } from '../../models/transaction.model';
import { round2 } from '../../utils/money';
import { quantile } from '../dashboard';
import { EvidenceItem, Insight } from './types';

// All insights are in RD$ (RD$ and US$ are never mixed)
export const fmtMoney = (n: number): string => `RD$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtPct = (n: number): string => `${Math.round(n * 10) / 10}%`;

export const isDop = (t: Pick<TransactionModel, 'currency'>): boolean => (t.currency ?? 'DOP') === 'DOP';

export function mean(values: readonly number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

export function stdev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length);
}

export const sorted = (values: readonly number[]): number[] => [...values].sort((a, b) => a - b);

export interface Quartiles {
  q1: number;
  median: number;
  q3: number;
  iqr: number;
}

export function quartiles(values: readonly number[]): Quartiles {
  const s = sorted(values);
  const q1 = quantile(s, 0.25);
  const q3 = quantile(s, 0.75);
  return { q1, median: quantile(s, 0.5), q3, iqr: q3 - q1 };
}

// ----- fingerprint: changes only when the evidence changes MATERIALLY (about 10 %)

export function bucketOf(value: number | string): number | string {
  if (typeof value === 'string') return value;
  if (!Number.isFinite(value) || value === 0) return 0;
  return Math.sign(value) * Math.round(Math.log(Math.abs(value)) / Math.log(1.1));
}

function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

export function fingerprintOf(id: string, evidence: readonly EvidenceItem[]): string {
  const parts = evidence.map((e) => [e.label, bucketOf(e.value), e.source?.txIds ? [...e.source.txIds].sort() : null]);
  return hash(JSON.stringify([id, parts]));
}

// Builds an insight and its fingerprint in one place so no detector forgets it
export function makeInsight(base: Omit<Insight, 'fingerprint' | 'actions'> & { actions?: Insight['actions'] }): Insight {
  return { ...base, actions: base.actions ?? [], fingerprint: fingerprintOf(base.id, base.evidence) };
}

export const round = round2;
