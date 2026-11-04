import { Injectable, computed } from '@angular/core';
import { IncomeKind, IncomeSchedule, IncomeSourceModel } from '../models/income-source.model';
import { TransactionModel } from '../models/transaction.model';
import { Cadence, IncomePatternSuggestion } from '../domain/income-patterns';
import { lastCompleteMonths, lastDayOfMonth, localIso, weekdayOf } from '../domain/dates';
import { addMoney } from '../utils/money';
import {
  Averages,
  Expectation,
  IncomeCapacity,
  MonthBreakdown,
  SourceWeight,
  StabilityReport,
  averages,
  expectations,
  incomeCapacity,
  isIncomeTx,
  monthBreakdown,
  pendingConfirmations,
  sourceWeights,
  stability,
  upcomingExpectations,
} from '../domain/income';
import { TxResult } from '../domain/validation';
import { AccountService } from './account.service';
import { IncomeSourceService } from './income-source.service';
import { RecurringService } from './recurring.service';
import { SettingsService } from './settings.service';
import { TransactionService } from './transaction.service';

// The default category each kind of source uses when a movement is created for it
const CATEGORY_OF: Record<IncomeKind, string> = {
  payroll: 'cat-salary',
  'bonus-commission': 'cat-salary',
  freelance: 'cat-freelance',
  'commercial-sales': 'cat-business',
  'vehicle-trade': 'cat-business',
  'parts-accessories': 'cat-business',
  extraordinary: 'cat-other-income',
  custom: 'cat-other-income',
};

// Reads for the Income screen and for the modules that come later (dashboard 05, budgets 04,
// loans 08), plus the few actions on income. It never publishes income on its own: an expected
// income is only an expectation until the user confirms it.
@Injectable({ providedIn: 'root' })
export class IncomeService {
  sources: IncomeSourceService['sources'];

  private today(): string {
    return localIso(this.transactions.clock());
  }

  // ----- reads

  // What the other modules read for a month (available income = personal net + commercial net benefit)
  monthBreakdown(year: number, month: number): MonthBreakdown {
    return monthBreakdown(this.transactions.transactions(), this.incomeSources.sources(), year, month, this.today());
  }

  capacity = computed<IncomeCapacity>(() => incomeCapacity(this.incomeSources.sources(), this.transactions.transactions(), this.today()));

  incomeOf(sourceId: string): TransactionModel[] {
    return this.transactions.sorted().filter((t) => t.incomeSourceId === sourceId && isIncomeTx(t));
  }

  averagesOf(sourceId: string): Averages {
    return averages(this.incomeOf(sourceId), this.today());
  }

  totalAverages(): Averages {
    return averages(this.transactions.transactions().filter((t) => isIncomeTx(t) && !!this.incomeSources.byId(t.incomeSourceId)), this.today());
  }

  stabilityOf(source: IncomeSourceModel): StabilityReport {
    return stability(this.incomeOf(source.id), source.stability, this.today());
  }

  lastIncomeOf(sourceId: string): TransactionModel | undefined {
    return this.incomeOf(sourceId)[0];
  }

  // Share of each source in the last 12 months
  weights = computed<SourceWeight[]>(() => {
    const today = this.today();
    const from = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
    return sourceWeights(this.transactions.transactions(), from, today);
  });

  pending = computed<Expectation[]>(() => pendingConfirmations(this.incomeSources.active(), this.transactions.transactions(), this.today()));
  upcoming = computed<Expectation[]>(() => upcomingExpectations(this.incomeSources.active(), this.transactions.transactions(), this.today()));

  // Income that points to no (existing) source
  unclassified = computed<TransactionModel[]>(() => {
    const ids = new Set(this.incomeSources.sources().map((s) => s.id));
    return this.transactions.sorted().filter((t) => isIncomeTx(t) && (!t.incomeSourceId || !ids.has(t.incomeSourceId)));
  });

  // Recurring INCOME rules that exist since before sources: they keep working as they did
  incomeRules = computed(() => this.recurring.recurring().filter((r) => r.type === 'income'));

  constructor(
    private incomeSources: IncomeSourceService,
    private transactions: TransactionService,
    private accounts: AccountService,
    private recurring: RecurringService,
    private settings: SettingsService
  ) {
    this.sources = this.incomeSources.sources; // not in the initializer: parameter properties are not assigned yet there
  }

