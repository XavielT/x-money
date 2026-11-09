import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ExpectedIncomeComponent } from '../../../shared/components/expected-income/expected-income';
import { IncomeKind, IncomeMethod, IncomeSchedule, IncomeSourceModel, IncomeStability, IncomeVerifiability } from '../../../shared/models/income-source.model';
import { TransactionModel } from '../../../shared/models/transaction.model';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { AccountService } from '../../../shared/services/account.service';
import { IncomeSourceService, SourceError } from '../../../shared/services/income-source.service';
import { IncomeService } from '../../../shared/services/income.service';
import { SettingsService } from '../../../shared/services/settings.service';
import { SuggestionsService } from '../../../shared/services/suggestions.service';
import { TranslateService } from '../../../shared/services/translate.service';
import { IncomePatternSuggestion } from '../../../shared/domain/income-patterns';
import { monthlyTotals } from '../../../shared/domain/income';
import { localIso, weekdayOf } from '../../../shared/domain/dates';

// English phrases are the translation keys
const KIND_LABELS: Record<IncomeKind, string> = {
  payroll: 'Payroll salary',
  'bonus-commission': 'Bonuses and commissions',
  freelance: 'Freelance income',
  'commercial-sales': 'Commercial sales',
  'vehicle-trade': 'Vehicle buying and selling',
  'parts-accessories': 'Accessories and parts sales',
  extraordinary: 'Extraordinary income',
  custom: 'Other (you name it)',
};

const STABILITY_LABELS: Record<IncomeStability, string> = { recurring: 'Recurring', variable: 'Variable', occasional: 'Occasional' };

const ERROR_TEXT: Record<SourceError, string> = {
  name: 'Give the source a name (and a type name if it is custom).',
  schedule: 'The schedule is not valid.',
  amount: 'The expected amounts are not valid (the net cannot be more than the gross).',
  account: 'Choose an existing account.',
  'read-only': 'Update X Money to save changes.',
  'not-found': 'Source not found.',
  'in-use': 'This source has income recorded. Deactivate it instead of deleting it.',
};

type Periodicity = 'none' | 'weekly' | 'biweekly' | 'monthly' | 'days' | 'every';

// Income screen: sources, what is expected, averages and stability, the unclassified income
// review, and the form. Everything shown as an average or a "guaranteed" figure is an estimate
// with its assumptions next to it; variable income is never part of the guaranteed amount.
import { ModuleOffComponent } from '../../../shared/components/module-off/module-off';

@Component({
  selector: 'app-income',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, ExpectedIncomeComponent, ModuleOffComponent],
  templateUrl: './income.html',
  styleUrl: './income.scss',
})
export class IncomeComponent {
  readonly kinds = Object.keys(KIND_LABELS) as IncomeKind[];
  readonly stabilities = Object.keys(STABILITY_LABELS) as IncomeStability[];
  readonly weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  readonly colors = ['#42a5f5', '#66bb6a', '#ffca28', '#ff7043', '#7e57c2', '#26a69a', '#ec407a', '#8d6e63'];

  view = signal<'list' | 'detail' | 'form' | 'review'>('list');
  selectedId = signal<string | null>(null);
  message = signal('');
  error = signal('');
  now = new Date();

  // form
  editingId: string | null = null;
  fName = '';
  fKind: IncomeKind = 'payroll';
  fCustomKind = '';
  fIcon = '💼';
  fColor = '#42a5f5';
  fActive = true;
  fStability: IncomeStability = 'recurring';
  fPeriodicity: Periodicity = 'monthly';
  fWeekday = 5;
  fDay1: number | null = 15;
  fDay2: number | null = 30;
  fDays = '15, 30';
  fEveryN: number | null = 2;
  fEveryUnit: 'days' | 'weeks' | 'months' = 'weeks';
  fAnchor = '';
  fMethod: IncomeMethod = 'transfer';
  fAccountId = '';
  fVerifiability: IncomeVerifiability = 'declared';
  fGross: number | null = null;
  fNet: number | null = null;

  // review of unclassified income
  marked = signal<ReadonlySet<string>>(new Set());
  reviewSource = signal('');

  selected = computed(() => this.sources.byId(this.selectedId() ?? undefined));
  breakdown = computed(() => this.income.monthBreakdown(this.now.getFullYear(), this.now.getMonth() + 1));
  capacity: IncomeService['capacity'];
  unclassified: IncomeService['unclassified'];
  recurringRules: IncomeService['incomeRules'];
  patternSuggestions = computed(() => this.suggestions.incomes());

