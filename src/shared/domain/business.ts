// Business operations: cost per unit, sales and their profit, inventory, working-capital pool,
// monthly return, slow stock and validation. Pure. RD$ only.
//
// Rules in force (docs/INTEGRIDAD.md, rules 5 and 6):
//  - Money that buys inventory is working capital, not a personal expense.
//  - A sale recognizes revenue; the benefit is price - cost - expenses of the operation. Only the
//    NET profit reaches personal income, in the month of the sale. The recovered cost is capital
//    coming back, never personal income.
//  - The unit cost of a lot is constant (total cost / quantity): no hidden weighted averages.
import { IncomeKind } from '../models/income-source.model';
import {
  BusinessOperationModel,
  BusinessSale,
  BusinessWithdrawal,
  OperationCategory,
  OperationExpense,
  OperationStatus,
} from '../models/business-operation.model';
import { addMoney, round2, subMoney, sumMoney } from '../utils/money';
import { addDays, daysBetween, isValidIsoDate, lastDayOfMonth } from './dates';

export const SLOW_DAYS_DEFAULT: readonly [number, number, number] = [30, 60, 90];

// ----- units and cost

export const unitCost = (op: Pick<BusinessOperationModel, 'totalCost' | 'quantity'>): number => (op.quantity > 0 ? op.totalCost / op.quantity : 0);

const byDate = <T extends { date: string; id: string }>(a: T, b: T) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id);

export const activeSales = (op: BusinessOperationModel): BusinessSale[] => op.sales.filter((s) => !s.reversed).sort(byDate);
export const activeExpenses = (op: BusinessOperationModel): OperationExpense[] => op.expenses.filter((e) => !e.reversed);

export const soldQty = (op: BusinessOperationModel): number => sumMoney(activeSales(op).map((s) => s.quantity));
export const remainingQty = (op: BusinessOperationModel): number => Math.max(0, round2(op.quantity - soldQty(op)));

// Always derived: sold when nothing is left, reserved when someone holds it, else available
export function derivedStatus(op: BusinessOperationModel): OperationStatus {
  if (remainingQty(op) <= 0) return 'sold';
  return op.reservation ? 'reserved' : 'available';
}

export const expensesTotal = (op: BusinessOperationModel): number => sumMoney(activeExpenses(op).map((e) => e.amount));

// ----- sales and their profit

export interface SaleFacts {
  sale: BusinessSale;
  cost: number; // cost of the units sold (unit cost x quantity; the last sale of a lot takes the exact remainder)
  expenses: number; // the share of the operation's expenses that belongs to these units
  grossProfit: number; // price - cost
  netProfit: number; // gross - expenses; negative on a loss, never hidden
  margin: number | null; // net / price, %
  roi: number | null; // net / (cost + expenses), %
  days: number; // days from acquisition to the sale
  cashReceived: number; // price - deposit: what the sale's own movement carries
}

export function saleFacts(op: BusinessOperationModel): SaleFacts[] {
  const sales = activeSales(op);
  const expenses = expensesTotal(op);
  let cumulative = 0;
  let costSoFar = 0;
  let expensesSoFar = 0;
  return sales.map((sale) => {
    cumulative = round2(cumulative + sale.quantity);
    const last = cumulative >= op.quantity;
    const cost = last ? subMoney(op.totalCost, costSoFar) : round2(unitCost(op) * sale.quantity);
    const share = last ? subMoney(expenses, expensesSoFar) : round2((expenses * sale.quantity) / op.quantity);
    costSoFar = addMoney(costSoFar, cost);
    expensesSoFar = addMoney(expensesSoFar, share);
    const gross = subMoney(sale.price, cost);
    const net = subMoney(gross, share);
    return {
      sale,
      cost,
      expenses: share,
      grossProfit: gross,
      netProfit: net,
      margin: sale.price > 0 ? Math.round((net / sale.price) * 1000) / 10 : null,
      roi: cost + share > 0 ? Math.round((net / (cost + share)) * 1000) / 10 : null,
      days: daysBetween(op.acquiredAt, sale.date),
      cashReceived: subMoney(sale.price, sale.depositApplied),
    };
  });
}

// Business sale as personal income sees it: revenue and net profit of the month, by kind
export interface BusinessSaleFact {
  date: string;
  price: number;
  cost: number;
  netProfit: number;
  kind: IncomeKind;
}

export const incomeKindOf = (category: OperationCategory): IncomeKind => (category === 'vehicle' ? 'vehicle-trade' : category === 'part' || category === 'accessory' ? 'parts-accessories' : 'commercial-sales');

export function saleFactsOf(ops: readonly BusinessOperationModel[]): BusinessSaleFact[] {
  return ops.flatMap((op) => saleFacts(op).map((f) => ({ date: f.sale.date, price: f.sale.price, cost: f.cost, netProfit: f.netProfit, kind: incomeKindOf(op.category) })));
}

