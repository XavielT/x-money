import { Injectable, computed, signal } from '@angular/core';
import { BaseIncome, BucketKind, BudgetBucketModel, BudgetModel, BudgetMoveModel, MoveRef } from '../models/budget.model';
import {
  BUCKET_KINDS,
  BaseResult,
  BudgetRisk,
  DEFAULT_BUCKET_CATEGORIES,
  MoveError,
  MonthEndProjection,
  Recommendation,
  ReduceCandidate,
  adjustedLimit,
  baseIncome,
  bucketKindOf,
  bucketLimit,
  bucketSpent,
  budgetRisk,
  categorySeries,
  isManualBucket,
  monthEndProjection,
  monthTotals,
  recommend,
  reduceCandidates,
  trend,
  validateMove,
  variableRemaining,
  Trend,
} from '../domain/budget';
import { IrregularProjection, irregularProjection } from '../domain/irregular';
import { isCounted, spentInCategory } from '../domain/stats';
import { lastCompleteMonths, localIso } from '../domain/dates';
import { natureOfCategory } from '../domain/categories';
import { addMoney, round2, sumMoney } from '../utils/money';
import { AuditLogService } from './audit-log.service';
import { CategoryService } from './category.service';
import { FixedExpenseService } from './fixed-expense.service';
import { IncomeService } from './income.service';
import { NetWorthService } from './net-worth.service';
import { SettingsService } from './settings.service';
import { StorageService } from './storage.service';
import { TransactionService } from './transaction.service';

export interface CategoryBudgetRow {
  budget: BudgetModel;
  limit: number; // the monthly limit with what moved in or out this month
  spent: number;
  remaining: number;
  risk: BudgetRisk;
}

export interface BucketRow {
  bucket: BudgetBucketModel;
  limit: number;
  spent: number;
  remaining: number;
  risk: BudgetRisk;
}

export interface RiskAlert {
  kind: 'category' | 'bucket';
  id: string; // category id or bucket kind
  risk: BudgetRisk;
}

export interface Remaining {
  limit: number;
  spent: number;
  remaining: number;
  categories: CategoryBudgetRow[];
  buckets: BucketRow[];
}

// Budgets by category/subcategory (as always), plus distribution blocks, moves of money between
// them, risk of exceeding, a projection of the balance at the end of the month, history-based
// recommendations and trends. Real figures (spent, remaining) are facts; projections,
// recommendations and savings potential are estimates and come flagged as such.
@Injectable({ providedIn: 'root' })
export class BudgetService {
  private _budgets = signal<BudgetModel[]>([]);
  budgets = this._budgets.asReadonly();

  private _buckets = signal<BudgetBucketModel[]>([]);
  private _moves = signal<BudgetMoveModel[]>([]);
  moves = this._moves.asReadonly();

  // What the screens show: the saved blocks, or the default ones (no percentage is imposed: 0) until the user saves
  buckets = computed<BudgetBucketModel[]>(() => {
    const saved = this._buckets();
    return BUCKET_KINDS.map(
      (kind) => saved.find((b) => b.kind === kind) ?? { id: `bucket-${kind}`, kind, categoryIds: [...DEFAULT_BUCKET_CATEGORIES[kind]], mode: 'amount' as const, value: 0 }
    );
  });

  constructor(
    private storage: StorageService,
    private settings: SettingsService,
    private categories: CategoryService,
    private transactions: TransactionService,
    private income: IncomeService,
    private netWorth: NetWorthService,
    private fixed: FixedExpenseService,
    private audit: AuditLogService
  ) {
    this._budgets.set(this.storage.get<BudgetModel[]>('budgets', []));
    this._buckets.set(this.storage.get<BudgetBucketModel[]>('buckets', []));
    this._moves.set(this.storage.get<BudgetMoveModel[]>('budgetMoves', []));
    this.storage.watch('budgets', (v) => this._budgets.set((v as BudgetModel[] | undefined) ?? []));
    this.storage.watch('buckets', (v) => this._buckets.set((v as BudgetBucketModel[] | undefined) ?? []));
    this.storage.watch('budgetMoves', (v) => this._moves.set((v as BudgetMoveModel[] | undefined) ?? []));
  }

