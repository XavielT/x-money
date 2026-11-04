import { Injectable, computed, signal } from '@angular/core';
import { TransactionCurrency, TransactionModel, TransactionOrigin, TransactionType } from '../models/transaction.model';
import { StorageService } from './storage.service';
import { AccountService } from './account.service';
import { AuditLogService, summarizeTransaction } from './audit-log.service';
import { localIso } from '../domain/dates';
import { Balances, accountBalance as ledgerBalance, balances, orphanTransactions, totalFrom, txCurrency } from '../domain/ledger';
import { CategoryTotal, Summary, isCounted, summarize, totalsByCategory } from '../domain/stats';
import { TxErrorCode, TxResult, validateTransaction } from '../domain/validation';
import { buildReversal, groupOf, isReversalPart, partFits } from '../domain/reversal';
import { round2, subMoney } from '../utils/money';

export type MonthSummary = Summary;
export type { CategoryTotal };

export type NewTransaction = Omit<TransactionModel, 'id'> & { id?: string };

export interface WriteOptions {
  confirmFarFuture?: boolean;
}

const fail = (error: TxErrorCode): TxResult => ({ ok: false, error });
const ok = (id: string): TxResult => ({ ok: true, id });

// Movements: the only writer of the "transactions" collection. Every write is validated,
// traced (origin, timestamps, audit) and goes through the data layer. Balances are never
// stored: they come from domain/ledger.ts. A reversal adds the inverse movement instead of
// deleting anything; linked movements are one atomic unit.
@Injectable({ providedIn: 'root' })
export class TransactionService {
  private _transactions = signal<TransactionModel[]>([]);
  transactions = this._transactions.asReadonly();

  // Newest first (by date, then insertion order)
  sorted = computed(() => [...this._transactions()].sort((a, b) => b.date.localeCompare(a.date)));

  // Per-currency balances of every account, computed once per change of data
  private balanceMaps = computed<Record<TransactionCurrency, Balances>>(() => {
    const accounts = this.accountService.accounts();
    const txs = this._transactions();
    return { DOP: balances(accounts, txs, 'DOP'), USD: balances(accounts, txs, 'USD') };
  });

  // Total across active accounts (transfers net out)
  totalBalance = computed(() => totalFrom(this.balanceMaps().DOP, this.accountService.accounts()));

  // US dollar balance across active accounts (0 when the user never uses USD)
  totalBalanceUsd = computed(() => totalFrom(this.balanceMaps().USD, this.accountService.accounts()));

  // Movements that point to an account that no longer exists (legacy data only)
  orphans = computed(() => orphanTransactions(this.accountService.accounts(), this._transactions()));

  clock: () => Date = () => new Date();

  constructor(
    private storage: StorageService,
    private accountService: AccountService,
    private audit: AuditLogService
  ) {
    this._transactions.set(this.storage.get<TransactionModel[]>('transactions', []));
    // changes downloaded from another device
    this.storage.watch('transactions', (v) => this._transactions.set((v as TransactionModel[] | undefined) ?? []));
  }

  byId(id: string): TransactionModel | undefined {
    return this._transactions().find((t) => t.id === id);
  }

  currencyOf(t: TransactionModel): TransactionCurrency {
    return txCurrency(t);
  }

  // ----- reads

  // Transactions of a given month (month is 1-12), newest first. Includes reversed pairs:
  // this is the history, not the statistics.
  forMonth(year: number, month: number): TransactionModel[] {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    return this.sorted().filter((t) => t.date.startsWith(prefix));
  }

  forYear(year: number): TransactionModel[] {
    return this.sorted().filter((t) => t.date.startsWith(`${year}-`));
  }

  // What budgets and insights look at: reversed pairs and adjustments are out
  countedForMonth(year: number, month: number): TransactionModel[] {
    return this.forMonth(year, month).filter(isCounted);
  }

  monthSummary(year: number, month: number): Summary {
    return summarize(this.forMonth(year, month));
  }

  yearSummary(year: number): Summary {
    return summarize(this.forYear(year));
  }

