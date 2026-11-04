// Prompt 06 (v2.12.0): business operations, pure part. Constant unit cost, sales of a lot in
// parts, profit (gross / net) with losses in the open, inventory, the working-capital pool,
// monthly return, slow stock and validation.
import { BusinessOperationModel, BusinessSale, BusinessWithdrawal } from '../models/business-operation.model';
import {
  activeSales,
  capitalPool,
  derivedStatus,
  incomeKindOf,
  inventorySummary,
  monthlyReturn,
  periodProfit,
  remainingQty,
  saleFacts,
  slowInventory,
  unitCost,
  validateOperation,
  validateSale,
  validateWithdrawal,
} from './business';

let n = 0;
const sale = (date: string, quantity: number, price: number, extra: Partial<BusinessSale> = {}): BusinessSale => ({ id: `s${++n}`, date, quantity, price, depositApplied: 0, method: 'cash', accountId: 'a', ...extra });
const op = (o: Partial<BusinessOperationModel> = {}): BusinessOperationModel => ({
  id: `o${++n}`,
  name: 'Part',
  category: 'part',
  quantity: 1,
  totalCost: 10000,
  acquiredAt: '2026-11-02',
  accountId: 'a',
  status: 'available',
  sales: [],
  expenses: [],
  createdAt: 'x',
  ...o,
});
const expense = (amount: number, extra = {}) => ({ id: `e${++n}`, date: '2026-11-03', amount, kind: 'transport' as const, accountId: 'a', ...extra });

describe('cost per unit and status', () => {
  it('the unit cost is total / quantity, constant; there is no weighted average', () => {
    expect(unitCost({ totalCost: 8000, quantity: 4 })).toBe(2000);
    expect(unitCost({ totalCost: 10000, quantity: 3 })).toBeCloseTo(3333.333, 3);
    expect(unitCost({ totalCost: 100, quantity: 0 })).toBe(0);
  });

  it('available, reserved and sold are derived from the sales and the reservation', () => {
    const o = op({ quantity: 2 });
    expect(derivedStatus(o)).toBe('available');
    expect(derivedStatus({ ...o, reservation: { date: '2026-11-04', deposit: 0 } })).toBe('reserved');
    expect(derivedStatus({ ...o, sales: [sale('2026-11-05', 1, 5000)] })).toBe('available'); // half is still there
    expect(derivedStatus({ ...o, sales: [sale('2026-11-05', 2, 9000)] })).toBe('sold');
    expect(derivedStatus({ ...o, sales: [sale('2026-11-05', 2, 9000, { reversed: true })] })).toBe('available'); // a reversed sale gives the units back
    expect(remainingQty({ ...o, sales: [sale('2026-11-05', 1, 5000)] })).toBe(1);
  });
});

describe('profit of a sale (rule 5: the price is revenue, the benefit is price - cost - expenses)', () => {
  it('the guide example: part bought at 10,000, expenses 500, sold at 14,000 -> net 3,500', () => {
    const o = op({ expenses: [expense(500)], sales: [sale('2026-11-10', 1, 14000)] });
    const [f] = saleFacts(o);
    expect(f).toMatchObject({ cost: 10000, expenses: 500, grossProfit: 4000, netProfit: 3500, margin: 25, roi: 33.3, days: 8, cashReceived: 14000 });
  });

  it('a sale at a loss is negative and shown as such: never hidden or rounded to zero', () => {
    const o = op({ expenses: [expense(500)], sales: [sale('2026-11-10', 1, 8000)] });
    expect(saleFacts(o)[0]).toMatchObject({ grossProfit: -2000, netProfit: -2500, margin: -31.2, roi: -23.8 });
    expect(saleFacts(op({ sales: [sale('2026-11-10', 1, 0)] }))[0]).toMatchObject({ netProfit: -10000, margin: null }); // a giveaway
  });

  it('a lot sold in two parts: the cost goes by unit, the last part takes the exact rest, expenses go pro rata', () => {
    const o = op({ quantity: 4, totalCost: 8000, expenses: [expense(400)], sales: [sale('2026-11-05', 1, 3000), sale('2026-11-06', 3, 7500)] });
    const [a, b] = saleFacts(o);
    expect(a).toMatchObject({ cost: 2000, expenses: 100, netProfit: 900 });
    expect(b).toMatchObject({ cost: 6000, expenses: 300, netProfit: 1200 });
    expect(a.netProfit + b.netProfit).toBe(10500 - 8000 - 400); // adds up exactly
  });

  it('an awkward unit cost never leaks cents: the pieces always add up to the total cost', () => {
    const o = op({ quantity: 3, totalCost: 10000, sales: [sale('2026-11-05', 1, 4000), sale('2026-11-06', 1, 4000), sale('2026-11-07', 1, 4000)] });
    const facts = saleFacts(o);
    expect(facts.map((f) => f.cost)).toEqual([3333.33, 3333.33, 3333.34]);
    expect(facts.reduce((s, f) => s + f.cost, 0)).toBeCloseTo(10000, 6);
  });

  it('a reversed sale does not count; the deposit applied is part of the price, not of the cash received now', () => {
    const o = op({ sales: [sale('2026-11-10', 1, 14000, { reversed: true }), sale('2026-11-12', 1, 14000, { depositApplied: 3000 })] });
    expect(activeSales(o)).toHaveLength(1);
    expect(saleFacts(o)[0]).toMatchObject({ netProfit: 4000, cashReceived: 11000 });
  });

  it('income kind by category of the article', () => {
    expect(incomeKindOf('vehicle')).toBe('vehicle-trade');
    expect(incomeKindOf('part')).toBe('parts-accessories');
    expect(incomeKindOf('accessory')).toBe('parts-accessories');
    expect(incomeKindOf('other')).toBe('commercial-sales');
  });
});

