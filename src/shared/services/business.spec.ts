// Prompt 06 (v2.12.0) on the real services. The guide example: a part bought at 10,000 with
// 500 of expenses and sold at 14,000. Personal spending does not move, the invested capital
// drops when it sells, the net profit is 3,500, personal income is +3,500 (not +14,000) and the
// receiving account gets +14,000. Also: reversal, a lot sold in two parts, a loss, a reservation
// with a deposit, the inventory apart from personal assets, a US$ account, converting a manual sale.
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, vi } from 'vitest';
import { MemoryStorage, boot } from '../testing/memory-storage';
import { account, transaction } from '../testing/builders';
import { migrateSnapshot } from '../data-layer/migrations';
import { isSyncedKey } from '../data-layer/registry';
import { parseBackup } from '../data-layer/backup';
import { AuditLogService } from './audit-log.service';
import { BudgetService } from './budget.service';
import { BusinessResult, BusinessService } from './business.service';
import { DashboardService } from './dashboard.service';
import { IncomeSourceService } from './income-source.service';
import { IncomeService } from './income.service';
import { NetWorthService } from './net-worth.service';
import { SuggestionsService } from './suggestions.service';

const bank = account({ id: 'bank', name: 'Bank', type: 'bank', initialBalance: 100000 });
const cash = account({ id: 'cash', name: 'Cash', type: 'cash', initialBalance: 0 });
const usd = account({ id: 'usd', name: 'USD', type: 'bank', currency: 'USD', initialBalance: 1000 });

function session(extra: Record<string, unknown> = {}) {
  const s = boot(new MemoryStorage().seed({ accounts: [bank, cash, usd], ...extra }));
  return { ...s, business: TestBed.inject(BusinessService), income: TestBed.inject(IncomeService), netWorth: TestBed.inject(NetWorthService), audit: TestBed.inject(AuditLogService) };
}
type S = ReturnType<typeof session>;
const id = (r: BusinessResult) => {
  if (!r.ok) throw new Error(`rejected: ${r.error}`);
  return r.id;
};
const buyPart = (s: S, cost = 10000, extra = {}) => id(s.business.addOperation({ name: 'Alternator', category: 'part', totalCost: cost, acquiredAt: '2026-11-02', accountId: 'bank', ...extra }));
const sell = (s: S, opId: string, price = 14000, extra = {}) => id(s.business.registerSale(opId, { date: '2026-11-10', quantity: 1, price, method: 'cash', accountId: 'cash', ...extra }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-20T12:00:00'));
});
afterEach(() => vi.useRealTimers());