  today(): string {
    return localIso(this.transactions.clock());
  }

  private monthKey(): string {
    return this.today().slice(0, 7);
  }

  // ----- category budgets (kept as they were; subcategories use the same shape)

  byCategoryId(categoryId: string): BudgetModel | undefined {
    return this._budgets().find((b) => b.categoryId === categoryId);
  }

  // One budget per category or subcategory: creates it or updates the existing limit
  upsert(categoryId: string, monthlyLimit: number): void {
    const existing = this.byCategoryId(categoryId);
    if (existing) {
      this._budgets.update((list) => list.map((b) => (b.id === existing.id ? { ...b, monthlyLimit } : b)));
    } else {
      const budget: BudgetModel = { id: crypto.randomUUID(), categoryId, monthlyLimit };
      this._budgets.update((list) => [...list, budget]);
    }
    this.persist();
  }

  remove(id: string): void {
    this._budgets.update((list) => list.filter((b) => b.id !== id));
    this.persist();
  }

  // Counted RD$ expenses of one category/subcategory (the declared pattern, when it has one, drives its projection)
  private categoryTxs(categoryId: string) {
    return this.transactions.transactions().filter((t) => t.type === 'expense' && isCounted(t) && (t.currency ?? 'DOP') === 'DOP' && (t.categoryId === categoryId || t.subcategoryId === categoryId));
  }

  patternOf(categoryId: string, year: number, month: number): IrregularProjection | undefined {
    const pattern = this.categories.byId(categoryId)?.irregular;
    return pattern ? irregularProjection(this.categoryTxs(categoryId), pattern, this.today(), year, month) : undefined;
  }

  private monthTxs(year: number, month: number) {
    return this.transactions.forMonth(year, month);
  }

  categoryRows(year: number, month: number): CategoryBudgetRow[] {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const txs = this.monthTxs(year, month);
    return this._budgets().map((budget) => {
      const limit = adjustedLimit(budget.monthlyLimit, this._moves(), { type: 'category', id: budget.categoryId }, key);
      const spent = spentInCategory(txs, budget.categoryId);
      return { budget, limit, spent, remaining: round2(limit - spent), risk: budgetRisk(limit, spent, this.today(), year, month, this.settings.budget().riskAt, this.patternOf(budget.categoryId, year, month)) };
    });
  }

  // ----- blocks

  baseIncome = computed<BaseResult>(() => {
    const now = this.today();
    return baseIncome(this.settings.budget().base, {
      guaranteed: this.income.capacity().guaranteedMonthly,
      monthsAvailable: this.income.availableHistory(3),
      actual: this.income.monthBreakdown(Number(now.slice(0, 4)), Number(now.slice(5, 7))).available,
    });
  });

  private saveBucket(bucket: BudgetBucketModel): void {
    const rest = this._buckets().filter((b) => b.kind !== bucket.kind);
    this._buckets.set([...rest, bucket]);
    this.storage.set('buckets', this._buckets());
    this.audit.log({ type: 'bucket', entity: 'budget', entityId: bucket.id, after: { kind: bucket.kind, mode: bucket.mode, value: bucket.value } });
  }

  // Distribution of a block: a % of the base income or an amount, by the user's choice
  setBucket(kind: BucketKind, patch: Partial<Pick<BudgetBucketModel, 'mode' | 'value' | 'categoryIds'>>): boolean {
    if (this.storage.readOnly()) return false;
    const current = this.buckets().find((b) => b.kind === kind)!;
    const next = { ...current, ...patch };
    if (!Number.isFinite(next.value) || next.value < 0 || (next.mode === 'percent' && next.value > 100)) return false;
    this.saveBucket({ ...next, categoryIds: [...new Set(next.categoryIds)] });
    return true;
  }

  // Blocks fed by hand (savings, emergency, business capital, debts) until their modules connect
  setManual(kind: BucketKind, monthKey: string, amount: number): boolean {
    if (!isManualBucket(kind) || !Number.isFinite(amount) || amount < 0 || this.storage.readOnly()) return false;
    const current = this.buckets().find((b) => b.kind === kind)!;
    this.saveBucket({ ...current, manualByMonth: { ...(current.manualByMonth ?? {}), [monthKey]: round2(amount) } });
    return true;
  }