  // Totals per category, biggest first (primary currency, transfers excluded)
  categoryTotals(year: number, month: number, type: TransactionType): CategoryTotal[] {
    return totalsByCategory(this.forMonth(year, month), type);
  }

  categoryTotalsForYear(year: number, type: TransactionType): CategoryTotal[] {
    return totalsByCategory(this.forYear(year), type);
  }

  // Balance of one account in one currency. Transactions made with a linked debit card
  // count against the bank account the card is connected to.
  accountBalance(accountId: string, currency: TransactionCurrency = 'DOP'): number {
    return this.balanceMaps()[currency].byAccount.get(accountId) ?? 0;
  }

  // Balance at the end of a day, from the movements only (reconciliation uses it)
  balanceAsOf(accountId: string, date: string, currency: TransactionCurrency = 'DOP'): number {
    return ledgerBalance(this.accountService.accounts(), this._transactions(), accountId, currency, date);
  }

  // An account with movements is archived, never deleted
  canDeleteAccount(accountId: string): boolean {
    return !this._transactions().some((t) => t.accountId === accountId || t.toAccountId === accountId);
  }

  // ----- writes

  private today(): string {
    return localIso(this.clock());
  }

  private nowIso(): string {
    return this.clock().toISOString();
  }

  private commit(list: TransactionModel[]): void {
    this._transactions.set(list);
    this.persist();
  }

  private defaultOrigin(t: Pick<TransactionModel, 'type' | 'toAccountId'>): TransactionOrigin {
    if (t.type !== 'transfer') return 'manual';
    const to = t.toAccountId ? this.accountService.byId(t.toAccountId) : undefined;
    // paying a credit card is a transfer to it, not an expense (rule 3)
    return to?.type === 'card' && to.cardKind === 'credit' ? 'card-payment' : 'transfer';
  }

  private validate(t: NewTransaction, options: WriteOptions): TxErrorCode | null {
    return validateTransaction(t, this.accountService.accounts(), this.today(), options);
  }

  // Validation only (the form checks a recurring rule with it before creating the rule)
  check(data: NewTransaction, options: WriteOptions = {}): TxErrorCode | null {
    return this.validate(data, options);
  }

  add(data: NewTransaction, options: WriteOptions = {}): TxResult {
    if (this.storage.readOnly()) return fail('read-only');
    const list = this._transactions();
    if (data.id && list.some((t) => t.id === data.id)) return ok(data.id); // idempotent (recurring ids)
    const error = this.validate(data, options);
    if (error) return fail(error);
    if (data.linkedId && data.groupTotal !== undefined) {
      const parts = list.filter((t) => t.linkedId === data.linkedId);
      if (!partFits(parts, data.amount, data.groupTotal)) return fail('partial-exceeds');
    }
    const now = this.nowIso();
    const tx: TransactionModel = {
      ...data,
      id: data.id ?? crypto.randomUUID(),
      amount: round2(data.amount),
      fee: data.fee ? round2(data.fee) : undefined,
      origin: data.origin ?? this.defaultOrigin(data),
      status: 'posted',
      createdAt: now,
      updatedAt: now,
    };
    this.commit([tx, ...list]);
    // recurring occurrences are summarized once per run by RecurringService
    if (tx.origin !== 'recurring') {
      this.audit.log({ type: 'create', entity: 'transaction', entityId: tx.id, accountId: tx.accountId, after: summarizeTransaction(tx), origin: tx.origin });
    }
    return ok(tx.id);
  }

