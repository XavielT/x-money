import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AiAssistService, Suggestion } from '../../../shared/ai/ai-assist.service';
import { AiService } from '../../../shared/ai/ai.service';
import { AI_MODULES, AiFailure, AiModule } from '../../../shared/ai/ai.types';
import { featuresOf } from '../../../shared/ai/catalog';
import { Group, Verdict, TextGroup, normalizeText, slug } from '../../../shared/ai/inputs';
import { AiCardComponent } from '../../../shared/components/ai-card/ai-card';
import { AiLabelComponent } from '../../../shared/components/ai-label/ai-label';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { DashboardService } from '../../../shared/services/dashboard.service';
import { SettingsService } from '../../../shared/services/settings.service';
import { TranslateService } from '../../../shared/services/translate.service';

const LABELS: Record<AiModule, string> = { income: 'Income', expenses: 'Expenses', budgets: 'Budgets', business: 'Business', cards: 'Cards and accounts', loans: 'Loans', savings: 'Savings', dashboard: 'Dashboard' };

// Every AI function of the modules in one place. Each one shows its calculated text first; the
// ones that classify, group or rank only make SUGGESTIONS that the user accepts one by one.
import { SETTINGS_LINKS } from '../../../shared/config/settings-links';

@Component({
  selector: 'app-ai-hub',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe, AiCardComponent, AiLabelComponent],
  templateUrl: './ai-hub.html',
  styleUrl: './ai-hub.scss',
})
export class AiHubComponent {
  readonly settingsLinks = SETTINGS_LINKS;
  modules = AI_MODULES;
  tab = signal<AiModule>('dashboard');
  features = computed(() => featuresOf(this.tab()));
  period = signal<'month' | 'week'>('month');
  explainId = signal('available');
  indicators = computed(() => this.dashboard.visible());

  // review lists and their suggestions
  expenseGroups = signal<TextGroup[]>([]);
  expenseSuggestions = signal<Record<string, Suggestion[]>>({});
  incomeGroups = signal<TextGroup[]>([]);
  incomeSuggestions = signal<Record<string, Suggestion[]>>({});
  recurring = signal<{ note: string; name: string | null }[]>([]);
  groups = signal<{ names: string[]; groups: Group[] } | null>(null);
  sellers = signal<{ group: string; units: number; netProfit: number; members: number }[]>([]);
  duplicates = signal<{ a: string; b: string; amount: number; verdict?: Verdict; reason?: string; ids: string[] }[]>([]);
  ranking = signal<{ order: string[]; source: 'ai' | 'fallback' } | null>(null);
  strategy = signal<{ text: string; choice?: string; source: 'ai' | 'fallback' } | null>(null);
  busy = signal('');
  message = signal('');
  notice = signal('');

  constructor(
    public ai: AiService,
    private assist: AiAssistService,
    private dashboard: DashboardService,
    public settings: SettingsService,
    private translate: TranslateService
  ) {
    this.refreshLists();
  }

  label(m: AiModule): string {
    return LABELS[m];
  }

  indicatorLabel(id: string): string {
    return this.indicators().find((i) => slug(i.id) === id)?.label ?? id;
  }