  // The sum of the percentages (a hint when it passes 100 %)
  percentTotal(): number {
    return sumMoney(this.buckets().filter((b) => b.mode === 'percent').map((b) => b.value));
  }

  bucketRows(year: number, month: number): BucketRow[] {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const totals = monthTotals(this.transactions.transactions(), key);
    const base = this.baseIncome().amount;
    const all = this.buckets();
    return all.map((bucket) => {
      const limit = adjustedLimit(bucketLimit(bucket, base), this._moves(), { type: 'bucket', id: bucket.kind }, key);
      const spent = bucketSpent(bucket, all, totals, key);
      return { bucket, limit, spent, remaining: round2(limit - spent), risk: budgetRisk(limit, spent, this.today(), year, month, this.settings.budget().riskAt) };
    });
  }

  // ----- moving money inside the month (audited, undoable)

  private limitOfRef(ref: MoveRef, key: string): number {
    if (ref.type === 'bucket') {
      const b = this.buckets().find((x) => x.kind === ref.id);
      return b ? adjustedLimit(bucketLimit(b, this.baseIncome().amount), this._moves(), ref, key) : 0;
    }
    const budget = this.byCategoryId(ref.id);
    return budget ? adjustedLimit(budget.monthlyLimit, this._moves(), ref, key) : 0;
  }

  moveMoney(from: MoveRef, to: MoveRef, amount: number, month = this.monthKey()): MoveError | null {
    if (this.storage.readOnly()) return 'amount';
    const error = validateMove(from, to, amount, this.limitOfRef(from, month), month);
    if (error) return error;
    // a category target must have a budget to receive the money
    if (to.type === 'category' && !this.byCategoryId(to.id)) return 'kind';
    const move: BudgetMoveModel = { id: crypto.randomUUID(), month, from, to, amount: round2(amount), createdAt: this.transactions.clock().toISOString() };
    this._moves.set([...this._moves(), move]);
    this.storage.set('budgetMoves', this._moves());
    this.audit.log({ type: 'budget-move', entity: 'budget', entityId: move.id, after: { month, from, to, amount: move.amount } });
    return null;
  }

  undoMove(id: string): boolean {
    const move = this._moves().find((m) => m.id === id);
    if (!move || move.undone || this.storage.readOnly()) return false;
    this._moves.set(this._moves().map((m) => (m.id === id ? { ...m, undone: true } : m)));
    this.storage.set('budgetMoves', this._moves());
    this.audit.log({ type: 'budget-move-undo', entity: 'budget', entityId: id, before: { month: move.month, from: move.from, to: move.to, amount: move.amount } });
    return true;
  }

  // ----- reads for the dashboard (05) and the later modules (06, 07, 08)

  // What is left of the budgets this month: real figures, not estimates
  remainingThisMonth(): Remaining {
    const year = Number(this.today().slice(0, 4));
    const month = Number(this.today().slice(5, 7));
    const categories = this.categoryRows(year, month);
    const buckets = this.bucketRows(year, month);
    const limit = sumMoney(categories.map((c) => c.limit));
    const spent = sumMoney(categories.map((c) => c.spent));
    return { limit, spent, remaining: round2(limit - spent), categories, buckets };
  }

  // Balance at the end of the month (ESTIMATE): liquid balance - fixed obligations still to pay -
  // variable spending still expected + guaranteed income still expected. It never includes
  // variable income or non-monetary benefits.
  endOfMonthProjection(): MonthEndProjection {
    const today = this.today();
    const txs = this.transactions.transactions();
    const patterns = new Map<string, IrregularProjection>();
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    for (const c of this.categories.categories()) {
      if (c.irregular && c.type === 'expense' && !c.parentId) {
        const p = this.patternOf(c.id, year, month);
        if (p) patterns.set(c.id, p);
      }
    }
    return monthEndProjection(this.netWorth.summary().liquid.DOP, this.fixed.summary().pendingThisMonth, variableRemaining(txs, this.categories.categories(), today, patterns), this.income.guaranteedExpectedRemaining());
  }