  // Edit in place (the audit keeps the previous and the new value). A reconciled movement,
  // a reversed one and a reversal cannot be edited: see correct() and reverse().
  update(next: TransactionModel, options: WriteOptions = {}): TxResult {
    if (this.storage.readOnly()) return fail('read-only');
    const existing = this.byId(next.id);
    if (!existing) return fail('not-found');
    if (existing.status === 'reversed' || isReversalPart(existing)) return fail('reversed');
    if (existing.reconciled) return fail('reconciled');
    const error = this.validate(next, options);
    if (error) return fail(error);
    if (existing.linkedId && existing.groupTotal !== undefined) {
      const others = this._transactions().filter((t) => t.linkedId === existing.linkedId && t.id !== existing.id);
      if (!partFits(others, next.amount, existing.groupTotal)) return fail('partial-exceeds');
    }
    const kept: TransactionModel = {
      ...next,
      amount: round2(next.amount),
      fee: next.fee ? round2(next.fee) : undefined,
      // trace fields cannot be rewritten by an edit
      origin: this.editedOrigin(existing, next),
      linkedId: existing.linkedId,
      groupTotal: existing.groupTotal,
      reversalOf: existing.reversalOf,
      reversedBy: existing.reversedBy,
      correctionOf: existing.correctionOf,
      status: existing.status ?? 'posted',
      createdAt: existing.createdAt,
      updatedAt: this.nowIso(),
      reconciled: existing.reconciled,
      incomePattern: existing.incomePattern,
    };
    this.commit(this._transactions().map((t) => (t.id === kept.id ? kept : t)));
    this.audit.log({
      type: 'edit',
      entity: 'transaction',
      entityId: kept.id,
      accountId: kept.accountId,
      before: summarizeTransaction(existing),
      after: summarizeTransaction(kept),
    });
    return ok(kept.id);
  }

  // The kind of movement may change (expense -> transfer): recompute the automatic origins
  private editedOrigin(existing: TransactionModel, next: TransactionModel): TransactionOrigin | undefined {
    const automatic: (TransactionOrigin | undefined)[] = [undefined, 'manual', 'transfer', 'card-payment'];
    return automatic.includes(existing.origin) ? this.defaultOrigin(next) : existing.origin;
  }

  // Hard delete: only movements without links, never a reconciled one. A linked movement is
  // one atomic unit: deleting one deletes the whole group. Reversed pairs are history and stay.
  remove(id: string): TxResult {
    if (this.storage.readOnly()) return fail('read-only');
    const tx = this.byId(id);
    if (!tx) return fail('not-found');
    const group = groupOf(this._transactions(), tx);
    if (group.some(isReversalPart)) return fail('linked');
    if (group.some((t) => t.reconciled)) return fail('reconciled');
    const gone = new Set(group.map((t) => t.id));
    this.commit(this._transactions().filter((t) => !gone.has(t.id)));
    for (const t of group) {
      this.audit.log({ type: 'delete', entity: 'transaction', entityId: t.id, accountId: t.accountId, before: summarizeTransaction(t) });
    }
    return ok(id);
  }

  // Adds the inverse movement next to the original (or the whole linked group); both are
  // marked and kept. Dates of other movements never change.
  reverse(id: string): TxResult {
    if (this.storage.readOnly()) return fail('read-only');
    const tx = this.byId(id);
    if (!tx) return fail('not-found');
    const result = this.reverseIn(this._transactions(), tx);
    if ('error' in result) return fail(result.error);
    this.commit(result.list);
    for (const o of result.originals) {
      this.audit.log({ type: 'reverse', entity: 'transaction', entityId: o.id, accountId: o.accountId, before: summarizeTransaction(o), after: { reversedBy: o.reversedBy } });
    }
    return ok(result.originals[0].reversedBy!);
  }

  private reverseIn(
    list: TransactionModel[],
    tx: TransactionModel
  ): { list: TransactionModel[]; originals: TransactionModel[] } | { error: TxErrorCode } {
    const group = groupOf(list, tx);
    // a reversal itself is "reversed" too: it cannot be reversed again, nor its original twice
    if (group.some((t) => t.status === 'reversed')) return { error: 'already-reversed' };
    if (tx.origin === 'reversal') return { error: 'linked' };
    const now = this.nowIso();
    const today = this.today();
    const originals: TransactionModel[] = [];
    const inverses: TransactionModel[] = [];
    for (const original of group) {
      const inverse = buildReversal(original, today, crypto.randomUUID(), now);
      inverses.push(inverse);
      originals.push({ ...original, status: 'reversed', reversedBy: inverse.id, updatedAt: now });
    }
    const replaced = new Map(originals.map((o) => [o.id, o]));
    return { list: [...inverses, ...list.map((t) => replaced.get(t.id) ?? t)], originals };
  }

