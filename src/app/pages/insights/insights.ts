import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ExplainSheetComponent } from '../../../shared/components/explain-sheet/explain-sheet';
import { RULES, ruleOf } from '../../../shared/domain/insights/engine';
import { ProjectionEntry } from '../../../shared/domain/insights/projections';
import { EvidenceItem, Insight, InsightModule, Severity } from '../../../shared/domain/insights/types';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { SettingsService } from '../../../shared/services/settings.service';
import { SmartInsightService } from '../../../shared/services/smart-insight.service';
import { TranslateService } from '../../../shared/services/translate.service';

interface Sheet {
  title: string;
  evidence: readonly EvidenceItem[];
  formula: string;
  assumptions: readonly string[];
  state: 'confirmed' | 'estimate' | 'insufficient-history';
  period: string;
}

const SEVERITIES: Severity[] = ['alert', 'attention', 'info'];
const MODULES: InsightModule[] = ['debt', 'cards', 'budget', 'spending', 'savings', 'income', 'data'];

@Component({
  selector: 'app-insights',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe, ExplainSheetComponent],
  templateUrl: './insights.html',
  styleUrl: './insights.scss',
})
export class InsightsComponent {
  severities = SEVERITIES;
  modules = MODULES;
  severity = signal<Severity | null>(null);
  module = signal<InsightModule | null>(null);
  showHidden = signal(false);
  showProjections = signal(false);
  sheet = signal<Sheet | null>(null);

  list = computed(() => this.insights.visible().filter((i) => (!this.severity() || i.severity === this.severity()) && (!this.module() || i.module === this.module())));
  hidden = computed(() => this.insights.hidden());
  missing = computed(() => this.insights.insufficient().map((r) => ({ rule: ruleOf(r.rule), history: r.history })));
  projections = computed(() => (this.showProjections() ? this.insights.projections() : []));
  rules = RULES;

  constructor(
    public insights: SmartInsightService,
    private translate: TranslateService,
    public settings: SettingsService
  ) {}

  money(n: number): string {
    return `${n < 0 ? '-' : ''}${this.settings.currency()}${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  text(i: Insight) {
    return this.insights.text(i);
  }

  explain(i: Insight): void {
    this.sheet.set({ title: this.text(i).title, evidence: i.evidence, formula: i.formula, assumptions: i.dataState === 'estimate' ? ['This is an estimate: it is not a confirmed figure.'] : [], state: i.dataState, period: i.period });
  }

  explainProjection(p: ProjectionEntry): void {
    this.sheet.set({
      title: p.subject ? `${this.translate.instant(p.labelKey)}: ${p.subject}` : this.translate.instant(p.labelKey),
      evidence: [],
      formula: 'A projection from your data and the assumptions below; it is an estimate and can be wrong.',
      assumptions: p.estimate.assumptions,
      state: 'estimate',
      period: '',
    });
  }

  moduleLabel(m: InsightModule): string {
    return ({ debt: 'Debts and payments', cards: 'Cards', budget: 'Budget', spending: 'Spending', savings: 'Savings', income: 'Income', data: 'Data quality' } as Record<InsightModule, string>)[m];
  }

  unitLabel(u: string): string {
    return u === 'days' ? 'days' : u === 'sources' ? 'sources' : 'months';
  }

  // A projection value: a money figure, or the date and months of a goal
  num(v: unknown): number {
    return Number(v);
  }

  isNumber(v: unknown): v is number {
    return typeof v === 'number';
  }

  timing(v: unknown): string {
    const t = v as { date: string | null; months: number | null };
    return t.date ? `${t.date}${t.months !== null ? ` (${t.months} ${this.translate.instant('months')})` : ''}` : this.translate.instant('never');
  }
}