describe('the guide example: bought at 10,000, expenses 500, sold at 14,000', () => {
  it('buying: the account pays, the capital is invested, personal spending does not move', () => {
    const s = session();
    buyPart(s);
    expect(s.transactions.accountBalance('bank')).toBe(90000);
    expect(s.transactions.monthSummary(2026, 11)).toEqual({ income: 0, expense: 0 }); // not a personal expense
    expect(s.business.inventory().cost).toBe(10000);
    const purchase = s.transactions.transactions()[0];
    expect(purchase).toMatchObject({ scope: 'business', origin: 'business-purchase', type: 'expense' });
    expect(s.transactions.categoryTotals(2026, 11, 'expense')).toEqual([]);
  });

  it('the expense of the operation is a business movement and lowers the profit, not personal spending', () => {
    const s = session();
    const op = buyPart(s);
    id(s.business.addExpense(op, { date: '2026-11-03', amount: 500, kind: 'transport', accountId: 'bank' }));
    expect(s.transactions.accountBalance('bank')).toBe(89500);
    expect(s.transactions.monthSummary(2026, 11).expense).toBe(0);
  });

  it('selling: capital invested drops, net profit 3,500, personal income +3,500 (not +14,000), the account gets 14,000', () => {
    const s = session();
    const op = buyPart(s);
    id(s.business.addExpense(op, { date: '2026-11-03', amount: 500, kind: 'transport', accountId: 'bank' }));
    sell(s, op);
    expect(s.business.inventory().cost).toBe(0);
    expect(s.business.pool()).toMatchObject({ recovered: 10000, netProfit: 3500 });
    expect(s.business.monthProfit(2026, 11)).toMatchObject({ revenue: 14000, recoveredCost: 10000, grossProfit: 4000, netProfit: 3500 });
    // personal income of the month: only the net profit
    const b = s.income.monthBreakdown(2026, 11);
    expect(b).toMatchObject({ personalNet: 0, commercialGross: 14000, commercialNetBenefit: 3500, businessNetProfit: 3500, available: 3500 });
    expect(b.businessByKind['parts-accessories']).toEqual({ revenue: 14000, netProfit: 3500 });
    expect(s.transactions.monthSummary(2026, 11)).toEqual({ income: 0, expense: 0 }); // statistics stay personal
    expect(s.transactions.accountBalance('cash')).toBe(14000);
    expect(s.transactions.accountBalance('bank')).toBe(100000 - 10000 - 500);
    expect(s.business.byId(op)?.status).toBe('sold');
  });

  it('the inventory never adds to personal assets: it has its own line and the total shows the breakdown (rule 6)', () => {
    const s = session();
    const op = buyPart(s);
    const nw = s.netWorth.summary().net.DOP;
    expect(nw).toBe(100000 - 10000); // the money left the account
    expect(s.netWorth.consolidated()).toEqual({ personal: 90000, commercialCapital: 10000, total: 100000 });
    sell(s, op);
    expect(s.netWorth.consolidated()).toEqual({ personal: 104000, commercialCapital: 0, total: 104000 });
  });

  it('the dashboard now shows capital invested and commercial profit, and leaves them out of expenses and personal net worth', () => {
    const s = session();
    const dash = TestBed.inject(DashboardService);
    expect(dash.byId('business-capital')?.available).toBe(false); // no operations yet: hidden
    const op = buyPart(s);
    expect(dash.byId('business-capital')).toMatchObject({ available: true, value: 10000 });
    expect(dash.byId('net-worth')?.components.find((c) => c.label === 'Commercial capital (apart, not added)')).toMatchObject({ amount: 10000, kind: 'excluded' });
    expect(dash.byId('expenses')?.value).toBeNull(); // no personal expense at all
    sell(s, op);
    expect(dash.byId('commercial-profit')).toMatchObject({ available: true, value: 4000 });
    expect(dash.byId('business-capital')?.value).toBe(0);
  });
});

describe('reversal and correction', () => {
  it('reversing the sale gives the article back and restores the capital; nothing is deleted', () => {
    const s = session();
    const op = buyPart(s);
    const sale = sell(s, op);
    const before = s.transactions.transactions().length;
    id(s.business.reverseSale(op, sale));
    expect(s.business.byId(op)?.status).toBe('available');
    expect(s.business.inventory().cost).toBe(10000);
    expect(s.business.pool().netProfit).toBe(0);
    expect(s.transactions.accountBalance('cash')).toBe(0);
    expect(s.income.monthBreakdown(2026, 11).available).toBe(0);
    expect(s.transactions.transactions().length).toBeGreaterThan(before); // the inverse movement was added
    expect(s.business.byId(op)?.sales).toHaveLength(1); // the sale stays, marked reversed
    expect(s.business.reverseSale(op, sale)).toEqual({ ok: false, error: 'not-found' });
  });

  it('a sold operation cannot be deleted before reversing its sale', () => {
    const s = session();
    const op = buyPart(s);
    const sale = sell(s, op);
    expect(s.business.remove(op)).toEqual({ ok: false, error: 'has-sales' });
    id(s.business.reverseSale(op, sale));
    id(s.business.remove(op));
    expect(s.business.byId(op)).toBeUndefined();
    expect(s.transactions.accountBalance('bank')).toBe(100000); // the purchase was reversed, not erased
  });

  it('correcting the price after the sale = reverse + a new sale, audited; a rejected correction leaves the sale alone', () => {
    const s = session();
    const op = buyPart(s);
    const sale = sell(s, op, 14000);
    expect(s.business.correctSale(op, sale, { price: -5 })).toEqual({ ok: false, error: 'price' });
    expect(s.business.byId(op)?.sales).toHaveLength(1);
    expect(s.business.byId(op)?.sales[0].reversed).toBeUndefined();
    id(s.business.correctSale(op, sale, { price: 15000 }));
    expect(s.business.monthProfit(2026, 11).revenue).toBe(15000);
    expect(s.business.monthProfit(2026, 11).netProfit).toBe(5000);
    expect(s.transactions.accountBalance('cash')).toBe(15000);
    expect(s.audit.events().filter((e) => e.type === 'business-sale').length).toBeGreaterThanOrEqual(3);
  });

  it('correcting the cost is allowed only before any sale (reverse + new purchase)', () => {
    const s = session();
    const op = buyPart(s);
    id(s.business.correctCost(op, 9000));
    expect(s.business.inventory().cost).toBe(9000);
    expect(s.transactions.accountBalance('bank')).toBe(91000);
    sell(s, op);
    expect(s.business.correctCost(op, 8000)).toEqual({ ok: false, error: 'has-sales' });
  });
});