describe('inventory', () => {
  const today = '2026-11-20';

  it('what is not sold: units, cost, expected value (only with a target price) and age', () => {
    const a = op({ quantity: 4, totalCost: 8000, targetPrice: 12000, acquiredAt: '2026-10-01', sales: [sale('2026-11-05', 1, 3000)] });
    const b = op({ totalCost: 5000, acquiredAt: '2026-11-15' });
    const s = inventorySummary([a, b, op({ sales: [sale('2026-11-05', 1, 1)] })], today);
    expect(s.units).toBe(4); // 3 of the lot + 1
    expect(s.cost).toBe(11000); // 6,000 + 5,000
    expect(s.expectedValue).toBe(9000); // 12,000 x 3/4; the other has no target
    expect(s.withoutTarget).toBe(1);
    expect(s.oldestDays).toBe(50);
    expect(inventorySummary([], today)).toMatchObject({ units: 0, cost: 0, expectedValue: 0, oldestDays: 0 });
  });

  it('slow stock levels at 30 / 60 / 90 days, configurable', () => {
    const items = inventorySummary([op({ acquiredAt: '2026-10-16' }), op({ acquiredAt: '2026-09-16' }), op({ acquiredAt: '2026-08-16' }), op({ acquiredAt: '2026-11-10' })], '2026-11-20').items;
    expect(slowInventory(items).map((s) => s.level)).toEqual(['critical', 'high', 'warn']);
    expect(slowInventory(items, [5, 10, 20]).map((s) => s.level)).toEqual(['critical', 'critical', 'critical', 'high']);
  });
});

describe('the working-capital pool', () => {
  const sold = op({ totalCost: 10000, expenses: [expense(500)], sales: [sale('2026-11-10', 1, 14000)] });
  const withdraw = (date: string, amount: number): BusinessWithdrawal => ({ id: `w${++n}`, date, amount });

  it('invested, recovered, net profit and what is available to reinvest', () => {
    const p = capitalPool([sold, op({ totalCost: 2000, acquiredAt: '2026-11-15' })], []);
    expect(p).toMatchObject({ invested: 2000, recovered: 10000, netProfit: 3500, withdrawn: 0, unwithdrawnProfit: 3500 });
    // the 2,000 bought after the sale came out of the pool, which held 10,000 + 3,500
    expect(p).toMatchObject({ reinvested: 2000, contributed: 10000, available: 11500 });
  });

  it('a purchase the pool cannot cover is a personal contribution for the rest', () => {
    const p = capitalPool([sold, op({ totalCost: 20000, acquiredAt: '2026-11-15' })], []);
    expect(p).toMatchObject({ reinvested: 13500, contributed: 16500, available: 0 });
  });

  it('withdrawing profit lowers what is available and what can still be withdrawn', () => {
    const p = capitalPool([sold], [withdraw('2026-11-12', 1000)]);
    expect(p).toMatchObject({ withdrawn: 1000, unwithdrawnProfit: 2500, available: 12500 });
  });

  it('available = recovered + net profit not withdrawn - reinvested', () => {
    const ops = [sold, op({ totalCost: 3000, acquiredAt: '2026-11-15' })];
    const w = [withdraw('2026-11-16', 500)];
    const p = capitalPool(ops, w);
    expect(p.available).toBe(p.recovered + p.netProfit - p.withdrawn - p.reinvested);
  });

  it('nothing sold, nothing in the pool; a reversed sale takes its money out', () => {
    expect(capitalPool([op()], [])).toMatchObject({ recovered: 0, netProfit: 0, available: 0, contributed: 10000, invested: 10000 });
    expect(capitalPool([op({ sales: [sale('2026-11-10', 1, 14000, { reversed: true })] })], []).netProfit).toBe(0);
  });

  it('validates a withdrawal: it cannot exceed the profit not yet withdrawn', () => {
    expect(validateWithdrawal(500, 3500, '2026-11-20')).toBeNull();
    expect(validateWithdrawal(3501, 3500, '2026-11-20')).toBe('exceeds');
    expect(validateWithdrawal(0, 3500, '2026-11-20')).toBe('amount');
    expect(validateWithdrawal(10, 3500, 'nope')).toBe('date');
  });
});

