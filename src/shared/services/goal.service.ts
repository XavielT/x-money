import { Injectable, computed, signal } from '@angular/core';
import { GoalEntry, GoalKind, GoalModel, GoalPlan, GoalStatus } from '../models/goal.model';
import {
  EmergencyFund,
  GoalError,
  GoalTotals,
  MarginInput,
  Progress,
  Projection,
  Reminder,
  ViabilityResult,
  activeEntries,
  dueReminders,
  effectiveStatus,
  emergencyBase,
  emergencyFund,
  goalTotals,
  monthContributions,
  progressOf,
  projectGoal,
  reservedOf,
  validateEntry,
  validateGoal,
  viability,
} from '../domain/goals';
import { minimumPayment } from '../domain/cards';
import { ExternalFigures } from '../domain/dashboard';
import { localIso } from '../domain/dates';
import { addMoney, round2, sumMoney } from '../utils/money';
import { AccountService } from './account.service';
import { AuditLogService } from './audit-log.service';
import { BudgetService } from './budget.service';
import { BusinessService, NewOperation } from './business.service';
import { CreditCardService } from './credit-card.service';
import { FixedExpenseService } from './fixed-expense.service';
import { IncomeService } from './income.service';
import { LoanService } from './loan.service';
import { StorageService } from './storage.service';
import { TransactionService } from './transaction.service';

export type GoalResult = { ok: true; id: string } | { ok: false; error: string };
const fail = (error: string): GoalResult => ({ ok: false, error });
const ok = (id: string): GoalResult => ({ ok: true, id });

export interface NewGoal {
  name: string;
  kind: GoalKind;
  customKind?: string;
  target: number;
  targetDate?: string;
  plan?: GoalPlan;
  accountId?: string;
  emergencyMonths?: number;
}

// Goals are VIRTUAL SET-ASIDES: a contribution moves no money between accounts and changes no
// balance; it lowers "available money" and counts as reserved. An associated account is only
// shown. Personal savings, reserved commercial capital ("capital para emprendimiento") and
// capital invested in inventory are three separate figures that never add the same peso twice.
@Injectable({ providedIn: 'root' })
export class GoalService {
  private _goals = signal<GoalModel[]>([]);
  goals = this._goals.asReadonly();

  constructor(
    private storage: StorageService,
    private transactions: TransactionService,
    private accounts: AccountService,
    private audit: AuditLogService,
    private business: BusinessService,
    private budget: BudgetService,
    private income: IncomeService,
    private fixed: FixedExpenseService,
    private cards: CreditCardService,
    private loans: LoanService
  ) {
    this._goals.set(this.storage.get<GoalModel[]>('goals', []));
    this.storage.watch('goals', (v) => this._goals.set((v as GoalModel[] | undefined) ?? []));
  }

  today(): string {
    return localIso(this.transactions.clock());
  }

  byId(id: string): GoalModel | undefined {
    return this._goals().find((g) => g.id === id);
  }

  // ----- reads

  reminders = computed<Reminder[]>(() => dueReminders(this._goals(), this.today()));

  totals = computed<GoalTotals>(() => goalTotals(this._goals(), (id) => this.accounts.byId(id)?.type === 'savings'));

  progress(g: GoalModel): Progress {
    return progressOf(g);
  }

  status(g: GoalModel): GoalStatus {
    return effectiveStatus(g);
  }

  projection(g: GoalModel): Projection {
    return projectGoal(g, this.today());
  }

  // Minimum payments of the credit cards (RD$) for the month: an estimate from each card's rule
  debtPayments(): number {
    return addMoney(sumMoney(this.cards.cards().map((c) => minimumPayment(this.cards.debtOf(c, 'DOP').owed, c.card, 'DOP'))), this.loans.monthlyPayments());
  }

  // Monthly margin: guaranteed income - fixed obligations - median of variable spending - debt payments
  margin = computed<MarginInput>(() => ({
    guaranteedIncome: this.income.capacity().guaranteedMonthly,
    fixed: this.fixed.summary().monthly,
    variableMedian: this.budget.variableMedian(),
    debtPayments: this.debtPayments(),
  }));

  viabilityOf(g: GoalModel): ViabilityResult {
    return viability(g, this.today(), this.margin());
  }