describe('a lot sold in parts, and a loss', () => {
  it('four units at 8,000 sold in two parts: unit cost constant, the rest stays available, profit adds up', () => {
    const s = session();
    const op = id(s.business.addOperation({ name: 'Tires', category: 'part', quantity: 4, totalCost: 8000, acquiredAt: '2026-11-02', accountId: 'bank' }));
    id(s.business.registerSale(op, { date: '2026-11-05', quantity: 1, price: 3000, method: 'cash', accountId: 'cash' }));
    expect(s.business.byId(op)?.status).toBe('available');
    expect(s.business.inventory().cost).toBe(6000);
    id(s.business.addExpense(op, { date: '2026-11-06', amount: 400, kind: 'other', accountId: 'bank' }));
    id(s.business.registerSale(op, { date: '2026-11-06', quantity: 3, price: 7500, method: 'transfer', accountId: 'bank' }));
    expect(s.business.byId(op)?.status).toBe('sold');
    expect(s.business.inventory().cost).toBe(0);
    expect(s.business.monthProfit(2026, 11)).toMatchObject({ revenue: 10500, recoveredCost: 8000, netProfit: 2100 });
    expect(s.business.registerSale(op, { date: '2026-11-07', quantity: 1, price: 1, method: 'cash', accountId: 'cash' })).toEqual({ ok: false, error: 'sold' });
  });

  it('selling more than what is left is rejected', () => {
    const s = session();
    const op = id(s.business.addOperation({ name: 'Tires', category: 'part', quantity: 2, totalCost: 4000, acquiredAt: '2026-11-02', accountId: 'bank' }));
    expect(s.business.registerSale(op, { date: '2026-11-05', quantity: 3, price: 1000, method: 'cash', accountId: 'cash' })).toEqual({ ok: false, error: 'exceeds' });
  });

  it('a sale below cost + expenses is a visible loss and counts against personal commercial profit', () => {
    const s = session();
    const op = buyPart(s);
    id(s.business.addExpense(op, { date: '2026-11-03', amount: 500, kind: 'repair', accountId: 'bank' }));
    sell(s, op, 8000);
    expect(s.business.monthProfit(2026, 11).netProfit).toBe(-2500);
    expect(s.business.factsOf(s.business.byId(op)!)[0].margin).toBeLessThan(0);
    expect(s.income.monthBreakdown(2026, 11)).toMatchObject({ commercialNetBenefit: -2500, available: -2500 });
  });
});

