import { Injectable, computed, signal } from '@angular/core';
import { InsightSettings, InsightStateModel, RuleSetting } from '../models/insight.model';
import { addDays, lastCompleteMonths, localIso } from '../domain/dates';
import { occurrencesUntil } from '../domain/fixed';
import { Commitment, DuplicateCandidate, DebtSustainability, detectBudgetAdjustments, detectCommitments, detectDeclaredVsReceived, detectDuplicates, detectLowSavings, detectReservable, detectSmallExpenses, detectUnusualIncrease, detectVariableDependence, findDuplicateCandidates, newDebtSustainability } from '../domain/insights/detectors';
import { DEFAULT_INSIGHT_SETTINGS, RULES, RuleDef, isVisible, rank, ruleSetting, stateIdOf } from '../domain/insights/engine';
import { cashflowEstimates, goalEstimate, monthEndEstimate, ProjectionEntry } from '../domain/insights/projections';
import { DetectorResult, Insight, RuleId } from '../domain/insights/types';
import { median } from '../domain/budget';
import { BucketKind } from '../models/budget.model';
import { quantile } from '../domain/dashboard';
import { LoanInput, quoteLoan } from '../domain/loans';
import { AccountService } from './account.service';
import { BorrowingService } from './borrowing.service';
import { BudgetService } from './budget.service';
import { CategoryService } from './category.service';
import { CreditCardService } from './credit-card.service';
import { DashboardService } from './dashboard.service';
import { FixedExpenseService } from './fixed-expense.service';
import { GoalService } from './goal.service';
import { IncomeService } from './income.service';
import { LoanService } from './loan.service';
import { NetWorthService } from './net-worth.service';
import { SettingsService } from './settings.service';
import { StorageService } from './storage.service';
import { TransactionService } from './transaction.service';
import { TranslateService } from './translate.service';

// The smart alerts: runs the deterministic detectors on demand (nothing runs until a screen reads
// it, and the results are memoized by the signals they read, so they recompute only when the data
// or the settings change, never when an insight is dismissed). No network, no AI.
@Injectable({ providedIn: 'root' })
export class SmartInsightService {
  private _settings = signal<InsightSettings>(DEFAULT_INSIGHT_SETTINGS);
  private _states = signal<InsightStateModel[]>([]);
  settings = this._settings.asReadonly();
  states = this._states.asReadonly();

  constructor(
    private storage: StorageService,
    private transactions: TransactionService,
    private categories: CategoryService,
    private accounts: AccountService,
    private income: IncomeService,
    private fixed: FixedExpenseService,
    private budget: BudgetService,
    private cards: CreditCardService,
    private loans: LoanService,
    private borrowing: BorrowingService,
    private netWorth: NetWorthService,
    private goals: GoalService,
    private dashboard: DashboardService,
    private appSettings: SettingsService,
    private translate: TranslateService
  ) {
    this._settings.set(this.readSettings(this.storage.get<InsightSettings>('insightSettings', DEFAULT_INSIGHT_SETTINGS)));
    this._states.set(this.storage.get<InsightStateModel[]>('insightStates', []));
    this.storage.watch('insightSettings', (v) => this._settings.set(this.readSettings((v as InsightSettings | undefined) ?? DEFAULT_INSIGHT_SETTINGS)));
    this.storage.watch('insightStates', (v) => this._states.set((v as InsightStateModel[] | undefined) ?? []));
  }

  private readSettings(saved: InsightSettings): InsightSettings {
    return { rules: { ...(saved?.rules ?? {}) } };
  }

  today(): string {
    return localIso(this.transactions.clock());
  }

  // ----- inputs (built once per change of the data)

  private catLite = computed(() => this.categories.categories().map((c) => ({ id: c.id, name: c.name, parentId: c.parentId })));
  private accLite = computed(() => this.accounts.accounts().map((a) => ({ id: a.id, name: a.name, type: a.type as string })));

  // Complete months from the first one with movements, up to `n`
  private monthsWithData(n: number): string[] {
    let first = '';
    for (const t of this.transactions.transactions()) if (!first || t.date < first) first = t.date;
    return lastCompleteMonths(this.today(), n).filter((m) => !!first && m >= first.slice(0, 7));
  }