// ----- inventory

export interface InventoryItem {
  op: BusinessOperationModel;
  remaining: number;
  cost: number; // unit cost x units left
  expectedValue: number | null; // target price of the units left, when there is a target
  ageDays: number;
}

export interface InventorySummary {
  items: InventoryItem[];
  units: number;
  cost: number; // capital invested: the cost of what is not sold
  expectedValue: number; // only of the items with a target price
  withoutTarget: number;
  oldestDays: number;
}

export function inventorySummary(ops: readonly BusinessOperationModel[], today: string): InventorySummary {
  const items: InventoryItem[] = [];
  for (const op of ops) {
    const remaining = remainingQty(op);
    if (remaining <= 0) continue;
    items.push({
      op,
      remaining,
      cost: round2(unitCost(op) * remaining),
      expectedValue: op.targetPrice !== undefined ? round2((op.targetPrice * remaining) / op.quantity) : null,
      ageDays: Math.max(0, daysBetween(op.acquiredAt, today)),
    });
  }
  return {
    items,
    units: sumMoney(items.map((i) => i.remaining)),
    cost: sumMoney(items.map((i) => i.cost)),
    expectedValue: sumMoney(items.map((i) => i.expectedValue ?? 0)),
    withoutTarget: items.filter((i) => i.expectedValue === null).length,
    oldestDays: Math.max(0, ...items.map((i) => i.ageDays)),
  };
}

export type SlowLevel = 'warn' | 'high' | 'critical';

// Stock that has been waiting too long (30 / 60 / 90 days by default, configurable)
export function slowInventory(items: readonly InventoryItem[], thresholds: readonly [number, number, number] = SLOW_DAYS_DEFAULT): { item: InventoryItem; level: SlowLevel }[] {
  const out: { item: InventoryItem; level: SlowLevel }[] = [];
  for (const item of items) {
    const level: SlowLevel | null = item.ageDays >= thresholds[2] ? 'critical' : item.ageDays >= thresholds[1] ? 'high' : item.ageDays >= thresholds[0] ? 'warn' : null;
    if (level) out.push({ item, level });
  }
  return out.sort((a, b) => b.item.ageDays - a.item.ageDays);
}

// ----- the working-capital pool

export interface CapitalPool {
  invested: number; // cost of the inventory not sold
  recovered: number; // cost of what was sold (capital that came back)
  netProfit: number; // all-time net profit of the sales
  withdrawn: number; // profit already moved to personal use
  reinvested: number; // pool money spent on later purchases
  contributed: number; // personal money put in (purchases the pool could not cover)
  available: number; // money available for reinvestment: recovered + net profit not withdrawn - reinvested
  unwithdrawnProfit: number; // the most that can still be withdrawn
}

// Walks the events in date order (sales first on a given day): a sale puts its recovered cost and
// its net profit into the pool, a purchase spends from the pool first and the rest is personal
// contribution, a withdrawal takes profit out.
export function capitalPool(ops: readonly BusinessOperationModel[], withdrawals: readonly BusinessWithdrawal[]): CapitalPool {
  type Ev = { date: string; order: number; kind: 'sale' | 'purchase' | 'withdraw'; cost: number; net: number };
  const events: Ev[] = [];
  let recovered = 0;
  let netProfit = 0;
  for (const op of ops) {
    events.push({ date: op.acquiredAt, order: 1, kind: 'purchase', cost: op.totalCost, net: 0 });
    for (const f of saleFacts(op)) {
      events.push({ date: f.sale.date, order: 0, kind: 'sale', cost: f.cost, net: f.netProfit });
      recovered = addMoney(recovered, f.cost);
      netProfit = addMoney(netProfit, f.netProfit);
    }
  }
  for (const w of withdrawals) events.push({ date: w.date, order: 2, kind: 'withdraw', cost: w.amount, net: 0 });
  events.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  let pool = 0;
  let reinvested = 0;
  let contributed = 0;
  for (const e of events) {
    if (e.kind === 'sale') pool = addMoney(pool, addMoney(e.cost, e.net));
    else if (e.kind === 'withdraw') pool = Math.max(0, subMoney(pool, e.cost));
    else {
      const fromPool = Math.min(Math.max(pool, 0), e.cost);
      pool = subMoney(pool, fromPool);
      reinvested = addMoney(reinvested, fromPool);
      contributed = addMoney(contributed, subMoney(e.cost, fromPool));
    }
  }
  const withdrawn = sumMoney(withdrawals.map((w) => w.amount));
  return {
    invested: inventorySummary(ops, '9999-12-31').cost,
    recovered,
    netProfit,
    withdrawn,
    reinvested,
    contributed,
    available: Math.max(0, pool),
    unwithdrawnProfit: Math.max(0, subMoney(netProfit, withdrawn)),
  };
}

// ----- periods

