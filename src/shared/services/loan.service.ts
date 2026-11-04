import { Injectable, computed, signal } from '@angular/core';
import { DEFAULT_LOAN_SETTINGS, LoanModel, LoanPayment, LoanPaymentKind, LoanSettings, LoanSimulationModel } from '../models/loan.model';
import { ExternalFigures } from '../domain/dashboard';
import { localIso } from '../domain/dates';
import { LoanAlert, PayError, allocate, installmentsDue, loanAlerts, monthlyInstallments, nextInstallment, outstanding, paidOfInstallment, remainingOfInstallment, reschedule } from '../domain/loan-ops';
import { Adjustments, LoanError, LoanInput, LoanQuote, quoteLoan, upfrontOf } from '../domain/loans';
import { addMoney, round2, sumMoney } from '../utils/money';
import { AccountService } from './account.service';
import { AuditLogService } from './audit-log.service';
import { StorageService } from './storage.service';
import { TransactionService } from './transaction.service';

export type LoanResult = { ok: true; id: string } | { ok: false; error: LoanError | PayError | 'read-only' | 'name' | 'account' | 'not-found' | 'amount' | 'write' };
const fail = (error: Extract<LoanResult, { ok: false }>['error']): LoanResult => ({ ok: false, error });
const ok = (id: string): LoanResult => ({ ok: true, id });

export interface NewLoan {
  input: LoanInput;
  name: string;
  lender?: string;
  disbursementAccountId: string;
  payAccountId: string;
  disbursementDate: string;
}

const PRINCIPAL_CATEGORY = 'cat-loan-principal';
const INTEREST_CATEGORY = 'cat-loan-interest';
const DISBURSEMENT_CATEGORY = 'cat-loan-disbursement';

// Registered loans, in RD$. The disbursement is a real movement that is NOT income; every payment
// splits into principal (not an expense) and interest and charges (an expense). What is owed is
// never stored: it is derived (domain/loan-ops). The schedule changes only through an extra payment
// and the old one is kept inside that payment so a reversal can restore it.
@Injectable({ providedIn: 'root' })
export class LoanService {
  private _loans = signal<LoanModel[]>([]);
  private _simulations = signal<LoanSimulationModel[]>([]);
  private _settings = signal<LoanSettings>(DEFAULT_LOAN_SETTINGS);
  loans = this._loans.asReadonly();
  simulations = this._simulations.asReadonly();
  settings = this._settings.asReadonly();

  constructor(
    private storage: StorageService,
    private transactions: TransactionService,
    private accounts: AccountService,
    private audit: AuditLogService
  ) {
    this._loans.set(this.storage.get<LoanModel[]>('loans', []));
    this._simulations.set(this.storage.get<LoanSimulationModel[]>('loanSimulations', []));
    this._settings.set(this.readSettings(this.storage.get<Partial<LoanSettings>>('loanSettings', {})));
    this.storage.watch('loans', (v) => this._loans.set((v as LoanModel[] | undefined) ?? []));
    this.storage.watch('loanSimulations', (v) => this._simulations.set((v as LoanSimulationModel[] | undefined) ?? []));
    this.storage.watch('loanSettings', (v) => this._settings.set(this.readSettings((v as Partial<LoanSettings> | undefined) ?? {})));
  }

  private readSettings(saved: Partial<LoanSettings>): LoanSettings {
    return { ...DEFAULT_LOAN_SETTINGS, ...saved, switches: { ...DEFAULT_LOAN_SETTINGS.switches, ...(saved.switches ?? {}) } };
  }

  today(): string {
    return localIso(this.transactions.clock());
  }

  byId(id: string): LoanModel | undefined {
    return this._loans().find((l) => l.id === id);
  }

  active = computed(() => this._loans().filter((l) => l.status === 'active'));

  owed(l: LoanModel): number {
    return outstanding(l);
  }

  // What is owed on loans (RD$)
  totalOwed = computed(() => sumMoney(this._loans().map((l) => outstanding(l))));

  next(l: LoanModel) {
    return nextInstallment(l);
  }

  remaining(l: LoanModel, n: number): number {
    const row = l.schedule.find((r) => r.n === n);
    return row ? remainingOfInstallment(l, row) : 0;
  }

