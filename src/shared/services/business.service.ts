import { Injectable, computed, signal } from '@angular/core';
import {
  BusinessOperationModel,
  BusinessSale,
  BusinessWithdrawal,
  ContactModel,
  ExpenseKind,
  OperationCategory,
  OperationExpense,
  PaymentMethod,
} from '../models/business-operation.model';
import {
  CapitalPool,
  InventorySummary,
  MonthlyReturn,
  PeriodProfit,
  SLOW_DAYS_DEFAULT,
  BusinessSaleFact,
  activeExpenses,
  activeSales,
  capitalPool,
  derivedStatus,
  inventorySummary,
  monthBounds,
  monthlyReturn,
  periodProfit,
  saleFacts,
  saleFactsOf,
  slowInventory,
  validateOperation,
  validateSale,
  validateWithdrawal,
} from '../domain/business';
import { ExternalFigures } from '../domain/dashboard';
import { localIso } from '../domain/dates';
import { isCommercialKind } from '../models/income-source.model';
import { addMoney, round2, sumMoney } from '../utils/money';
import { AccountService } from './account.service';
import { AuditLogService } from './audit-log.service';
import { IncomeSourceService } from './income-source.service';
import { StorageService } from './storage.service';
import { TransactionService } from './transaction.service';

// Error codes are plain strings: the operation validators, the movement validator and a few of
// this service's own ('currency' = a US$ account took part, which is not supported yet).
export type BusinessResult = { ok: true; id: string } | { ok: false; error: string };
const fail = (error: string): BusinessResult => ({ ok: false, error });
const ok = (id: string): BusinessResult => ({ ok: true, id });

export interface NewOperation {
  name: string;
  category: OperationCategory;
  quantity?: number;
  totalCost: number;
  acquiredAt: string;
  accountId: string;
  supplier?: string;
  targetPrice?: number;
  notes?: string;
}

export interface NewSale {
  date: string;
  quantity: number;
  price: number;
  method: PaymentMethod;
  accountId: string;
  buyer?: string;
}

// Business operations (accessories, parts, vehicles). Money that buys inventory is working
// capital, not a personal expense; the movements it creates have scope 'business': they move
// real balances but never touch personal income, expenses, budgets or statistics. A sale
// recognizes revenue; only the NET profit reaches personal income, in the month of the sale.
@Injectable({ providedIn: 'root' })
export class BusinessService {
  private _operations = signal<BusinessOperationModel[]>([]);
  private _withdrawals = signal<BusinessWithdrawal[]>([]);
  private _contacts = signal<ContactModel[]>([]);
  private _slowDays = signal<[number, number, number]>([...SLOW_DAYS_DEFAULT]);

  // Status is always derived from the sales and the reservation, never trusted from storage
  operations = computed(() => this._operations().map((op) => ({ ...op, status: derivedStatus(op) })));
  withdrawals = this._withdrawals.asReadonly();
  contacts = this._contacts.asReadonly();
  slowDays = this._slowDays.asReadonly();

  constructor(
    private storage: StorageService,
    private transactions: TransactionService,
    private accounts: AccountService,
    private sources: IncomeSourceService,
    private audit: AuditLogService
  ) {
    this._operations.set(this.storage.get<BusinessOperationModel[]>('businessOperations', []));
    this._withdrawals.set(this.storage.get<BusinessWithdrawal[]>('businessWithdrawals', []));
    this._contacts.set(this.storage.get<ContactModel[]>('contacts', []));
    this.storage.watch('businessOperations', (v) => this._operations.set((v as BusinessOperationModel[] | undefined) ?? []));
    this.storage.watch('businessWithdrawals', (v) => this._withdrawals.set((v as BusinessWithdrawal[] | undefined) ?? []));
    this.storage.watch('contacts', (v) => this._contacts.set((v as ContactModel[] | undefined) ?? []));
  }

  today(): string {
    return localIso(this.transactions.clock());
  }

