import { RuleId } from '../domain/insights/types';

// A dismissed or snoozed insight, kept with the fingerprint of the evidence it was about: it
// reappears only when the evidence changes materially (or when a snooze runs out)
export interface InsightStateModel {
  id: string; // the insight id, made storage-safe
  insightId: string;
  status: 'dismissed' | 'snoozed';
  fingerprint: string;
  until?: string; // snoozed: ISO date it comes back
  at: string;
}

export interface RuleSetting {
  enabled: boolean;
  thresholds: Record<string, number>;
}

export interface InsightSettings {
  rules: Partial<Record<RuleId, RuleSetting>>;
}