  private incomeMonths(months: readonly string[]) {
    return months.map((month) => {
      const b = this.income.monthBreakdown(Number(month.slice(0, 4)), Number(month.slice(5, 7)));
      return { month, available: b.available, unclassified: b.unclassified };
    });
  }

  // Cards, loan installments and fixed expenses with a due date up to 30 days from now
  commitments = computed<Commitment[]>(() => {
    const today = this.today();
    const horizon = addDays(today, 30);
    const list: Commitment[] = [];
    for (const s of this.cards.statements()) {
      if (s.currency !== 'DOP' || s.dueDate > horizon) continue;
      const amount = this.cards.remainingOf(s);
      if (amount > 0) list.push({ date: s.dueDate, amount, kind: 'card', label: this.accounts.byId(s.accountId)?.name ?? '' });
    }
    for (const d of this.loans.dueBetween(today, horizon)) list.push({ date: d.date, amount: d.amount, kind: 'loan', label: this.loans.byId(d.loanId)?.name ?? '' });
    for (const r of this.fixed.rules()) for (const date of occurrencesUntil(r, horizon)) if (date >= today) list.push({ date, amount: r.amount, kind: 'fixed', label: r.note || this.categories.byId(r.categoryId ?? '')?.name || '' });
    return list;
  });

  // ----- the detectors

  private run(rule: RuleDef): DetectorResult | null {
    const t = ruleSetting(this._settings(), rule.id);
    if (!t.enabled) return null;
    const today = this.today();
    const txs = this.transactions.transactions();
    const th = t.thresholds;
    switch (rule.id) {
      case 'small-expenses':
        return detectSmallExpenses({ today, txs, categories: this.catLite(), accounts: this.accLite(), ceiling: this.appSettings.antMax() }, th);
      case 'unusual-increase':
        return detectUnusualIncrease({ today, txs, categories: this.catLite() }, th);
      case 'low-savings': {
        const months = this.monthsWithData(24);
        const income = this.incomeMonths(months);
        return detectLowSavings(
          { today, months: income.map((m) => ({ month: m.month, available: m.available, expense: this.transactions.monthSummary(Number(m.month.slice(0, 4)), Number(m.month.slice(5, 7))).expense })) },
          th
        );
      }
      case 'budget-adjust': {
        const year = Number(today.slice(0, 4));
        const month = Number(today.slice(5, 7));
        const limits: Partial<Record<BucketKind, number>> = {};
        for (const r of this.budget.bucketRows(year, month)) limits[r.bucket.kind] = r.limit;
        return detectBudgetAdjustments({ rec: this.budget.recommendation(), limits }, th);
      }
      case 'reservable': {
        const history = this.budget.variableHistory();
        const sorted = [...history].sort((a, b) => a - b);
        return detectReservable(
          { guaranteed: this.income.capacity().guaranteedMonthly, fixed: this.fixed.summary().monthly, variableMedian: median(history), variableHigh: quantile(sorted, 0.75), debt: this.borrowing.obligations().debts, variableMonths: this.budget.variableHistoryMonths() },
          th
        );
      }
      case 'variable-dependence':
        return detectVariableDependence({ txs, sources: this.income.sources(), months: this.incomeMonths(this.monthsWithData(6)) }, th);
      case 'declared-vs-received':
        return detectDeclaredVsReceived({ today, txs, sources: this.income.sources() }, th);
      case 'duplicates':
        return detectDuplicates({ today, txs, accounts: this.accLite() }, th);
      case 'commitments':
        return detectCommitments(
          {
            today,
            liquid: this.netWorth.summary().liquid.DOP,
            commitments: this.commitments(),
            cuts: this.cards.alerts().filter((a) => a.stage === 'cut-3' || a.stage === 'cut-today').map((a) => ({ date: a.date, label: `${this.accounts.byId(a.accountId)?.name ?? ''} · ${this.translate.instant('Cut date')}` })),
          },
          th
        );
    }
  }

  // Every enabled detector once per change of the data or the settings
  results = computed<DetectorResult[]>(() => RULES.map((r) => this.run(r)).filter((r): r is DetectorResult => r !== null));

  // What each detector could not do for lack of history (it never fabricates a result)
  insufficient = computed(() => this.results().filter((r) => r.status === 'insufficient-history'));

  all = computed<Insight[]>(() => rank(this.results().flatMap((r) => r.insights)));

  // ----- dismiss and snooze: the state belongs to the evidence it was about