  money(n: number): string {
    return `${this.settings.currency()}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  private refreshLists(): void {
    this.expenseGroups.set(this.assist.uncategorizedExpenses().slice(0, 15));
    this.incomeGroups.set(this.assist.unclassifiedIncome().slice(0, 15));
    this.sellers.set(this.assist.bestSellers().slice(0, 8));
  }

  private fail(code: AiFailure | undefined): boolean {
    this.message.set(code ? this.ai.messageOf(code) : '');
    return !!code;
  }

  // ----- expenses
  async suggestExpenses(): Promise<void> {
    this.busy.set('expenses');
    const groups = this.expenseGroups();
    const r = await this.assist.suggestCategories(groups.map((g) => g.text));
    this.busy.set('');
    if (this.fail(r.failure) && r.failure === 'consent-needed') return;
    this.expenseSuggestions.set(Object.fromEntries(groups.map((g, i) => [g.key, r.results[i]])));
  }

  acceptExpense(g: TextGroup, s: Suggestion): void {
    const n = this.assist.applyCategory(g.ids, s.target, g.text);
    this.notice.set(this.translate.instant('{n} movements were updated.', { n: String(n) }));
    this.refreshLists();
  }

  async normalize(): Promise<void> {
    this.busy.set('normalize');
    const notes = this.assist.recurringNotes();
    const r = await this.assist.normalizeNames(notes);
    this.busy.set('');
    if (this.fail(r.failure)) return;
    this.recurring.set(notes.map((note, i) => ({ note, name: r.names[i] ?? null })));
  }

  // ----- income
  async suggestIncome(): Promise<void> {
    this.busy.set('income');
    const groups = this.incomeGroups();
    const r = await this.assist.suggestIncomeKinds(groups.map((g) => g.text));
    this.busy.set('');
    if (this.fail(r.failure) && r.failure === 'consent-needed') return;
    this.incomeSuggestions.set(Object.fromEntries(groups.map((g, i) => [g.key, r.results[i]])));
  }

  acceptIncome(g: TextGroup, s: Suggestion): void {
    const r = this.assist.applyIncomeKind(g.ids, s.target, g.text);
    this.notice.set(this.translate.instant(r === 'applied' ? 'The income was linked to your source.' : r === 'several' ? 'You have several sources of that kind: choose one in Income.' : 'You have no source of that kind yet: create it in Income.'));
    this.refreshLists();
  }

  // ----- business
  async group(): Promise<void> {
    this.busy.set('group');
    const r = await this.assist.groupItems();
    this.busy.set('');
    if (this.fail(r.failure)) return;
    this.groups.set({ names: r.names, groups: r.groups });
  }

  confirmGroup(g: Group): void {
    const names = this.groups()?.names ?? [];
    this.assist.confirmGroup(g, names);
    this.groups.update((x) => (x ? { ...x, groups: x.groups.filter((y) => y !== g) } : x));
    this.refreshLists();
  }

  // ----- cards and accounts
  async judge(): Promise<void> {
    this.busy.set('judge');
    const r = await this.assist.judgeDuplicates();
    this.busy.set('');
    if (this.fail(r.failure)) return;
    this.duplicates.set(r.pairs.map((p, i) => ({ a: p.a.note ?? '', b: p.b.note ?? '', amount: p.c.amount, ids: [p.a.id, p.b.id], verdict: r.verdicts.find((v) => v.index === i)?.verdict, reason: r.verdicts.find((v) => v.index === i)?.reason })));
  }

  // ----- budgets and dashboard
  async chooseStrategy(): Promise<void> {
    this.busy.set('strategy');
    const r = await this.assist.chooseStrategy();
    this.busy.set('');
    if (r.failure === 'consent-needed') {
      this.fail(r.failure);
      return;
    }
    if (r.source === 'none') return;
    this.fail(r.failure);
    this.strategy.set({ text: r.text, choice: r.choice, source: r.source === 'ai' ? 'ai' : 'fallback' });
  }

  async rank(): Promise<void> {
    this.busy.set('rank');
    const r = await this.assist.rankIndicators();
    this.busy.set('');
    this.fail(r.failure);
    this.ranking.set({ order: r.order, source: r.source });
  }

  norm(s: string): string {
    return normalizeText(s);
  }

  assistPreview(featureId: string): unknown {
    return this.assist.previewWire(featureId);
  }

  hasAi(map: Record<string, Suggestion[]>): boolean {
    return Object.values(map).some((l) => l.some((s) => s.source === 'ai'));
  }

  // consent for the functions that are not narrations: the same sheet text, then confirm
  acknowledge(featureId: string): void {
    this.ai.acknowledge(featureId);
    this.message.set('');
  }

  needsConsent(featureId: string): boolean {
    return this.ai.prefs().enabled && !this.ai.isAcknowledged(featureId);
  }
}