describe('periods and monthly return', () => {
  it('profit of a period by sale date (leap year end of February included)', () => {
    const o = op({ sales: [sale('2028-02-29', 1, 12000), sale('2028-03-01', 1, 1)], quantity: 2, totalCost: 10000 });
    const feb = periodProfit([o], '2028-02-01', '2028-02-29');
    expect(feb).toMatchObject({ sales: 1, revenue: 12000, recoveredCost: 5000, grossProfit: 7000, netProfit: 7000 });
    expect(periodProfit([], '2026-11-01', '2026-11-30')).toMatchObject({ sales: 0, netProfit: 0 });
  });

  it('net profit of the month / average capital employed in the month, with the formula inputs returned', () => {
    const o = op({ expenses: [expense(500)], sales: [sale('2026-11-10', 1, 14000)] });
    const r = monthlyReturn([o], 2026, 11, '2026-11-20');
    // 10,000 held from Nov 2 to Nov 9 (8 days) out of the 20 days elapsed
    expect(r).toEqual({ netProfit: 3500, averageCapital: 4000, percent: 87.5 });
  });

  it('a past month uses all its days; a month with no capital has no percentage', () => {
    const o = op({ acquiredAt: '2026-10-01', sales: [sale('2026-10-31', 1, 11000)] });
    expect(monthlyReturn([o], 2026, 10, '2026-11-20')).toMatchObject({ netProfit: 1000, percent: expect.any(Number) });
    expect(monthlyReturn([], 2026, 11, '2026-11-20')).toEqual({ netProfit: 0, averageCapital: 0, percent: null });
    expect(monthlyReturn([o], 2026, 12, '2026-11-20')).toEqual({ netProfit: 0, averageCapital: 0, percent: null }); // a month that has not started
  });
});

describe('validation', () => {
  it('an operation needs a name, positive quantity and cost, a valid date and a sane target', () => {
    const ok = { name: 'Part', quantity: 1, totalCost: 100, acquiredAt: '2026-11-02' };
    expect(validateOperation(ok)).toBeNull();
    expect(validateOperation({ ...ok, name: ' ' })).toBe('name');
    expect(validateOperation({ ...ok, quantity: 0 })).toBe('quantity');
    expect(validateOperation({ ...ok, totalCost: 0 })).toBe('cost');
    expect(validateOperation({ ...ok, totalCost: NaN })).toBe('cost');
    expect(validateOperation({ ...ok, acquiredAt: '2026-02-30' })).toBe('date');
    expect(validateOperation({ ...ok, targetPrice: -1 })).toBe('target');
  });

  it('a sale needs units left, a price (zero allowed), a deposit within the price, and not before the purchase', () => {
    const o = op({ quantity: 2, sales: [sale('2026-11-05', 1, 5000)] });
    const input = { quantity: 1, price: 6000, date: '2026-11-10' };
    expect(validateSale(o, input, 0)).toBeNull();
    expect(validateSale(o, { ...input, quantity: 2 }, 0)).toBe('exceeds');
    expect(validateSale(o, { ...input, quantity: 0 }, 0)).toBe('quantity');
    expect(validateSale(o, { ...input, price: -1 }, 0)).toBe('price');
    expect(validateSale(o, { ...input, price: 0 }, 0)).toBeNull();
    expect(validateSale(o, input, 7000)).toBe('deposit');
    expect(validateSale(o, { ...input, date: '2026-10-01' }, 0)).toBe('before-purchase');
    expect(validateSale({ ...o, sales: [sale('2026-11-05', 2, 9000)] }, input, 0)).toBe('sold');
  });
});
