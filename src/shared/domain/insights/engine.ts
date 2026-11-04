// The smart-alerts engine: the registry of rules with their configurable thresholds, ranking, and
// the dismiss / snooze logic. Pure.
import { InsightSettings, InsightStateModel, RuleSetting } from '../../models/insight.model';
import { Insight, InsightModule, RuleId, SEVERITY_RANK } from './types';

export interface ThresholdDef {
  key: string;
  labelKey: string;
  default: number;
  min: number;
  max: number;
}

export interface RuleDef {
  id: RuleId;
  module: InsightModule;
  labelKey: string;
  descriptionKey: string;
  thresholds: ThresholdDef[];
}

export const RULES: readonly RuleDef[] = [
  {
    id: 'small-expenses',
    module: 'spending',
    labelKey: 'Small expenses that add up',
    descriptionKey: 'Many small purchases in the last 30 days, by category, account and card.',
    thresholds: [
      { key: 'minTotal', labelKey: 'Minimum total (RD$)', default: 2000, min: 0, max: 1e9 },
      { key: 'minSharePercent', labelKey: 'Minimum share of the spending (%)', default: 15, min: 0, max: 100 },
      { key: 'minCount', labelKey: 'Minimum number of purchases', default: 8, min: 1, max: 1000 },
    ],
  },
  {
    id: 'unusual-increase',
    module: 'spending',
    labelKey: 'Unusual increase in spending',
    descriptionKey: 'A category or the total of last month far above its 6-month median and range.',
    thresholds: [
      { key: 'minAmount', labelKey: 'Minimum increase (RD$)', default: 1000, min: 0, max: 1e9 },
      { key: 'minRisePercent', labelKey: 'Minimum rise over the median (%)', default: 20, min: 0, max: 1000 },
    ],
  },
  {
    id: 'low-savings',
    module: 'savings',
    labelKey: 'Months with low saving capacity',
    descriptionKey: 'The month saved much less than usual; seasonal patterns with 12 months of data.',
    thresholds: [{ key: 'dropPercent', labelKey: 'Below the median by (%)', default: 50, min: 1, max: 100 }],
  },
  {
    id: 'budget-adjust',
    module: 'budget',
    labelKey: 'Recommended budget adjustments',
    descriptionKey: 'Your block limits far from what your history suggests.',
    thresholds: [{ key: 'gapPercent', labelKey: 'Gap with the suggestion (%)', default: 20, min: 1, max: 1000 }],
  },
  {
    id: 'reservable',
    module: 'savings',
    labelKey: 'How much you can set aside',
    descriptionKey: 'Guaranteed income minus fixed, variable and debt payments, with a safety margin.',
    thresholds: [{ key: 'safetyPercent', labelKey: 'Safety margin over variable spending (%)', default: 10, min: 0, max: 100 }],
  },
  {
    id: 'variable-dependence',
    module: 'income',
    labelKey: 'Dependence on variable income',
    descriptionKey: 'Share of the last 6 months of income that comes from variable sources.',
    thresholds: [{ key: 'sharePercent', labelKey: 'Alert from (% of income)', default: 40, min: 1, max: 100 }],
  },
  {
    id: 'declared-vs-received',
    module: 'income',
    labelKey: 'Declared versus recorded income',
    descriptionKey: 'The difference between what you declared you would receive and what was recorded.',
    thresholds: [
      { key: 'months', labelKey: 'Months to compare', default: 3, min: 1, max: 12 },
      { key: 'gapPercent', labelKey: 'Difference to show (%)', default: 15, min: 1, max: 1000 },
      { key: 'minGap', labelKey: 'Minimum difference (RD$)', default: 1000, min: 0, max: 1e9 },
    ],
  },
  {
    id: 'duplicates',
    module: 'data',
    labelKey: 'Possible duplicate movements',
    descriptionKey: 'Same amount and account within a day and a similar note. You decide; nothing is merged.',
    thresholds: [{ key: 'minScore', labelKey: 'Minimum score (%)', default: 75, min: 50, max: 100 }],
  },
  {
    id: 'commitments',
    module: 'debt',
    labelKey: 'Upcoming payment commitments',
    descriptionKey: 'Cards, loan installments and fixed expenses of the next 30 days against your money.',
    thresholds: [],
  },
];

export const ruleOf = (id: RuleId): RuleDef => RULES.find((r) => r.id === id)!;

// The setting of a rule with every threshold present (defaults fill what the user never touched)
export function ruleSetting(settings: InsightSettings, id: RuleId): RuleSetting {
  const def = ruleOf(id);
  const saved = settings.rules[id];
  const thresholds: Record<string, number> = {};
  for (const t of def.thresholds) {
    const v = saved?.thresholds?.[t.key];
    thresholds[t.key] = typeof v === 'number' && Number.isFinite(v) && v >= t.min && v <= t.max ? v : t.default;
  }
  return { enabled: saved?.enabled ?? true, thresholds };
}

export const DEFAULT_INSIGHT_SETTINGS: InsightSettings = { rules: {} };

// ----- visibility: dismiss and snooze

export const stateIdOf = (insightId: string): string => insightId.replace(/[^A-Za-z0-9_.:~-]/g, '_').slice(0, 128);

export function isVisible(insight: Insight, state: InsightStateModel | undefined, today: string): boolean {
  if (!state) return true;
  if (state.fingerprint !== insight.fingerprint) return true; // the evidence changed materially
  if (state.status === 'dismissed') return false;
  return !!state.until && today >= state.until; // a snooze runs out on its date
}

const MODULE_ORDER: Record<InsightModule, number> = { debt: 0, cards: 1, budget: 2, spending: 3, savings: 4, income: 5, data: 6 };

// Most important first: severity, then critical ones, then module
export function rank(insights: readonly Insight[]): Insight[] {
  return [...insights].sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || Number(!!b.critical) - Number(!!a.critical) || MODULE_ORDER[a.module] - MODULE_ORDER[b.module] || a.id.localeCompare(b.id)
  );
}