  // Correction of a movement. Normal ones are edited in place; a RECONCILED one (it already
  // appeared on a bank statement) is reversed and replaced by a new movement, and only after
  // the caller confirmed it.
  correct(id: string, changes: Partial<TransactionModel>, options: WriteOptions & { confirmReconciled?: boolean } = {}): TxResult {
    if (this.storage.readOnly()) return fail('read-only');
    const existing = this.byId(id);
    if (!existing) return fail('not-found');
    if (!existing.reconciled) return this.update({ ...existing, ...changes, id }, options);
    if (!options.confirmReconciled) return fail('reconciled');
    if (existing.status === 'reversed' || isReversalPart(existing)) return fail('reversed');

    const replacement: NewTransaction = {
      type: existing.type,
      amount: existing.amount,
      categoryId: existing.categoryId,
      accountId: existing.accountId,
      toAccountId: existing.toAccountId,
      currency: existing.currency,
      fee: existing.fee,
      date: existing.date,
      note: existing.note,
      ...changes,
      correctionOf: id,
    };
    const error = this.validate(replacement, options);
    if (error) return fail(error);
    const reversed = this.reverseIn(this._transactions(), existing);
    if ('error' in reversed) return fail(reversed.error);
    const now = this.nowIso();
    const created: TransactionModel = {
      ...replacement,
      id: crypto.randomUUID(),
      amount: round2(replacement.amount),
      origin: this.defaultOrigin(replacement),
      status: 'posted',
      createdAt: now,
      updatedAt: now,
    };
    this.commit([created, ...reversed.list]); // one write: reversal and new movement together
    this.audit.log({
      type: 'reverse',
      entity: 'transaction',
      entityId: id,
      accountId: existing.accountId,
      before: summarizeTransaction(existing),
      after: { reversedBy: reversed.originals[0].reversedBy, replacedBy: created.id },
      origin: 'correction',
    });
    return ok(created.id);
  }

  // Turns an expense + an income that were really a transfer between own accounts into ONE
  // transfer. What left minus what arrived becomes the fee, so every balance stays exactly
  // as it was. The audit keeps both originals, which makes it undoable.
  convertToTransfer(expenseId: string, incomeId: string): TxResult {
    if (this.storage.readOnly()) return fail('read-only');
    const e = this.byId(expenseId);
    const i = this.byId(incomeId);
    if (!e || !i) return fail('not-found');
    if (e.type !== 'expense' || i.type !== 'income' || e.linkedId || i.linkedId || e.status === 'reversed' || i.status === 'reversed') {
      return fail('not-a-pair');
    }
    if (e.reconciled || i.reconciled) return fail('reconciled');
    const lost = subMoney(e.amount, i.amount);
    const transfer: TransactionModel = {
      id: e.id,
      type: 'transfer',
      amount: i.amount,
      accountId: e.accountId,
      toAccountId: i.accountId,
      currency: e.currency,
      fee: round2((e.fee ?? 0) + (i.fee ?? 0) + Math.max(lost, 0)) || undefined,
      date: e.date < i.date ? e.date : i.date,
      note: e.note ?? i.note,
      origin: this.defaultOrigin({ type: 'transfer', toAccountId: i.accountId }),
      status: 'posted',
      createdAt: e.createdAt,
      updatedAt: this.nowIso(),
    };
    const error = validateTransaction(transfer, this.accountService.accounts(), this.today(), { confirmFarFuture: true });
    if (error || lost < 0) return fail(error ?? 'not-a-pair');
    this.commit(this._transactions().filter((t) => t.id !== i.id).map((t) => (t.id === e.id ? transfer : t)));
    this.audit.log({
      type: 'convert-transfer',
      entity: 'transaction',
      entityId: transfer.id,
      accountId: transfer.accountId,
      before: { expense: e, income: i },
      after: transfer,
    });
    return ok(transfer.id);
  }