  alerts = computed<LoanAlert[]>(() => loanAlerts(this._loans(), this.today()));

  // Estimated monthly weight of the installments of the active loans (debt payments of the capacity, the emergency fund)
  monthlyPayments = computed(() => monthlyInstallments(this._loans()));

  // Installments that fall due in the next days (overdue ones count as due today): the cash flow and available money read it
  dueBetween(from: string, to: string): { date: string; amount: number; loanId: string }[] {
    return installmentsDue(this._loans(), from, to);
  }

  // Cash paid on loans in a month (the budget block "Debt payments" reads it)
  paymentsInMonth(year: number, month: number): number {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    return sumMoney(this._loans().flatMap((l) => l.payments.filter((p) => !p.reversed && p.date.startsWith(prefix)).map((p) => p.amount)));
  }

  dashboardFigures = computed<ExternalFigures>(() => {
    const live = this._loans().filter((l) => l.status !== 'voided');
    if (!live.length) return {};
    const rows = live.filter((l) => outstanding(l) > 0);
    return { loanBalance: { value: this.totalOwed(), components: rows.map((l) => ({ label: l.name, amount: outstanding(l), kind: 'data' as const })) } };
  });

  // ----- writes

  private saveLoans(list: LoanModel[]): void {
    this._loans.set(list);
    this.storage.set('loans', list);
  }

  private replace(l: LoanModel): void {
    this.saveLoans(this._loans().map((x) => (x.id === l.id ? l : x)));
  }

  private account(id: string) {
    const a = this.accounts.byId(id);
    // a loan lives in RD$; a credit card cannot receive or repay it
    return a && !a.archived && a.type !== 'card' && (a.currency === undefined || a.currency === 'DOP') ? a : undefined;
  }

  quote(input: LoanInput, adjust?: Adjustments): LoanQuote {
    return quoteLoan(input, adjust);
  }

  register(n: NewLoan): LoanResult {
    if (this.storage.readOnly()) return fail('read-only');
    if (!n.name.trim()) return fail('name');
    if (!this.account(n.disbursementAccountId) || !this.account(n.payAccountId)) return fail('account');
    const q = quoteLoan(n.input);
    if (q.error) return fail(q.error);
    const id = crypto.randomUUID();
    const linkedId = crypto.randomUUID();
    const up = upfrontOf(n.input);
    const created: string[] = [];
    const add = (tx: Parameters<TransactionService['add']>[0]): boolean => {
      const r = this.transactions.add(tx);
      if (r.ok) created.push(r.id);
      return r.ok;
    };
    const good =
      add({ type: 'income', amount: n.input.amount, accountId: n.disbursementAccountId, date: n.disbursementDate, categoryId: DISBURSEMENT_CATEGORY, origin: 'loan-disbursement', linkedId, note: n.name.trim() }) &&
      (addMoney(up.commission, up.once) <= 0 ||
        add({ type: 'expense', amount: addMoney(up.commission, up.once), accountId: n.disbursementAccountId, date: n.disbursementDate, categoryId: INTEREST_CATEGORY, origin: 'loan-payment', linkedId, note: n.name.trim() }));
    if (!good) {
      // all or nothing: a half-registered loan would leave money that has no debt behind it
      for (const txId of created) this.transactions.remove(txId);
      return fail('write');
    }
    const loan: LoanModel = {
      id,
      name: n.name.trim(),
      lender: n.lender?.trim() || undefined,
      amount: round2(n.input.amount),
      debt: q.totals.principal,
      rate: n.input.rate,
      method: n.input.method,
      termMonths: n.input.termMonths,
      frequency: n.input.frequency,
      periods: q.periods,
      firstDate: n.input.firstDate,
      costs: n.input.costs,
      disbursementDate: n.disbursementDate,
      disbursementAccountId: n.disbursementAccountId,
      payAccountId: n.payAccountId,
      disbursementLinkedId: linkedId,
      schedule: q.rows,
      payments: [],
      status: 'active',
      createdAt: this.transactions.clock().toISOString(),
    };
    this.saveLoans([...this._loans(), loan]);
    this.audit.log({ type: 'loan', entity: 'loan', entityId: id, after: { name: loan.name, amount: loan.amount, method: loan.method, periods: loan.periods } });
    return ok(id);
  }