  emergencyOf(g: GoalModel): EmergencyFund {
    const base = emergencyBase(this.budget.essentialHistory(), this.fixed.summary().monthly, this.debtPayments());
    return emergencyFund(g.emergencyMonths ?? 3, base, reservedOf(g), g.target);
  }

  // Reserved as of a date, for goals that are not inside a savings account (the savings history uses it)
  reservedOutsideAt(date: string): number {
    return sumMoney(
      this._goals()
        .filter((g) => g.status !== 'archived' && g.currency === 'DOP' && g.kind !== 'business-capital' && !(g.accountId && this.accounts.byId(g.accountId)?.type === 'savings'))
        .map((g) => Math.max(0, reservedOf(g, date)))
    );
  }

  // What the dashboard reads: reserved money lowers "available money"; goal money that is not in a
  // savings account adds to "accumulated savings"; commercial capital is shown apart
  dashboardFigures = computed<ExternalFigures>(() => {
    const live = this._goals().filter((g) => g.status !== 'archived');
    if (!live.length) return {};
    const t = this.totals();
    return {
      goalsReserved: { value: round2(t.personal + t.commercial) },
      goalsSaved: {
        value: t.outsideSavingsAccounts,
        components: [
          { label: 'Goal contributions outside savings accounts', amount: t.outsideSavingsAccounts, kind: 'data' },
          { label: 'Reserved commercial capital (apart, not added)', amount: t.commercial, kind: 'excluded', note: 'Business capital is never mixed with personal savings (rule 6).' },
        ],
      },
    };
  });

  // Contributed this month to the savings and emergency blocks of the budget
  monthContributions(year: number, month: number) {
    return monthContributions(this._goals(), `${year}-${String(month).padStart(2, '0')}`);
  }

  // ----- writes

  private save(list: GoalModel[]): void {
    this._goals.set(list);
    this.storage.set('goals', list);
  }

  private replace(g: GoalModel): void {
    this.save(this._goals().map((x) => (x.id === g.id ? g : x)));
  }

  private checkAccount(accountId: string | undefined): boolean {
    return !accountId || !!this.accounts.byId(accountId);
  }