  byId(id: string): BusinessOperationModel | undefined {
    return this.operations().find((o) => o.id === id);
  }

  // ----- reads

  inventory = computed<InventorySummary>(() => inventorySummary(this.operations(), this.today()));
  pool = computed<CapitalPool>(() => capitalPool(this.operations(), this._withdrawals()));
  slow = computed(() => slowInventory(this.inventory().items, this._slowDays()));
  hasOperations = computed(() => this._operations().length > 0);

  // Net profit and revenue of a month (month is 1-12) / of a year
  monthProfit(year: number, month: number): PeriodProfit {
    const { from, to } = monthBounds(year, month);
    return periodProfit(this.operations(), from, to);
  }

  yearProfit(year: number): PeriodProfit {
    return periodProfit(this.operations(), `${year}-01-01`, `${year}-12-31`);
  }

  monthReturn(year: number, month: number): MonthlyReturn {
    return monthlyReturn(this.operations(), year, month, this.today());
  }

  // What personal income reads: one fact per sale (revenue and net profit by kind)
  saleFacts = computed<BusinessSaleFact[]>(() => saleFactsOf(this.operations()));

  factsOf(op: BusinessOperationModel) {
    return saleFacts(op);
  }

  // Cost put into inventory in a month: what the "business capital" budget block counts
  purchasesInMonth(year: number, month: number): number {
    const { from, to } = monthBounds(year, month);
    return sumMoney(this._operations().filter((o) => o.acquiredAt >= from && o.acquiredAt <= to).map((o) => o.totalCost));
  }

  // Figures for the dashboard (indicators 3, 4 and 10): shown only once there is something to show
  dashboardFigures = computed<ExternalFigures>(() => {
    if (!this.hasOperations()) return {};
    const cost = this.inventory().cost;
    return { businessCapital: { value: cost }, commercialWorkingCapital: { value: cost } };
  });

  // Manual commercial sales (2.9.0) that can become an operation without duplicating the income
  convertible = computed(() => {
    const kinds = new Map(this.sources.sources().map((s) => [s.id, s.kind]));
    return this.transactions
      .transactions()
      .filter((t) => t.type === 'income' && t.status !== 'reversed' && t.scope !== 'business' && !!t.incomeSourceId && isCommercialKind(kinds.get(t.incomeSourceId) ?? 'custom') && t.costBasis !== undefined)
      .sort((a, b) => b.date.localeCompare(a.date));
  });

  // ----- helpers

  private checkAccount(accountId: string): string | null {
    const a = this.accounts.byId(accountId);
    if (!a) return 'account';
    if (a.archived) return 'account-archived';
    if (a.currency === 'USD') return 'currency'; // operations are RD$ only for now
    return null;
  }

  private save(list: BusinessOperationModel[]): void {
    this._operations.set(list);
    this.storage.set('businessOperations', list);
  }

  private replace(op: BusinessOperationModel): void {
    this.save(this._operations().map((o) => (o.id === op.id ? op : o)));
  }

  private log(type: 'business-operation' | 'business-sale' | 'business-withdrawal', id: string, after: unknown, before?: unknown): void {
    this.audit.log({ type, entity: 'business', entityId: id, before, after, origin: 'business' });
  }

  // ----- operations