export interface PeriodProfit {
  revenue: number; // gross sales (price)
  recoveredCost: number;
  grossProfit: number;
  netProfit: number;
  sales: number;
}

export function periodProfit(ops: readonly BusinessOperationModel[], from: string, to: string): PeriodProfit {
  let revenue = 0;
  let recoveredCost = 0;
  let gross = 0;
  let net = 0;
  let sales = 0;
  for (const op of ops) {
    for (const f of saleFacts(op)) {
      if (f.sale.date < from || f.sale.date > to) continue;
      revenue = addMoney(revenue, f.sale.price);
      recoveredCost = addMoney(recoveredCost, f.cost);
      gross = addMoney(gross, f.grossProfit);
      net = addMoney(net, f.netProfit);
      sales++;
    }
  }
  return { revenue, recoveredCost, grossProfit: gross, netProfit: net, sales };
}

export const monthBounds = (year: number, month: number) => ({ from: `${year}-${String(month).padStart(2, '0')}-01`, to: `${year}-${String(month).padStart(2, '0')}-${String(lastDayOfMonth(year, month)).padStart(2, '0')}` });

export interface MonthlyReturn {
  netProfit: number;
  averageCapital: number; // average of the cost of the inventory held, day by day, over the month
  percent: number | null; // net profit / average capital employed; null when no capital was employed
}

// "Profitability of the month = net profit of the month / average capital employed in the month".
// The capital of a day is the cost of the units held that day (from the acquisition until sold).
export function monthlyReturn(ops: readonly BusinessOperationModel[], year: number, month: number, today: string): MonthlyReturn {
  const { from, to } = monthBounds(year, month);
  const lastDay = today < to && today >= from ? today : to;
  const days = daysBetween(from, lastDay) + 1;
  if (days <= 0) return { netProfit: 0, averageCapital: 0, percent: null };
  let capitalDays = 0;
  for (let d = 0; d < days; d++) {
    const date = addDays(from, d);
    for (const op of ops) {
      if (op.acquiredAt > date) continue;
      const soldByNow = sumMoney(activeSales(op).filter((s) => s.date <= date).map((s) => s.quantity));
      const held = Math.max(0, op.quantity - soldByNow);
      capitalDays += unitCost(op) * held;
    }
  }
  const averageCapital = round2(capitalDays / days);
  const netProfit = periodProfit(ops, from, lastDay).netProfit;
  return { netProfit, averageCapital, percent: averageCapital > 0 ? Math.round((netProfit / averageCapital) * 1000) / 10 : null };
}

// ----- validation

export type OperationError = 'name' | 'quantity' | 'cost' | 'date' | 'account' | 'currency' | 'target' | 'has-sales' | 'not-found' | 'read-only';
export type SaleError = 'quantity' | 'price' | 'deposit' | 'date' | 'account' | 'currency' | 'exceeds' | 'not-found' | 'sold' | 'read-only' | 'before-purchase';
export type OtherError = 'amount' | 'date' | 'account' | 'currency' | 'exceeds' | 'not-found' | 'read-only' | 'has-sales' | 'has-expenses' | 'has-deposit';

export interface OperationInput {
  name: string;
  quantity: number;
  totalCost: number;
  acquiredAt: string;
  targetPrice?: number;
}

export function validateOperation(i: OperationInput): OperationError | null {
  if (!i.name.trim()) return 'name';
  if (!Number.isFinite(i.quantity) || i.quantity <= 0) return 'quantity';
  if (!Number.isFinite(i.totalCost) || i.totalCost <= 0) return 'cost';
  if (!isValidIsoDate(i.acquiredAt)) return 'date';
  if (i.targetPrice !== undefined && (!Number.isFinite(i.targetPrice) || i.targetPrice < 0)) return 'target';
  return null;
}

export interface SaleInput {
  quantity: number;
  price: number;
  date: string;
}

// A sale needs units left, a price (zero is allowed: a giveaway is a loss, not an error), and a
// deposit that does not exceed the price
export function validateSale(op: BusinessOperationModel, i: SaleInput, depositApplied: number): SaleError | null {
  if (derivedStatus(op) === 'sold') return 'sold';
  if (!Number.isFinite(i.quantity) || i.quantity <= 0) return 'quantity';
  if (i.quantity > remainingQty(op)) return 'exceeds';
  if (!Number.isFinite(i.price) || i.price < 0) return 'price';
  if (depositApplied > i.price) return 'deposit';
  if (!isValidIsoDate(i.date)) return 'date';
  if (i.date < op.acquiredAt) return 'before-purchase';
  return null;
}

export function validateWithdrawal(amount: number, unwithdrawnProfit: number, date: string): OtherError | null {
  if (!Number.isFinite(amount) || amount <= 0) return 'amount';
  if (amount > unwithdrawnProfit) return 'exceeds';
  if (!isValidIsoDate(date)) return 'date';
  return null;
}