  private stateOf(insight: Insight): InsightStateModel | undefined {
    const id = stateIdOf(insight.id);
    return this._states().find((s) => s.id === id);
  }

  visible = computed<Insight[]>(() => {
    const today = this.today();
    return this.all().filter((i) => isVisible(i, this.stateOf(i), today));
  });

  hidden = computed<Insight[]>(() => {
    const today = this.today();
    return this.all().filter((i) => !isVisible(i, this.stateOf(i), today));
  });

  top = computed<Insight[]>(() => this.visible().slice(0, 3));
  critical = computed<Insight[]>(() => this.visible().filter((i) => i.critical));

  private saveState(s: InsightStateModel): void {
    if (this.storage.readOnly()) return;
    const next = [...this._states().filter((x) => x.id !== s.id), s];
    this._states.set(next);
    this.storage.set('insightStates', next);
  }

  dismiss(insight: Insight): void {
    this.saveState({ id: stateIdOf(insight.id), insightId: insight.id, status: 'dismissed', fingerprint: insight.fingerprint, at: this.transactions.clock().toISOString() });
  }

  snooze(insight: Insight, days: number): void {
    this.saveState({ id: stateIdOf(insight.id), insightId: insight.id, status: 'snoozed', fingerprint: insight.fingerprint, until: addDays(this.today(), days), at: this.transactions.clock().toISOString() });
  }

  restore(insight: Insight): void {
    if (this.storage.readOnly()) return;
    const id = stateIdOf(insight.id);
    const next = this._states().filter((x) => x.id !== id);
    this._states.set(next);
    this.storage.set('insightStates', next);
  }

  // ----- settings ("Smart alerts" in Settings)

  ruleSetting(id: RuleId): RuleSetting {
    return ruleSetting(this._settings(), id);
  }

  setRule(id: RuleId, patch: Partial<RuleSetting>): void {
    if (this.storage.readOnly()) return;
    const current = this.ruleSetting(id);
    const next: InsightSettings = { rules: { ...this._settings().rules, [id]: { enabled: patch.enabled ?? current.enabled, thresholds: { ...current.thresholds, ...(patch.thresholds ?? {}) } } } };
    this._settings.set(next);
    this.storage.set('insightSettings', next);
  }

  // ----- projections: one registry, every entry an Estimate (rule 10)

  projections = computed<ProjectionEntry[]>(() => {
    const list: ProjectionEntry[] = [];
    list.push({ id: 'month-end', kind: 'month-end', labelKey: 'Balance at the end of the month', estimate: monthEndEstimate(this.budget.endOfMonthProjection()) });
    const main = this.dashboard.cashflow();
    const without = this.appSettings.dashboard().includeVariableIncome ? this.dashboard.buildCashflow(false) : main;
    list.push(...cashflowEstimates(main, without));
    for (const g of this.goals.goals()) {
      if (g.status === 'archived' || g.status === 'achieved') continue;
      list.push({ id: `goal-${g.id}`, kind: 'goal', labelKey: 'Goal completion', subject: g.name, estimate: goalEstimate(this.goals.projection(g)) });
    }
    return list;
  });

  // ----- on demand

  // For the loan simulator: sustainability of a new debt with a stress test of the variable income
  debtSustainability(input: LoanInput): DebtSustainability {
    const q = quoteLoan(input);
    const monthly = q.error ? 0 : this.borrowing.evaluate(q.totals.installment, input.frequency).installment;
    return newDebtSustainability({ tiers: this.borrowing.tiers(), settings: this.loans.settings(), obligations: this.borrowing.obligations(), installmentMonthly: monthly, liquid: this.netWorth.summary().liquid.DOP });
  }

  // Duplicate candidates for the screens and for the assistant of a later prompt
  duplicateCandidates = computed<DuplicateCandidate[]>(() => findDuplicateCandidates(this.transactions.transactions(), this.today(), ruleSetting(this._settings(), 'duplicates').thresholds['minScore']));

  // ----- text

  text(insight: Insight): { title: string; message: string } {
    const params = { ...insight.params };
    for (const k of insight.translateParams ?? []) if (params[k]) params[k] = this.translate.instant(params[k]);
    return { title: this.translate.instant(insight.titleKey), message: this.translate.instant(insight.messageKey, params) };
  }

}