  // Categories and blocks that are over the limit or, at the current pace, will exceed it (ESTIMATE)
  risks(): RiskAlert[] {
    const year = Number(this.today().slice(0, 4));
    const month = Number(this.today().slice(5, 7));
    const out: RiskAlert[] = [];
    for (const r of this.categoryRows(year, month)) if (r.risk.status !== 'ok') out.push({ kind: 'category', id: r.budget.categoryId, risk: r.risk });
    for (const r of this.bucketRows(year, month)) if (r.limit > 0 && r.risk.status !== 'ok' && !isManualBucket(r.bucket.kind)) out.push({ kind: 'bucket', id: r.bucket.kind, risk: r.risk });
    return out;
  }

  // ----- recommendations, comparison, trends

  private monthsOfHistory = 6;

  // Spending of each block (and of fixed categories) over the last complete months
  private history(n: number) {
    const txs = this.transactions.transactions();
    const months = lastCompleteMonths(this.today(), n);
    const all = this.buckets();
    const byBucket = new Map<BucketKind, number[]>();
    const fixedHistory: number[] = [];
    // history only starts at the first month with data, so an empty past is not counted as zeros
    const firstMonth = txs.map((t) => t.date.slice(0, 7)).sort()[0];
    const usable = months.filter((m) => !!firstMonth && m >= firstMonth);
    for (const key of usable) {
      const totals = monthTotals(txs, key);
      let fixed = 0;
      for (const kind of BUCKET_KINDS) {
        if (isManualBucket(kind)) continue;
        let sum = 0;
        for (const [id, total] of totals) if (bucketKindOf(id, all) === kind) sum = addMoney(sum, total);
        byBucket.set(kind, [...(byBucket.get(kind) ?? []), sum]);
      }
      for (const [id, total] of totals) if (natureOfCategory(this.categories.byId(id)) === 'fixed') fixed = addMoney(fixed, total);
      fixedHistory.push(fixed);
    }
    return { byBucket, fixedHistory };
  }

  // "Recommendation based on your history": median of the last 3 to 6 months, never an imposed percentage
  recommendation(): Recommendation {
    const { byBucket, fixedHistory } = this.history(this.monthsOfHistory);
    return recommend(this.baseIncome().amount, byBucket, fixedHistory);
  }

  // Budget vs real per block over the last months; past months use the same distribution settings
  compare(months = 6) {
    const txs = this.transactions.transactions();
    const all = this.buckets();
    return lastCompleteMonths(this.today(), months).map((key) => {
      const totals = monthTotals(txs, key);
      const actualBase = this.income.monthBreakdown(Number(key.slice(0, 4)), Number(key.slice(5, 7))).available;
      const base = this.settings.budget().base === 'actual' ? actualBase : this.baseIncome().amount;
      return {
        month: key,
        rows: all.map((b) => ({ kind: b.kind, limit: adjustedLimit(bucketLimit(b, base), this._moves(), { type: 'bucket', id: b.kind }, key), spent: bucketSpent(b, all, totals, key) })),
      };
    });
  }

  trendOf(categoryId: string, months = 12): { series: number[]; trend: Trend } {
    const series = (categorySeries(this.transactions.transactions(), this.today(), months).get(categoryId) ?? new Array<number>(months).fill(0)).slice();
    // leave out the months before the first one with spending
    const first = series.findIndex((v) => v > 0);
    const used = first < 0 ? [] : series.slice(first);
    return { series: used, trend: trend(used) };
  }

  // Discretionary categories worth looking at, with the estimated saving (an ESTIMATE)
  reduce(): ReduceCandidate[] {
    const today = this.today();
    const series = categorySeries(this.transactions.transactions(), today, 6);
    const current = monthTotals(this.transactions.transactions(), today.slice(0, 7));
    const firstMonth = this.transactions.transactions().map((t) => t.date.slice(0, 7)).sort()[0];
    const monthsAvailable = lastCompleteMonths(today, 6).filter((m) => !!firstMonth && m >= firstMonth).length;
    const history = new Map<string, number[]>();
    for (const [id, values] of series) history.set(id, values.slice(6 - monthsAvailable));
    const limits = new Map(this._budgets().map((b) => [b.categoryId, b.monthlyLimit]));
    return reduceCandidates(this.categories.categories(), history, current, limits);
  }

  private persist(): void {
    this.storage.set('budgets', this._budgets());
  }
}