  // Buying inventory: the account pays, the money becomes working capital (a business movement,
  // not a personal expense)
  addOperation(input: NewOperation): BusinessResult {
    if (this.storage.readOnly()) return fail('read-only');
    const quantity = input.quantity ?? 1;
    const error = validateOperation({ ...input, quantity });
    if (error) return fail(error);
    const accountError = this.checkAccount(input.accountId);
    if (accountError) return fail(accountError);
    const id = crypto.randomUUID();
    const purchase = this.transactions.add({
      type: 'expense',
      amount: input.totalCost,
      accountId: input.accountId,
      date: input.acquiredAt,
      categoryId: 'cat-working-capital',
      scope: 'business',
      origin: 'business-purchase',
      businessOperationId: id,
      note: input.name.trim(),
    });
    if (!purchase.ok) return fail(purchase.error);
    const op: BusinessOperationModel = {
      id,
      name: input.name.trim(),
      category: input.category,
      quantity,
      totalCost: round2(input.totalCost),
      acquiredAt: input.acquiredAt,
      accountId: input.accountId,
      supplier: input.supplier?.trim() || undefined,
      targetPrice: input.targetPrice,
      notes: input.notes?.trim() || undefined,
      status: 'available',
      purchaseTxId: purchase.id,
      sales: [],
      expenses: [],
      createdAt: this.transactions.clock().toISOString(),
    };
    this.save([op, ...this._operations()]);
    this.log('business-operation', id, { name: op.name, quantity, totalCost: op.totalCost, category: op.category });
    return ok(id);
  }

  update(id: string, patch: Partial<Pick<BusinessOperationModel, 'name' | 'category' | 'supplier' | 'targetPrice' | 'notes'>>): BusinessResult {
    if (this.storage.readOnly()) return fail('read-only');
    const op = this._operations().find((o) => o.id === id);
    if (!op) return fail('not-found');
    if (patch.name !== undefined && !patch.name.trim()) return fail('name');
    if (patch.targetPrice !== undefined && (!Number.isFinite(patch.targetPrice) || patch.targetPrice < 0)) return fail('target');
    this.replace({ ...op, ...patch, name: (patch.name ?? op.name).trim() });
    this.log('business-operation', id, patch, { name: op.name });
    return ok(id);
  }

  // Changing the cost is a correction: the purchase movement is reversed and a new one recorded
  // (audited). Only while nothing has been sold, so no profit already reported moves silently.
  correctCost(id: string, totalCost: number): BusinessResult {
    if (this.storage.readOnly()) return fail('read-only');
    const op = this._operations().find((o) => o.id === id);
    if (!op) return fail('not-found');
    if (activeSales(op).length) return fail('has-sales');
    const error = validateOperation({ name: op.name, quantity: op.quantity, totalCost, acquiredAt: op.acquiredAt });
    if (error) return fail(error);
    if (op.purchaseTxId) {
      const reversed = this.transactions.reverse(op.purchaseTxId);
      if (!reversed.ok) return fail(reversed.error);
    }
    const purchase = this.transactions.add({
      type: 'expense',
      amount: totalCost,
      accountId: op.accountId,
      date: op.acquiredAt,
      categoryId: 'cat-working-capital',
      scope: 'business',
      origin: 'business-purchase',
      businessOperationId: id,
      note: op.name,
    });
    if (!purchase.ok) return fail(purchase.error);
    this.replace({ ...op, totalCost: round2(totalCost), purchaseTxId: purchase.id });
    this.log('business-operation', id, { totalCost: round2(totalCost) }, { totalCost: op.totalCost });
    return ok(id);
  }

  // Deleting is only for something that never moved: no sales, no expenses, no deposit. The
  // purchase is reversed (the pair stays in the history), never erased.
  remove(id: string): BusinessResult {
    if (this.storage.readOnly()) return fail('read-only');
    const op = this._operations().find((o) => o.id === id);
    if (!op) return fail('not-found');
    if (activeSales(op).length) return fail('has-sales');
    if (activeExpenses(op).length) return fail('has-expenses');
    if (op.reservation?.depositTxId) return fail('has-deposit');
    if (op.purchaseTxId) {
      const reversed = this.transactions.reverse(op.purchaseTxId);
      if (!reversed.ok) return fail(reversed.error);
    }
    this.save(this._operations().filter((o) => o.id !== id));
    this.log('business-operation', id, undefined, { name: op.name, totalCost: op.totalCost });
    return ok(id);
  }

  // ----- expenses of an operation (business movements: they reduce the profit, not personal budgets)

