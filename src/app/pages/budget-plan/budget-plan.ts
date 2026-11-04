import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BaseIncome, BucketKind, MoveRef } from '../../../shared/models/budget.model';
import { BUCKET_KINDS, MoveError, isManualBucket } from '../../../shared/domain/budget';
import { BUCKET_LABELS } from '../../../shared/data/bucket-labels';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { BudgetService } from '../../../shared/services/budget.service';
import { CategoryService } from '../../../shared/services/category.service';
import { SettingsService } from '../../../shared/services/settings.service';
import { TranslateService } from '../../../shared/services/translate.service';

const MOVE_ERRORS: Record<MoveError, string> = {
  amount: 'Enter an amount greater than zero.',
  same: 'Choose two different items.',
  kind: 'Choose two blocks, or two categories that both have a budget.',
  insufficient: 'The origin does not have that much limit this month.',
  month: 'The month is not valid.',
};

type Tab = 'blocks' | 'projection' | 'recommend' | 'compare' | 'trends';

// Budget plan: distribution blocks, the projection of the balance at the end of the month,
// history-based recommendations, comparison between months and trends. Everything that looks
// ahead is an ESTIMATE and says so, with its assumptions; the real figures are facts.
@Component({
  selector: 'app-budget-plan',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './budget-plan.html',
  styleUrl: './budget-plan.scss',
})
export class BudgetPlanComponent {
  readonly tabs: { key: Tab; label: string }[] = [
    { key: 'blocks', label: 'Blocks' },
    { key: 'projection', label: 'Projection' },
    { key: 'recommend', label: 'Recommendations' },
    { key: 'compare', label: 'Compare' },
    { key: 'trends', label: 'Trends' },
  ];
  readonly kinds = BUCKET_KINDS;
  readonly bases: { key: BaseIncome; label: string }[] = [
    { key: 'guaranteed', label: 'Guaranteed' },
    { key: 'avg3', label: '3-month average' },
    { key: 'actual', label: 'Actual this month' },
  ];

  tab = signal<Tab>('blocks');
  message = signal('');
  year = new Date().getFullYear();
  month = new Date().getMonth() + 1;
  monthKey = `${this.year}-${String(this.month).padStart(2, '0')}`;

  base = computed(() => this.budget.baseIncome());
  rows = computed(() => this.budget.bucketRows(this.year, this.month));
  projection = computed(() => this.budget.endOfMonthProjection());
  recommendation = computed(() => this.budget.recommendation());
  remaining = computed(() => this.budget.remainingThisMonth());
  reduce = computed(() => this.budget.reduce());
  moves = computed(() => this.budget.moves().filter((m) => m.month === this.monthKey && !m.undone));
  comparison = computed(() => this.budget.compare(6));

  // move form
  moveType = signal<'bucket' | 'category'>('bucket');
  moveFrom = '';
  moveTo = '';
  moveAmount: number | null = null;

  // formulas the user can open ("where does it come from?")
  openFormula = signal<string | null>(null);

  // comparison: two months picked from the last six
  monthA = signal('');
  monthB = signal('');

  constructor(
    public budget: BudgetService,
    public categories: CategoryService,
    public settings: SettingsService,
    private translate: TranslateService
  ) {
    const months = this.comparison().map((c) => c.month);
    this.monthA.set(months[months.length - 2] ?? '');
    this.monthB.set(months[months.length - 1] ?? '');
  }

  label(kind: BucketKind): string {
    return BUCKET_LABELS[kind];
  }

  manual(kind: BucketKind): boolean {
    return isManualBucket(kind);
  }

  baseLabel(): string {
    return this.bases.find((b) => b.key === this.settings.budget().base)?.label ?? '';
  }

  setBase(base: BaseIncome): void {
    this.settings.setBudgetBase(base);
  }

  setMode(kind: BucketKind, mode: 'percent' | 'amount'): void {
    this.budget.setBucket(kind, { mode, value: 0 });
  }

  setValue(kind: BucketKind, value: number | null): void {
    if (!this.budget.setBucket(kind, { value: Number(value ?? 0) })) this.message.set(this.translate.instant('That value is not valid (a percentage goes from 0 to 100).'));
    else this.message.set('');
  }

  setManual(kind: BucketKind, value: number | null): void {
    this.budget.setManual(kind, this.monthKey, Number(value ?? 0));
  }

  // ----- moves

  // A computed, not a method: the select must not get brand-new option objects on every change detection
  moveOptions = computed<{ id: string; label: string }[]>(() => {
    if (this.moveType() === 'bucket') return this.kinds.map((k) => ({ id: k, label: BUCKET_LABELS[k] }));
    return this.budget.budgets().map((b) => ({ id: b.categoryId, label: this.categories.byId(b.categoryId)?.name ?? b.categoryId }));
  });

  setMoveType(type: 'bucket' | 'category'): void {
    this.moveType.set(type);
    this.moveFrom = '';
    this.moveTo = '';
  }

  move(): void {
    const from: MoveRef = { type: this.moveType(), id: this.moveFrom };
    const to: MoveRef = { type: this.moveType(), id: this.moveTo };
    const error = this.budget.moveMoney(from, to, Number(this.moveAmount));
    this.message.set(error ? this.translate.instant(MOVE_ERRORS[error]) : this.translate.instant('Money moved. You can undo it below.'));
    if (!error) this.moveAmount = null;
  }

  undo(id: string): void {
    this.message.set(this.translate.instant(this.budget.undoMove(id) ? 'Move undone.' : 'It could not be undone.'));
  }

  refName(ref: MoveRef): string {
    return ref.type === 'bucket' ? this.translate.instant(BUCKET_LABELS[ref.id as BucketKind] ?? ref.id) : this.categories.byId(ref.id)?.name ?? ref.id;
  }

  // ----- recommendations

  apply(kind: BucketKind, suggested: number | null): void {
    if (suggested === null) return;
    this.budget.setBucket(kind, { mode: 'amount', value: suggested });
    this.message.set(this.translate.instant('Applied. You can adjust it in Blocks.'));
  }

  toggleFormula(key: string): void {
    this.openFormula.set(this.openFormula() === key ? null : key);
  }

  // ----- comparison

  months(): string[] {
    return this.comparison().map((c) => c.month);
  }

  pickSpent(c: { rows: { kind: BucketKind; spent: number }[] }, kind: BucketKind): number {
    return c.rows.find((r) => r.kind === kind)?.spent ?? 0;
  }

  pick(key: string) {
    return this.comparison().find((c) => c.month === key);
  }

  // ----- trends

  trendRows = computed(() =>
    this.categories
      .expenseCategories()
      .map((c) => ({ category: c, ...this.budget.trendOf(c.id, 12) }))
      .filter((r) => r.series.length >= 2 && r.series.some((v) => v > 0))
      .sort((a, b) => Math.abs(b.trend.slope) - Math.abs(a.trend.slope))
      .slice(0, 8)
  );

  spark(series: number[]): string {
    const max = Math.max(1, ...series);
    const step = series.length > 1 ? 100 / (series.length - 1) : 0;
    return series.map((v, i) => `${Math.round(i * step)},${Math.round(28 - (v / max) * 26)}`).join(' ');
  }

  categoryName(id: string): string {
    return this.categories.byId(id)?.name ?? id;
  }

  back(): void {
    history.back();
  }
}