  constructor(
    public sources: IncomeSourceService,
    public income: IncomeService,
    public accountService: AccountService,
    public settings: SettingsService,
    private suggestions: SuggestionsService,
    private translate: TranslateService
  ) {
    // not in initializers: parameter properties are not assigned yet there
    this.capacity = this.income.capacity;
    this.unclassified = this.income.unclassified;
    this.recurringRules = this.income.incomeRules;
    this.fAnchor = localIso(new Date());
  }

  kindLabel(s: IncomeSourceModel): string {
    return s.kind === 'custom' ? s.customKind ?? KIND_LABELS.custom : KIND_LABELS[s.kind];
  }

  kindText(k: IncomeKind): string {
    return KIND_LABELS[k];
  }

  stabilityLabel(s: IncomeStability): string {
    return STABILITY_LABELS[s];
  }

  isCommercial(k: IncomeKind): boolean {
    return k === 'commercial-sales' || k === 'vehicle-trade' || k === 'parts-accessories';
  }

  // ----- list / detail

  open(s: IncomeSourceModel): void {
    this.selectedId.set(s.id);
    this.view.set('detail');
    this.message.set('');
  }

  back(): void {
    if (this.view() === 'list') history.back();
    else this.view.set(this.view() === 'form' && this.selectedId() ? 'detail' : 'list');
    this.error.set('');
  }

  nextExpected(s: IncomeSourceModel): string {
    const next = this.income.upcoming().find((e) => e.sourceId === s.id) ?? this.income.pending().find((e) => e.sourceId === s.id);
    return next?.date ?? '';
  }

  last(s: IncomeSourceModel): TransactionModel | undefined {
    return this.income.lastIncomeOf(s.id);
  }

  monthlyAverage(s: IncomeSourceModel): number {
    return this.income.averagesOf(s.id).monthly;
  }

  stabilityOf(s: IncomeSourceModel) {
    return this.income.stabilityOf(s);
  }

  weightOf(s: IncomeSourceModel): number {
    return this.income.weights().find((w) => w.sourceId === s.id)?.percent ?? 0;
  }

  history(s: IncomeSourceModel): TransactionModel[] {
    return this.income.incomeOf(s.id).slice(0, 12);
  }

  // Last 6 complete months plus the running one, bars scaled to the biggest
  // computed for the selected source: the chart must not be rebuilt on every change detection
  chart = computed(() => (this.selected() ? this.bars(this.selected()!) : []));

  private bars(s: IncomeSourceModel): { label: string; value: number; height: number; current: boolean }[] {
    const totals = monthlyTotals(this.income.incomeOf(s.id));
    const today = localIso(this.now);
    const keys: string[] = [];
    let y = Number(today.slice(0, 4));
    let m = Number(today.slice(5, 7));
    for (let i = 0; i < 7; i++) {
      keys.unshift(`${y}-${String(m).padStart(2, '0')}`);
      if (--m < 1) {
        m = 12;
        y--;
      }
    }
    const max = Math.max(1, ...keys.map((k) => totals.get(k) ?? 0));
    return keys.map((k, i) => ({ label: k.slice(5), value: totals.get(k) ?? 0, height: Math.round(((totals.get(k) ?? 0) / max) * 100), current: i === keys.length - 1 }));
  }

  isCash(t: TransactionModel): boolean {
    return this.accountService.byId(t.accountId)?.type === 'cash';
  }

  accountName(id: string | undefined): string {
    return (id && this.accountService.byId(id)?.name) || '';
  }

  // "declared: recurring, but it varied 38 %"
  mismatchText(s: IncomeSourceModel): string {
    const r = this.stabilityOf(s);
    return this.translate.instant('Declared: {declared}, but it varied {percent}%', { declared: this.translate.instant(STABILITY_LABELS[s.stability]).toLowerCase(), percent: String(r.variationPercent ?? 0) });
  }

  toggleActive(s: IncomeSourceModel): void {
    this.sources.setActive(s.id, !s.active);
  }

  remove(s: IncomeSourceModel): void {
    const result = this.sources.remove(s.id);
    if (!result.ok) {
      this.message.set(this.translate.instant(ERROR_TEXT[result.error]));
      return;
    }
    this.view.set('list');
    this.selectedId.set(null);
  }

  // ----- form