describe('reservation with a deposit', () => {
  it('a deposit is not income and not profit; the sale records only the balance, and the revenue is the whole price', () => {
    const s = session();
    const op = buyPart(s);
    id(s.business.reserve(op, { date: '2026-11-05', buyer: 'Juan', deposit: 3000, accountId: 'cash' }));
    expect(s.business.byId(op)?.status).toBe('reserved');
    expect(s.transactions.accountBalance('cash')).toBe(3000);
    expect(s.income.monthBreakdown(2026, 11)).toMatchObject({ available: 0, commercialGross: 0 });
    expect(s.transactions.monthSummary(2026, 11).income).toBe(0);
    expect(s.business.monthProfit(2026, 11).netProfit).toBe(0);
    sell(s, op, 14000);
    const sale = s.business.byId(op)!.sales[0];
    expect(sale.depositApplied).toBe(3000);
    expect(s.transactions.byId(sale.txId!)?.amount).toBe(11000); // price - deposit
    expect(s.transactions.accountBalance('cash')).toBe(14000);
    expect(s.business.monthProfit(2026, 11)).toMatchObject({ revenue: 14000, netProfit: 4000 });
    expect(s.business.byId(op)?.reservation).toBeUndefined();
  });

  it('reversing that sale puts the reservation (and its deposit) back; cancelling it refunds the deposit', () => {
    const s = session();
    const op = buyPart(s);
    id(s.business.reserve(op, { date: '2026-11-05', deposit: 3000, accountId: 'cash' }));
    const sale = sell(s, op);
    id(s.business.reverseSale(op, sale));
    expect(s.business.byId(op)).toMatchObject({ status: 'reserved', reservation: { deposit: 3000 } });
    expect(s.transactions.accountBalance('cash')).toBe(3000);
    id(s.business.cancelReservation(op));
    expect(s.business.byId(op)?.status).toBe('available');
    expect(s.transactions.accountBalance('cash')).toBe(0);
  });

  it('a deposit larger than the price is rejected; only an available item can be reserved', () => {
    const s = session();
    const op = buyPart(s);
    id(s.business.reserve(op, { date: '2026-11-05', deposit: 20000, accountId: 'cash' }));
    expect(s.business.registerSale(op, { date: '2026-11-10', quantity: 1, price: 14000, method: 'cash', accountId: 'cash' })).toEqual({ ok: false, error: 'deposit' });
    expect(s.business.reserve(op, { date: '2026-11-06' })).toEqual({ ok: false, error: 'not-available' });
    expect(s.business.remove(op)).toEqual({ ok: false, error: 'has-deposit' });
  });
});

describe('pool and profit withdrawal', () => {
  it('"withdraw profit" is a neutral note: no income, no balance moves, and it cannot exceed the profit', () => {
    const s = session();
    const op = buyPart(s);
    sell(s, op); // net profit 4,000
    const balances = [s.transactions.accountBalance('bank'), s.transactions.accountBalance('cash')];
    const count = s.transactions.transactions().length;
    id(s.business.withdrawProfit(1000, '2026-11-15'));
    expect([s.transactions.accountBalance('bank'), s.transactions.accountBalance('cash')]).toEqual(balances);
    expect(s.transactions.transactions()).toHaveLength(count);
    expect(s.business.pool()).toMatchObject({ withdrawn: 1000, unwithdrawnProfit: 3000, available: 13000 });
    expect(s.business.withdrawProfit(3001, '2026-11-15')).toEqual({ ok: false, error: 'exceeds' });
    expect(s.audit.events().some((e) => e.type === 'business-withdrawal')).toBe(true);
  });

  it('monthly return = net profit / average capital employed, with its parts', () => {
    const s = session();
    const op = buyPart(s);
    sell(s, op, 13500);
    expect(s.business.monthReturn(2026, 11)).toEqual({ netProfit: 3500, averageCapital: 4000, percent: 87.5 });
    void op;
  });

  it('the business-capital block of the budget counts what was put into inventory this month', () => {
    const s = session();
    buyPart(s, 7000);
    const budget = TestBed.inject(BudgetService);
    const row = budget.bucketRows(2026, 11).find((r) => r.bucket.kind === 'business-capital')!;
    expect(row.spent).toBe(7000);
  });
});