  addExpense(id: string, input: { date: string; amount: number; kind: ExpenseKind; accountId: string; note?: string }): BusinessResult {
    if (this.storage.readOnly()) return fail('read-only');
    const op = this._operations().find((o) => o.id === id);
    if (!op) return fail('not-found');
    if (!Number.isFinite(input.amount) || input.amount <= 0) return fail('amount');
    const accountError = this.checkAccount(input.accountId);
    if (accountError) return fail(accountError);
    const tx = this.transactions.add({
      type: 'expense',
      amount: input.amount,
      accountId: input.accountId,
      date: input.date,
      categoryId: 'cat-business-expense',
      scope: 'business',
      origin: 'business-expense',
      businessOperationId: id,
      note: input.note?.trim() || undefined,
    });
    if (!tx.ok) return fail(tx.error);
    const expense: OperationExpense = { id: crypto.randomUUID(), date: input.date, amount: round2(input.amount), kind: input.kind, accountId: input.accountId, note: input.note?.trim() || undefined, txId: tx.id };
    this.replace({ ...op, expenses: [...op.expenses, expense] });
    this.log('business-operation', id, { expense: expense.amount, kind: expense.kind });
    return ok(expense.id);
  }

  removeExpense(id: string, expenseId: string): BusinessResult {
    if (this.storage.readOnly()) return fail('read-only');
    const op = this._operations().find((o) => o.id === id);
    const expense = op?.expenses.find((e) => e.id === expenseId);
    if (!op || !expense || expense.reversed) return fail('not-found');
    if (expense.txId) {
      const reversed = this.transactions.reverse(expense.txId);
      if (!reversed.ok) return fail(reversed.error);
    }
    this.replace({ ...op, expenses: op.expenses.map((e) => (e.id === expenseId ? { ...e, reversed: true } : e)) });
    this.log('business-operation', id, undefined, { expenseRemoved: expense.amount });
    return ok(expenseId);
  }

  // ----- reservation with a deposit

  // A deposit is NOT income and NOT profit: it is a business movement (origin business-deposit)
  // that waits for the sale. The sale then records only the balance (price - deposit).
  reserve(id: string, input: { date: string; buyer?: string; deposit?: number; accountId?: string }): BusinessResult {
    if (this.storage.readOnly()) return fail('read-only');
    const op = this._operations().find((o) => o.id === id);
    if (!op) return fail('not-found');
    if (derivedStatus(op) !== 'available') return fail('not-available');
    const deposit = input.deposit && input.deposit > 0 ? round2(input.deposit) : 0;
    let depositTxId: string | undefined;
    if (deposit > 0) {
      if (!input.accountId) return fail('account');
      const accountError = this.checkAccount(input.accountId);
      if (accountError) return fail(accountError);
      const tx = this.transactions.add({
        type: 'income',
        amount: deposit,
        accountId: input.accountId,
        date: input.date,
        categoryId: 'cat-business',
        scope: 'business',
        origin: 'business-deposit',
        businessOperationId: id,
        note: input.buyer?.trim() || undefined,
      });
      if (!tx.ok) return fail(tx.error);
      depositTxId = tx.id;
    }
    this.replace({ ...op, reservation: { date: input.date, buyer: input.buyer?.trim() || undefined, deposit, depositAccountId: input.accountId, depositTxId } });
    this.log('business-operation', id, { reserved: true, deposit });
    return ok(id);
  }

  // Cancelling gives the deposit back: its movement is reversed (the pair stays in the history)
  cancelReservation(id: string): BusinessResult {
    if (this.storage.readOnly()) return fail('read-only');
    const op = this._operations().find((o) => o.id === id);
    if (!op?.reservation) return fail('not-found');
    if (op.reservation.depositTxId) {
      const reversed = this.transactions.reverse(op.reservation.depositTxId);
      if (!reversed.ok) return fail(reversed.error);
    }
    this.replace({ ...op, reservation: undefined });
    this.log('business-operation', id, { reserved: false }, { deposit: op.reservation.deposit });
    return ok(id);
  }