  // Cancels a loan that has no payments: its disbursement is reversed (kept in the history)
  undo(loanId: string): LoanResult {
    if (this.storage.readOnly()) return fail('read-only');
    const l = this.byId(loanId);
    if (!l) return fail('not-found');
    if (l.payments.some((p) => !p.reversed)) return fail('later-payments');
    const first = this.transactions.transactions().find((t) => t.linkedId === l.disbursementLinkedId);
    if (first) {
      const r = this.transactions.reverse(first.id);
      if (!r.ok) return fail('write');
    }
    this.replace({ ...l, status: 'voided' });
    this.audit.log({ type: 'loan', entity: 'loan', entityId: l.id, before: { name: l.name, status: l.status }, after: { status: 'voided' } });
    return ok(l.id);
  }

  // ----- payments

  private writePayment(l: LoanModel, p: { date: string; accountId: string; principal: number; interest: number; fees: number; note?: string }, linkedId: string): boolean {
    const created: string[] = [];
    const add = (tx: Parameters<TransactionService['add']>[0]): boolean => {
      const r = this.transactions.add(tx);
      if (r.ok) created.push(r.id);
      return r.ok;
    };
    const charges = addMoney(p.interest, p.fees);
    const good =
      (p.principal <= 0 || add({ type: 'expense', amount: p.principal, accountId: p.accountId, date: p.date, categoryId: PRINCIPAL_CATEGORY, origin: 'loan-principal', linkedId, note: l.name })) &&
      (charges <= 0 || add({ type: 'expense', amount: charges, accountId: p.accountId, date: p.date, categoryId: INTEREST_CATEGORY, origin: 'loan-payment', linkedId, note: l.name }));
    if (!good) for (const id of created) this.transactions.remove(id);
    return good;
  }

  // Pays (part of) one installment: the next unpaid one unless `installment` says another. The
  // amount cannot be more than what is left on it (an extra to principal is payExtra).
  pay(loanId: string, input: { amount: number; date?: string; installment?: number; accountId?: string; note?: string }): LoanResult {
    if (this.storage.readOnly()) return fail('read-only');
    const l = this.byId(loanId);
    if (!l) return fail('not-found');
    if (l.status !== 'active') return fail('inactive');
    const amount = round2(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) return fail('amount');
    const row = input.installment === undefined ? nextInstallment(l) : l.schedule.find((r) => r.n === input.installment);
    if (!row) return fail('no-installment');
    const already = paidOfInstallment(l, row.n);
    const left = remainingOfInstallment(l, row);
    if (left <= 0) return fail('no-installment');
    if (amount > left) return fail('exceeds');
    const accountId = input.accountId ?? l.payAccountId;
    if (!this.account(accountId)) return fail('account');
    const date = input.date ?? this.today();
    const split = allocate(row, already, amount);
    const linkedId = crypto.randomUUID();
    if (!this.writePayment(l, { date, accountId, principal: split.principal, interest: split.interest, fees: split.fees }, linkedId)) return fail('write');
    const first = nextInstallment(l);
    const kind: LoanPaymentKind = amount < left ? 'partial' : first && row.n > first.n && date < row.date ? 'advance' : 'regular';
    const payment: LoanPayment = { id: crypto.randomUUID(), date, installment: row.n, kind, amount, principal: split.principal, interest: split.interest, fees: split.fees, linkedId, note: input.note?.trim() || undefined };
    return this.commitPayment(l, payment, l.schedule);
  }

  // An extra payment to principal. `reduce-term` keeps the installment and ends sooner;
  // `reduce-installment` keeps the end date and lowers the installment.
  payExtra(loanId: string, input: { amount: number; mode: 'reduce-term' | 'reduce-installment'; date?: string; accountId?: string; note?: string }): LoanResult {
    if (this.storage.readOnly()) return fail('read-only');
    const l = this.byId(loanId);
    if (!l) return fail('not-found');
    if (l.status !== 'active') return fail('inactive');
    const amount = round2(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) return fail('amount');
    const re = reschedule(l, amount, input.mode);
    if ('error' in re) return fail(re.error);
    const accountId = input.accountId ?? l.payAccountId;
    if (!this.account(accountId)) return fail('account');
    const date = input.date ?? this.today();
    const linkedId = crypto.randomUUID();
    if (!this.writePayment(l, { date, accountId, principal: amount, interest: 0, fees: 0 }, linkedId)) return fail('write');
    const payment: LoanPayment = { id: crypto.randomUUID(), date, installment: null, kind: 'extra', amount, principal: amount, interest: 0, fees: 0, linkedId, note: input.note?.trim() || undefined, scheduleBefore: l.schedule };
    return this.commitPayment(l, payment, re.rows);
  }