  categoryFor(kind: IncomeKind): string {
    return CATEGORY_OF[kind];
  }

  // Guaranteed income still expected before the end of this month: only recurring + documented
  // sources, only expectations that have not been reached yet. Never variable income.
  guaranteedExpectedRemaining(): number {
    const today = this.today();
    const monthEnd = `${today.slice(0, 7)}-${String(lastDayOfMonth(Number(today.slice(0, 4)), Number(today.slice(5, 7)))).padStart(2, '0')}`;
    const ids = new Set(this.capacity().guaranteedSources);
    let total = 0;
    for (const e of this.upcomingBetween(today, monthEnd)) if (ids.has(e.sourceId)) total = addMoney(total, this.incomeSources.byId(e.sourceId)?.expectedNet ?? 0);
    return total;
  }

  private upcomingBetween(from: string, to: string): Expectation[] {
    const out: Expectation[] = [];
    for (const s of this.incomeSources.active()) out.push(...expectations(s, this.transactions.transactions(), from, to, this.today()).filter((e) => e.status === 'upcoming'));
    return out;
  }

  // Available income (personal net + commercial net benefit) of each of the last complete months
  availableHistory(months: number): number[] {
    return lastCompleteMonths(this.today(), months).map((key) => this.monthBreakdown(Number(key.slice(0, 4)), Number(key.slice(5, 7))).available);
  }

  // ----- actions

  // "Did it arrive?" -> yes: creates the movement with the source's expected figures. Without
  // an expected net amount there is nothing to preload, so the caller opens the form instead.
  confirm(sourceId: string, date: string, amount?: number): TxResult {
    const s = this.incomeSources.byId(sourceId);
    const value = amount ?? s?.expectedNet;
    if (!s || !value || !(value > 0)) return { ok: false, error: 'amount' };
    const accountId = s.defaultAccountId ?? this.accounts.activeAccounts().find((a) => (s.method === 'cash' ? a.type === 'cash' : a.type === 'bank'))?.id;
    if (!accountId) return { ok: false, error: 'account' };
    const result = this.transactions.add({
      type: 'income',
      amount: value,
      accountId,
      categoryId: CATEGORY_OF[s.kind],
      date,
      incomeSourceId: s.id,
      grossAmount: amount === undefined ? s.expectedGross : undefined,
      origin: 'manual',
    });
    return result;
  }

  skip(sourceId: string, date: string): void {
    this.incomeSources.skipDate(sourceId, date);
  }

  // Bulk review of unclassified income
  assign(txIds: readonly string[], sourceId: string | undefined): number {
    return this.transactions.tagIncomeSource(txIds, sourceId);
  }

  // An old recurring income rule keeps posting as before; this only labels what it posts from now on
  linkRule(ruleId: string, sourceId: string | undefined): void {
    this.recurring.setIncomeSource(ruleId, sourceId);
  }

  // A recurring-income suggestion (01) -> a source, with one tap. Nothing is assumed beyond what
  // the data shows: it is "declared" (not documented) until the user says otherwise.
  createFromPattern(s: IncomePatternSuggestion): TxResult {
    const last = s.lastDate;
    const cadence: Cadence = s.cadence;
    const schedule: IncomeSchedule =
      cadence === 'weekly'
        ? { mode: 'weekly', weekday: weekdayOf(last) }
        : cadence === 'biweekly'
          ? { mode: 'month-days', days: [15, 30] }
          : { mode: 'month-days', days: [Number(last.slice(8, 10))] };
    const account = this.accounts.byId(s.accountId);
    const added = this.incomeSources.add({
      name: this.pendingName(account?.name),
      kind: 'payroll',
      icon: '💼',
      color: '#42a5f5',
      active: true,
      stability: 'recurring',
      schedule,
      method: 'transfer',
      defaultAccountId: s.accountId,
      verifiability: 'declared',
      expectedNet: s.amount,
    });
    if (!added.ok) return { ok: false, error: 'amount' };
    this.transactions.tagIncomeSource(s.txIds, added.id);
    this.settings.confirmIncomeSuggestion(s.key);
    return { ok: true, id: added.id };
  }

  private pendingName(account: string | undefined): string {
    return account ? `Income · ${account}` : 'Income';
  }
}