  // ----- sales

  // The sale's own movement is the money received now (price - deposit already received); the
  // revenue and the profit are those of the whole price. The reservation is consumed.
  registerSale(id: string, input: NewSale): BusinessResult {
    if (this.storage.readOnly()) return fail('read-only');
    const op = this._operations().find((o) => o.id === id);
    if (!op) return fail('not-found');
    const deposit = op.reservation?.deposit ?? 0;
    const error = validateSale(op, input, deposit);
    if (error) return fail(error);
    const accountError = this.checkAccount(input.accountId);
    if (accountError) return fail(accountError);
    const cash = round2(input.price - deposit);
    let txId: string | undefined;
    if (cash > 0) {
      const tx = this.transactions.add({
        type: 'income',
        amount: cash,
        accountId: input.accountId,
        date: input.date,
        categoryId: 'cat-business',
        scope: 'business',
        origin: 'business-sale',
        businessOperationId: id,
        note: op.name,
      });
      if (!tx.ok) return fail(tx.error);
      txId = tx.id;
    }
    const sale: BusinessSale = {
      id: crypto.randomUUID(),
      date: input.date,
      quantity: input.quantity,
      price: round2(input.price),
      depositApplied: deposit,
      method: input.method,
      accountId: input.accountId,
      buyer: input.buyer?.trim() || op.reservation?.buyer,
      txId,
      depositTxId: op.reservation?.depositTxId,
    };
    this.replace({ ...op, sales: [...op.sales, sale], reservation: undefined });
    this.log('business-sale', id, { price: sale.price, quantity: sale.quantity, deposit });
    return ok(sale.id);
  }

  // Reversing a sale gives the units back: the article is available again (or reserved again if a
  // deposit had been applied) and the capital is restored. Nothing is deleted.
  reverseSale(id: string, saleId: string): BusinessResult {
    if (this.storage.readOnly()) return fail('read-only');
    const op = this._operations().find((o) => o.id === id);
    const sale = op?.sales.find((s) => s.id === saleId);
    if (!op || !sale || sale.reversed) return fail('not-found');
    if (sale.txId) {
      const reversed = this.transactions.reverse(sale.txId);
      if (!reversed.ok) return fail(reversed.error);
    }
    const reservation = sale.depositApplied > 0 ? { date: sale.date, buyer: sale.buyer, deposit: sale.depositApplied, depositTxId: sale.depositTxId } : op.reservation;
    this.replace({ ...op, sales: op.sales.map((s) => (s.id === saleId ? { ...s, reversed: true } : s)), reservation });
    this.log('business-sale', id, { reversed: sale.price }, { price: sale.price });
    return ok(saleId);
  }

  // Correcting a price (or date, units, method) after the sale = reverse + a new sale, audited.
  // It is checked first, so a rejected correction leaves the original sale as it was.
  correctSale(id: string, saleId: string, changes: Partial<NewSale>): BusinessResult {
    const op = this._operations().find((o) => o.id === id);
    const sale = op?.sales.find((s) => s.id === saleId);
    if (!op || !sale || sale.reversed) return fail('not-found');
    const next: NewSale = { date: sale.date, quantity: sale.quantity, price: sale.price, method: sale.method, accountId: sale.accountId, buyer: sale.buyer, ...changes };
    const hypothetical: BusinessOperationModel = { ...op, sales: op.sales.map((s) => (s.id === saleId ? { ...s, reversed: true } : s)) };
    const error = validateSale(hypothetical, next, sale.depositApplied);
    if (error) return fail(error);
    const reversed = this.reverseSale(id, saleId);
    if (!reversed.ok) return reversed;
    return this.registerSale(id, next);
  }

  // ----- the pool: withdrawing profit