  private commitPayment(l: LoanModel, payment: LoanPayment, schedule: LoanModel['schedule']): LoanResult {
    const next: LoanModel = { ...l, schedule, payments: [...l.payments, payment] };
    const done = outstanding(next) <= 0;
    this.replace({ ...next, status: done ? 'paid' : 'active' });
    this.audit.log({ type: 'loan-payment', entity: 'loan', entityId: l.id, after: { payment: payment.id, kind: payment.kind, installment: payment.installment, amount: payment.amount, principal: payment.principal, interest: payment.interest, fees: payment.fees } });
    return ok(payment.id);
  }

  // Reverses a payment (its movements are reversed, not erased). An extra payment goes first
  // (it changed the schedule), and a regular one cannot be undone once an extra came after it.
  reversePayment(loanId: string, paymentId: string): LoanResult {
    if (this.storage.readOnly()) return fail('read-only');
    const l = this.byId(loanId);
    const p = l?.payments.find((x) => x.id === paymentId);
    if (!l || !p) return fail('not-found');
    if (p.reversed) return fail('already-reversed');
    const idx = l.payments.indexOf(p);
    const later = l.payments.slice(idx + 1).filter((x) => !x.reversed);
    if (p.kind === 'extra' ? later.length > 0 : later.some((x) => x.kind === 'extra')) return fail('later-payments');
    const tx = this.transactions.transactions().find((t) => t.linkedId === p.linkedId);
    if (tx) {
      const r = this.transactions.reverse(tx.id);
      if (!r.ok) return fail('write');
    }
    const payments = l.payments.map((x) => (x.id === p.id ? { ...x, reversed: true } : x));
    const schedule = p.kind === 'extra' && p.scheduleBefore ? p.scheduleBefore : l.schedule;
    const next: LoanModel = { ...l, payments, schedule };
    this.replace({ ...next, status: outstanding(next) > 0 ? 'active' : 'paid' });
    this.audit.log({ type: 'loan-payment', entity: 'loan', entityId: l.id, before: { payment: p.id, amount: p.amount }, after: { reversed: true }, origin: 'reversal' });
    return ok(p.id);
  }

  // ----- saved simulations

  saveSimulation(name: string, input: LoanInput): LoanResult {
    if (this.storage.readOnly()) return fail('read-only');
    if (!name.trim()) return fail('name');
    const error = quoteLoan(input).error;
    if (error) return fail(error);
    const sim: LoanSimulationModel = {
      id: crypto.randomUUID(),
      name: name.trim(),
      amount: round2(input.amount),
      rate: input.rate,
      method: input.method,
      termMonths: input.termMonths,
      frequency: input.frequency,
      costs: input.costs,
      createdAt: this.transactions.clock().toISOString(),
    };
    this._simulations.set([...this._simulations(), sim]);
    this.storage.set('loanSimulations', this._simulations());
    return ok(sim.id);
  }

  removeSimulation(id: string): void {
    if (this.storage.readOnly()) return;
    this._simulations.set(this._simulations().filter((s) => s.id !== id));
    this.storage.set('loanSimulations', this._simulations());
  }

  // ----- settings

  updateSettings(patch: Partial<LoanSettings>): boolean {
    if (this.storage.readOnly()) return false;
    const next = this.readSettings({ ...this._settings(), ...patch, switches: { ...this._settings().switches, ...(patch.switches ?? {}) } });
    const pct = (n: number) => Number.isFinite(n) && n >= 0 && n <= 100;
    if (!pct(next.commercialDiscount) || !pct(next.comfortable) || !pct(next.tight) || next.comfortable > next.tight || !(next.declaredVariable >= 0)) return false;
    this._settings.set(next);
    this.storage.set('loanSettings', next);
    return true;
  }
}