describe('scope: business movements move balances but are not personal', () => {
  it('purchases, expenses, deposits and sales are out of personal budgets, statistics and suggestions', () => {
    const s = session();
    const op = buyPart(s);
    id(s.business.addExpense(op, { date: '2026-11-03', amount: 500, kind: 'advertising', accountId: 'bank' }));
    sell(s, op);
    const budget = TestBed.inject(BudgetService);
    budget.upsert('cat-working-capital', 1000);
    expect(budget.categoryRows(2026, 11)[0].spent).toBe(0);
    expect(TestBed.inject(SuggestionsService).transfers()).toEqual([]);
    expect(s.transactions.monthSummary(2026, 11)).toEqual({ income: 0, expense: 0 });
    expect(s.business.businessCash()).toBe(14000 - 10000 - 500);
  });

  it('older movements are personal (schema v4) and nothing in the old data changes', () => {
    const old = { id: 't', type: 'expense', amount: 5, accountId: 'a', date: '2026-11-01', origin: 'manual', status: 'posted' };
    const out = migrateSnapshot({ transactions: [old] }, 3) as { transactions: any[] };
    expect(out.transactions[0]).toEqual({ ...old, scope: 'personal' });
    expect((migrateSnapshot(out as never, 3) as { transactions: any[] }).transactions[0]).toEqual({ ...old, scope: 'personal' }); // idempotent
  });

  it('the new collections are synced and travel in backups', () => {
    for (const key of ['businessOperations', 'businessWithdrawals', 'contacts']) expect(isSyncedKey(key)).toBe(true);
    const bad = parseBackup(JSON.stringify({ app: 'x-money', schemaVersion: 4, businessOperations: [{ id: 'o', name: 'x', quantity: 1, totalCost: 5, acquiredAt: 'nope', sales: [], expenses: [] }] }));
    expect(bad).toMatchObject({ ok: false, error: { key: 'businessOperations', field: 'acquiredAt' } });
  });
});

describe('RD$ only', () => {
  it('a US$ account cannot take part in an operation: a clear rejection, nothing is written', () => {
    const s = session();
    expect(s.business.addOperation({ name: 'Part', category: 'part', totalCost: 100, acquiredAt: '2026-11-02', accountId: 'usd' })).toEqual({ ok: false, error: 'currency' });
    const op = buyPart(s);
    expect(s.business.registerSale(op, { date: '2026-11-10', quantity: 1, price: 100, method: 'transfer', accountId: 'usd' })).toEqual({ ok: false, error: 'currency' });
    expect(s.business.addExpense(op, { date: '2026-11-10', amount: 10, kind: 'other', accountId: 'usd' })).toEqual({ ok: false, error: 'currency' });
    expect(s.transactions.accountBalance('usd', 'USD')).toBe(1000);
  });
});

describe('a manual commercial sale (2.9.0) becomes an operation without duplicating the income', () => {
  it('the same movement changes scope: personal income falls by that amount, the profit is the same, no new income exists', () => {
    const source = { id: 'cars', name: 'Cars', kind: 'vehicle-trade', icon: 'x', color: '#000', active: true, stability: 'variable', method: 'transfer', verifiability: 'declared', createdAt: 'x' };
    const sale = transaction({ id: 'manual', type: 'income', amount: 800000, accountId: 'bank', date: '2026-11-10', categoryId: 'cat-business', incomeSourceId: 'cars', costBasis: 700000, saleExpenses: 15000 });
    const s = session({ incomeSources: [source], transactions: [sale] });
    expect(s.income.monthBreakdown(2026, 11)).toMatchObject({ commercialGross: 800000, commercialNetBenefit: 85000 });
    expect(s.business.convertible().map((t) => t.id)).toEqual(['manual']);
    const count = s.transactions.transactions().length;
    const balance = s.transactions.accountBalance('bank');
    const op = id(s.business.convertToOperation('manual', { name: 'Toyota Corolla', category: 'vehicle' }));
    expect(s.transactions.transactions()).toHaveLength(count); // no duplicate income
    expect(s.transactions.accountBalance('bank')).toBe(balance);
    expect(s.transactions.byId('manual')).toMatchObject({ scope: 'business', origin: 'business-sale', businessOperationId: op });
    const b = s.income.monthBreakdown(2026, 11);
    expect(b).toMatchObject({ commercialGross: 800000, commercialNetBenefit: 85000, businessNetProfit: 85000, available: 85000 }); // counted once, through the operation
    expect(b.businessByKind['vehicle-trade']).toEqual({ revenue: 800000, netProfit: 85000 });
    expect(s.transactions.monthSummary(2026, 11).income).toBe(0);
    expect(s.business.convertible()).toEqual([]);
    expect(s.business.byId(op)).toMatchObject({ status: 'sold', totalCost: 700000 });
  });
});