  // Moves profit to personal use: a neutral note between pools. It creates no income (the profit
  // already counted as "commercial profit" in the month of the sale) and moves no balance.
  withdrawProfit(amount: number, date: string, note?: string): BusinessResult {
    if (this.storage.readOnly()) return fail('read-only');
    const error = validateWithdrawal(amount, this.pool().unwithdrawnProfit, date);
    if (error) return fail(error);
    const w: BusinessWithdrawal = { id: crypto.randomUUID(), date, amount: round2(amount), note: note?.trim() || undefined };
    this._withdrawals.set([w, ...this._withdrawals()]);
    this.storage.set('businessWithdrawals', this._withdrawals());
    this.log('business-withdrawal', w.id, { amount: w.amount, date });
    return ok(w.id);
  }

  // ----- turning a manual commercial sale (2.9.0) into an operation, without duplicating the income

  convertToOperation(txId: string, input: { name: string; category: OperationCategory; quantity?: number }): BusinessResult {
    if (this.storage.readOnly()) return fail('read-only');
    const t = this.transactions.byId(txId);
    if (!t || !this.convertible().some((c) => c.id === txId)) return fail('not-found');
    const quantity = input.quantity ?? 1;
    const error = validateOperation({ name: input.name, quantity, totalCost: t.costBasis ?? 0, acquiredAt: t.date });
    if (error) return fail(error);
    const id = crypto.randomUUID();
    const sale: BusinessSale = { id: crypto.randomUUID(), date: t.date, quantity, price: t.amount, depositApplied: 0, method: this.accounts.byId(t.accountId)?.type === 'cash' ? 'cash' : 'transfer', accountId: t.accountId, txId: t.id };
    const expenses: OperationExpense[] = t.saleExpenses ? [{ id: crypto.randomUUID(), date: t.date, amount: t.saleExpenses, kind: 'other', accountId: t.accountId, note: 'Declared with the sale' }] : [];
    const op: BusinessOperationModel = {
      id,
      name: input.name.trim(),
      category: input.category,
      quantity,
      totalCost: round2(t.costBasis ?? 0),
      acquiredAt: t.date,
      accountId: t.accountId,
      status: 'sold',
      sales: [sale],
      expenses,
      notes: 'Converted from a manual commercial sale',
      createdAt: this.transactions.clock().toISOString(),
    };
    // the same movement changes scope: no duplicate income
    const marked = this.transactions.markBusinessSale(txId, id);
    if (!marked.ok) return fail(marked.error);
    this.save([op, ...this._operations()]);
    this.log('business-operation', id, { convertedFrom: txId, price: t.amount, cost: op.totalCost });
    return ok(id);
  }

  // ----- contacts (reference only)

  addContact(c: Omit<ContactModel, 'id'>): BusinessResult {
    if (!c.name.trim()) return fail('name');
    const contact: ContactModel = { ...c, id: crypto.randomUUID(), name: c.name.trim(), phone: c.phone?.trim() || undefined, notes: c.notes?.trim() || undefined };
    this._contacts.set([...this._contacts(), contact]);
    this.storage.set('contacts', this._contacts());
    return ok(contact.id);
  }

  removeContact(id: string): void {
    this._contacts.set(this._contacts().filter((c) => c.id !== id));
    this.storage.set('contacts', this._contacts());
  }

  // ----- slow stock thresholds (days for the three levels)

  setSlowDays(days: [number, number, number]): boolean {
    if (days.some((d) => !Number.isInteger(d) || d <= 0) || !(days[0] < days[1] && days[1] < days[2])) return false;
    this._slowDays.set(days);
    return true;
  }

  // Total of the money that reached or left accounts because of business movements (for tests and the summary)
  businessCash(): number {
    return this.transactions
      .transactions()
      .filter((t) => t.scope === 'business')
      .reduce((sum, t) => addMoney(sum, t.type === 'income' ? t.amount : -t.amount), 0);
  }
}