  add(input: NewGoal): GoalResult {
    if (this.storage.readOnly()) return fail('read-only');
    const error: GoalError | null = validateGoal({ ...input, currency: 'DOP' });
    if (error) return fail(error);
    if (!this.checkAccount(input.accountId)) return fail('account');
    if (input.kind === 'custom' && !input.customKind?.trim()) return fail('kind');
    const g: GoalModel = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      kind: input.kind,
      customKind: input.kind === 'custom' ? input.customKind?.trim() : undefined,
      target: round2(input.target),
      targetDate: input.targetDate || undefined,
      currency: 'DOP',
      plan: input.plan,
      accountId: input.accountId || undefined,
      status: 'active',
      emergencyMonths: input.kind === 'emergency' ? input.emergencyMonths ?? 3 : undefined,
      entries: [],
      createdAt: this.transactions.clock().toISOString(),
    };
    this.save([...this._goals(), g]);
    this.audit.log({ type: 'goal', entity: 'goal', entityId: g.id, after: { name: g.name, kind: g.kind, target: g.target } });
    return ok(g.id);
  }

  update(id: string, patch: Partial<Pick<GoalModel, 'name' | 'target' | 'targetDate' | 'plan' | 'accountId' | 'emergencyMonths' | 'customKind'>>): GoalResult {
    if (this.storage.readOnly()) return fail('read-only');
    const g = this.byId(id);
    if (!g) return fail('not-found');
    const next = { ...g, ...patch };
    const error = validateGoal({ name: next.name, target: next.target, targetDate: next.targetDate, plan: next.plan, emergencyMonths: next.emergencyMonths, currency: next.currency });
    if (error) return fail(error);
    if (!this.checkAccount(next.accountId)) return fail('account');
    this.replace({ ...next, name: next.name.trim(), target: round2(next.target) });
    this.audit.log({ type: 'goal', entity: 'goal', entityId: id, before: { name: g.name, target: g.target, targetDate: g.targetDate }, after: { name: next.name, target: next.target, targetDate: next.targetDate } });
    return ok(id);
  }

  setStatus(id: string, status: GoalStatus): GoalResult {
    if (this.storage.readOnly()) return fail('read-only');
    const g = this.byId(id);
    if (!g) return fail('not-found');
    this.replace({ ...g, status });
    this.audit.log({ type: 'goal', entity: 'goal', entityId: id, before: { status: g.status }, after: { status } });
    return ok(id);
  }

  // Accept the recalculated emergency target (the app never changes it silently)
  acceptEmergencyTarget(id: string): GoalResult {
    const g = this.byId(id);
    if (!g || g.kind !== 'emergency') return fail('not-found');
    return this.update(id, { target: this.emergencyOf(g).target });
  }

  // A contribution or a withdrawal is a note on the goal: no account moves
  addEntry(id: string, input: { type: GoalEntry['type']; amount: number; date: string; note?: string }): GoalResult {
    if (this.storage.readOnly()) return fail('read-only');
    const g = this.byId(id);
    if (!g) return fail('not-found');
    const error = validateEntry(g, input.type, input.amount, input.date);
    if (error) return fail(error);
    const entry: GoalEntry = { id: crypto.randomUUID(), date: input.date, type: input.type, amount: round2(input.amount), note: input.note?.trim() || undefined };
    this.replace({ ...g, entries: [entry, ...g.entries] });
    this.audit.log({ type: 'goal-entry', entity: 'goal', entityId: id, after: { type: entry.type, amount: entry.amount, date: entry.date } });
    return ok(entry.id);
  }

  // Reversing keeps the entry in the history; its money stops counting
  reverseEntry(id: string, entryId: string): GoalResult {
    if (this.storage.readOnly()) return fail('read-only');
    const g = this.byId(id);
    const e = g?.entries.find((x) => x.id === entryId);
    if (!g || !e || e.reversed) return fail('not-found');
    // reversing a contribution must not leave a withdrawal without money behind it
    const without: GoalModel = { ...g, entries: g.entries.map((x) => (x.id === entryId ? { ...x, reversed: true } : x)) };
    if (reservedOf(without) < 0) return fail('exceeds');
    this.replace(without);
    this.audit.log({ type: 'goal-entry', entity: 'goal', entityId: id, before: { type: e.type, amount: e.amount, date: e.date }, after: { reversed: true } });
    return ok(entryId);
  }

  // "Not this time": the reminder stops asking for that date
  skipReminder(id: string, date: string): void {
    const g = this.byId(id);
    if (!g || this.storage.readOnly()) return;
    this.replace({ ...g, skippedDates: [...(g.skippedDates ?? []), date].slice(-60) });
  }

  // Confirms the reminder: records the planned contribution (the user tapped; nothing is automatic)
  confirmReminder(r: Reminder): GoalResult {
    const g = this.byId(r.goalId);
    if (!g?.plan) return fail('not-found');
    return this.addEntry(g.id, { type: 'contribution', amount: g.plan.amount, date: this.today(), note: 'Planned contribution' });
  }

  // "Use for inventory": takes the money out of the goal and creates the purchase of the business
  // module (ONE movement: the purchase). The goal only loses the reserve; nothing is duplicated, and
  // the same money is never at once savings and invested capital.
  useForInventory(id: string, op: NewOperation): GoalResult {
    if (this.storage.readOnly()) return fail('read-only');
    const g = this.byId(id);
    if (!g) return fail('not-found');
    if (g.kind !== 'business-capital') return fail('kind');
    const check = validateEntry(g, 'withdrawal', op.totalCost, op.acquiredAt);
    if (check) return fail(check); // not enough reserved: nothing is bought
    const bought = this.business.addOperation(op);
    if (!bought.ok) return fail(bought.error);
    const entry: GoalEntry = { id: crypto.randomUUID(), date: op.acquiredAt, type: 'withdrawal', amount: round2(op.totalCost), note: op.name.trim(), businessOperationId: bought.id };
    this.replace({ ...g, entries: [entry, ...g.entries] });
    this.audit.log({ type: 'goal-entry', entity: 'goal', entityId: id, after: { type: 'withdrawal', amount: entry.amount, businessOperationId: bought.id }, origin: 'use-for-inventory' });
    return ok(bought.id);
  }

  activeCount = computed(() => this._goals().filter((g) => g.status !== 'archived').length);

  entriesOf(g: GoalModel): GoalEntry[] {
    return activeEntries(g);
  }
}