  openForm(s?: IncomeSourceModel): void {
    this.error.set('');
    this.editingId = s?.id ?? null;
    this.fName = s?.name ?? '';
    this.fKind = s?.kind ?? 'payroll';
    this.fCustomKind = s?.customKind ?? '';
    this.fIcon = s?.icon ?? '💼';
    this.fColor = s?.color ?? '#42a5f5';
    this.fActive = s?.active ?? true;
    this.fStability = s?.stability ?? 'recurring';
    this.fMethod = s?.method ?? 'transfer';
    this.fAccountId = s?.defaultAccountId ?? '';
    this.fVerifiability = s?.verifiability ?? 'declared';
    this.fGross = s?.expectedGross ?? null;
    this.fNet = s?.expectedNet ?? null;
    this.loadSchedule(s?.schedule);
    this.view.set('form');
  }

  private loadSchedule(sch: IncomeSchedule | undefined): void {
    this.fPeriodicity = 'none';
    if (!sch) return;
    if (sch.mode === 'weekly') {
      this.fPeriodicity = 'weekly';
      this.fWeekday = sch.weekday;
    } else if (sch.mode === 'every') {
      this.fPeriodicity = 'every';
      this.fEveryN = sch.n;
      this.fEveryUnit = sch.unit;
      this.fAnchor = sch.anchor;
    } else if (sch.days.length === 1) {
      this.fPeriodicity = 'monthly';
      this.fDay1 = sch.days[0];
    } else if (sch.days.length === 2) {
      this.fPeriodicity = 'biweekly';
      [this.fDay1, this.fDay2] = sch.days;
    } else {
      this.fPeriodicity = 'days';
      this.fDays = sch.days.join(', ');
    }
  }

  setMethod(m: IncomeMethod): void {
    this.fMethod = m;
    // the usual account: the cash account for cash, a bank account for transfers
    const wanted = this.accountService.activeAccounts().find((a) => (m === 'cash' ? a.type === 'cash' : a.type === 'bank'));
    if (wanted) this.fAccountId = wanted.id;
  }

  private buildSchedule(): IncomeSchedule | undefined {
    switch (this.fPeriodicity) {
      case 'none':
        return undefined;
      case 'weekly':
        return { mode: 'weekly', weekday: Number(this.fWeekday) };
      case 'biweekly':
        return { mode: 'month-days', days: [Number(this.fDay1), Number(this.fDay2)] };
      case 'monthly':
        return { mode: 'month-days', days: [Number(this.fDay1)] };
      case 'days':
        return { mode: 'month-days', days: this.fDays.split(/[,\s]+/).filter(Boolean).map(Number) };
      case 'every':
        return { mode: 'every', n: Number(this.fEveryN), unit: this.fEveryUnit, anchor: this.fAnchor };
    }
  }

  save(): void {
    const data = {
      name: this.fName,
      kind: this.fKind,
      customKind: this.fCustomKind,
      icon: this.fIcon.trim() || '💼',
      color: this.fColor,
      active: this.fActive,
      stability: this.fStability,
      schedule: this.buildSchedule(),
      method: this.fMethod,
      defaultAccountId: this.fAccountId || undefined,
      verifiability: this.fVerifiability,
      expectedGross: this.fGross ? Number(this.fGross) : undefined,
      expectedNet: this.fNet ? Number(this.fNet) : undefined,
    };
    const existing = this.editingId ? this.sources.byId(this.editingId) : undefined;
    const result = existing ? this.sources.update({ ...existing, ...data }) : this.sources.add(data);
    if (!result.ok) {
      this.error.set(this.translate.instant(ERROR_TEXT[result.error]));
      return;
    }
    this.selectedId.set(result.id);
    this.view.set('detail');
  }

  // ----- review of unclassified income

  toggle(id: string): void {
    const next = new Set(this.marked());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.marked.set(next);
  }

  markAll(): void {
    this.marked.set(new Set(this.unclassified().map((t) => t.id)));
  }

  assign(): void {
    if (!this.reviewSource() || !this.marked().size) return;
    const count = this.income.assign([...this.marked()], this.reviewSource());
    this.marked.set(new Set());
    this.message.set(`${count} ${this.translate.instant('income movements classified.')}`);
    if (!this.unclassified().length) this.view.set('list');
  }

  // ----- suggestions and old recurring rules

  createFromPattern(s: IncomePatternSuggestion): void {
    const result = this.income.createFromPattern(s);
    this.message.set(this.translate.instant(result.ok ? 'Income source created. Review its details.' : 'The source could not be created.'));
  }

  dismissPattern(s: IncomePatternSuggestion): void {
    this.suggestions.dismissIncome(s);
  }

  link(ruleId: string, sourceId: string): void {
    this.income.linkRule(ruleId, sourceId || undefined);
  }

  ruleName(note: string | undefined, amount: number): string {
    return note || `${this.settings.currency()}${amount}`;
  }

  weekdayName(date: string): string {
    return this.weekdays[weekdayOf(date)];
  }
}
