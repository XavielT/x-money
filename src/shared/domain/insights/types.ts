// The contract of a financial insight (2.15.0). Everything under domain/insights is deterministic:
// no network, no AI, no Angular. The texts are TRANSLATION KEYS with calculated figures as
// parameters, so the screen translates them and the AI of later prompts only narrates them.

export type Severity = 'info' | 'attention' | 'alert';
export type InsightModule = 'spending' | 'income' | 'savings' | 'debt' | 'budget' | 'cards' | 'data';
// 'estimate' = a projection or an inference; 'confirmed' = counted from movements as they are
export type DataState = 'confirmed' | 'estimate' | 'insufficient-history';

export type RuleId =
  | 'small-expenses'
  | 'unusual-increase'
  | 'low-savings'
  | 'budget-adjust'
  | 'reservable'
  | 'variable-dependence'
  | 'declared-vs-received'
  | 'duplicates'
  | 'commitments';

export interface EvidenceItem {
  label: string; // English phrase (translation key)
  value: number | string;
  kind: 'money' | 'percent' | 'count' | 'text' | 'date';
  source?: { period?: string; txIds?: string[] }; // where the figure comes from
}

export interface InsightAction {
  labelKey: string;
  link: string; // a route inside the app
}

export interface Insight {
  id: string; // stable: the same situation has the same id
  rule: RuleId;
  module: InsightModule;
  severity: Severity;
  titleKey: string;
  messageKey: string;
  params: Record<string, string>; // figures already formatted
  translateParams?: string[]; // params that hold English phrases to translate before interpolating
  evidence: EvidenceItem[];
  formula: string; // English sentence (translation key)
  dataState: DataState;
  period: string; // 'YYYY-MM', 'YYYY-MM-DD..YYYY-MM-DD' or a label
  actions: InsightAction[];
  fingerprint: string; // changes only when the evidence changes materially
  critical?: boolean; // worth a device notification (due dates, not enough money)
}

// What a detector reports about its own history: it never fabricates a result without it
export interface HistoryNeed {
  needed: number;
  have: number;
  unit: 'months' | 'days' | 'sources';
}

export interface DetectorResult {
  rule: RuleId;
  status: 'ok' | 'insufficient-history';
  history: HistoryNeed;
  insights: Insight[];
}

// Every projection returns this: never a bare number (integrity rule 10)
export interface Estimate<T> {
  value: T;
  low: T;
  high: T;
  assumptions: string[]; // English phrases (translation keys)
  isEstimate: true;
}

export const estimate = <T>(value: T, low: T, high: T, assumptions: string[]): Estimate<T> => ({ value, low, high, assumptions, isEstimate: true });

export const SEVERITY_RANK: Record<Severity, number> = { alert: 3, attention: 2, info: 1 };

export const ok = (rule: RuleId, history: HistoryNeed, insights: Insight[]): DetectorResult => ({ rule, status: 'ok', history, insights });
export const insufficient = (rule: RuleId, history: HistoryNeed): DetectorResult => ({ rule, status: 'insufficient-history', history, insights: [] });