  // Puts the two original movements back, if the transfer was not touched since
  undoConversion(eventId: string): TxResult {
    if (this.storage.readOnly()) return fail('read-only');
    const event = this.audit.byId(eventId);
    if (!event || event.type !== 'convert-transfer') return fail('not-found');
    const before = event.before as { expense: TransactionModel; income: TransactionModel };
    const after = event.after as TransactionModel;
    const current = this.byId(after.id);
    if (!current || current.type !== 'transfer' || current.amount !== after.amount || current.reversedBy || current.reconciled) {
      return fail('changed');
    }
    if (this.byId(before.income.id)) return fail('changed');
    this.commit([before.income, ...this._transactions().map((t) => (t.id === before.expense.id ? before.expense : t))]);
    this.audit.log({ type: 'undo-convert', entity: 'transaction', entityId: before.expense.id, accountId: before.expense.accountId, before: after, after: { expense: before.expense.id, income: before.income.id } });
    return ok(before.expense.id);
  }

  // Rule 3: an expense that was really the payment of a credit card becomes a transfer to
  // that card, in place (same id and date). Purchases stop being counted twice. The audit keeps
  // the original so it can be undone.
  convertToCardPayment(expenseId: string, cardId: string): TxResult {
    if (this.storage.readOnly()) return fail('read-only');
    const e = this.byId(expenseId);
    const card = this.accountService.byId(cardId);
    if (!e || !card) return fail('not-found');
    if (e.type !== 'expense' || e.linkedId || e.status === 'reversed' || e.origin === 'adjustment') return fail('not-a-pair');
    if (e.reconciled) return fail('reconciled');
    const transfer: TransactionModel = {
      ...e,
      type: 'transfer',
      toAccountId: cardId,
      categoryId: undefined,
      origin: 'card-payment',
      updatedAt: this.nowIso(),
    };
    const error = validateTransaction(transfer, this.accountService.accounts(), this.today(), { confirmFarFuture: true });
    if (error) return fail(error);
    this.commit(this._transactions().map((t) => (t.id === e.id ? transfer : t)));
    this.audit.log({
      type: 'card-payment-convert',
      entity: 'transaction',
      entityId: e.id,
      accountId: e.accountId,
      before: e,
      after: summarizeTransaction(transfer),
    });
    return ok(e.id);
  }

  // Puts the expense back, if the payment was not touched since
  undoCardPaymentConversion(eventId: string): TxResult {
    if (this.storage.readOnly()) return fail('read-only');
    const event = this.audit.byId(eventId);
    if (!event || event.type !== 'card-payment-convert') return fail('not-found');
    const before = event.before as TransactionModel;
    const current = this.byId(before.id);
    if (!current || current.type !== 'transfer' || current.origin !== 'card-payment' || current.reversedBy || current.reconciled || current.amount !== before.amount) {
      return fail('changed');
    }
    this.commit(this._transactions().map((t) => (t.id === before.id ? before : t)));
    this.audit.log({ type: 'undo-convert', entity: 'transaction', entityId: before.id, accountId: before.accountId, before: event.after, after: summarizeTransaction(before) });
    return ok(before.id);
  }

  // Marks movements as seen on the bank statement (or not)
  setReconciled(ids: readonly string[], value: boolean): void {
    const set = new Set(ids);
    this.commit(this._transactions().map((t) => (set.has(t.id) ? { ...t, reconciled: value || undefined } : t)));
  }

  // Confirmed recurring-income pattern (prompt 03 links it to an income source)
  tagIncomePattern(ids: readonly string[], key: string): void {
    const set = new Set(ids);
    this.commit(this._transactions().map((t) => (set.has(t.id) && t.type === 'income' ? { ...t, incomePattern: key } : t)));
  }

  private persist(): void {
    this.storage.set('transactions', this._transactions());
  }
}
