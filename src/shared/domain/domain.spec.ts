import { addDays, addYears, daysBetween, isValidIsoDate, localIso } from './dates';
import { accountBalance, balanceAsOf, balances, orphanTransactions, ownerId, totalBalance } from './ledger';
import { isCounted, spentInCategory, summarize, totalsByCategory } from './stats';
import { validateTransaction } from './validation';
import { buildReversal, groupOf, partFits, partsTotal } from './reversal';
import { detectUnmarkedTransfers } from './transfers';
import { detectRecurringIncomes } from './income-patterns';
import { defaultLiquid, netWorth } from './networth';
import { adjustmentFor, reconcileView } from './reconcile';
import { account, transaction } from '../testing/builders';
import { AccountModel } from '../models/account.model';
import { TransactionModel } from '../models/transaction.model';

const A = (o: Partial<AccountModel>) => account(o);
const T = (o: Partial<TransactionModel>) => transaction(o);

describe('dates', () => {
  it('validates real calendar dates, including leap years', () => {
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    expect(isValidIsoDate('2027-02-29')).toBe(false);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('2026-1-1')).toBe(false);
    expect(isValidIsoDate('')).toBe(false);
    expect(isValidIsoDate(20261103)).toBe(false);
  });
  it('adds days and years without time-of-day drift', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(daysBetween('2026-03-01', '2026-02-27')).toBe(-2);
    expect(addYears('2028-02-29', 1)).toBe('2029-02-28');
    expect(localIso(new Date(2026, 10, 3, 23, 59))).toBe('2026-11-03');
  });
});

describe('ledger', () => {
  const bank = A({ id: 'bank', initialBalance: 1000 });
  const cash = A({ id: 'cash', initialBalance: 0 });
  const usd = A({ id: 'usd', currency: 'USD', initialBalance: 50 });
  const accounts = [bank, cash, usd];

  it('derives balances only from the initial balance and the movements', () => {
    const txs = [
      T({ type: 'income', accountId: 'bank', amount: 500 }),
      T({ type: 'expense', accountId: 'bank', amount: 200, fee: 1.5 }),
      T({ type: 'transfer', accountId: 'bank', toAccountId: 'cash', amount: 300 }),
    ];
    expect(accountBalance(accounts, txs, 'bank', 'DOP')).toBe(998.5);
    expect(accountBalance(accounts, txs, 'cash', 'DOP')).toBe(300);
    expect(totalBalance(accounts, txs, 'DOP')).toBe(1298.5); // the transfer nets out
  });

  it('keeps RD$ and US$ apart and never converts', () => {
    const txs = [T({ type: 'expense', accountId: 'usd', amount: 10, currency: 'USD' }), T({ type: 'expense', accountId: 'bank', amount: 5 })];
    expect(accountBalance(accounts, txs, 'usd', 'USD')).toBe(40);
    expect(accountBalance(accounts, txs, 'usd', 'DOP')).toBe(0);
    expect(totalBalance(accounts, txs, 'USD')).toBe(40);
    expect(totalBalance(accounts, txs, 'DOP')).toBe(995);
  });

  it('rounds: no ghost cents', () => {
    const txs = [T({ type: 'income', accountId: 'cash', amount: 0.1 }), T({ type: 'income', accountId: 'cash', amount: 0.2 })];
    expect(accountBalance(accounts, txs, 'cash', 'DOP')).toBe(0.3);
    const many = Array.from({ length: 10 }, () => T({ type: 'income', accountId: 'cash', amount: 0.1 }));
    expect(accountBalance(accounts, many, 'cash', 'DOP')).toBe(1);
  });

  it('balanceAsOf ignores later movements and includes the same day', () => {
    const txs = [
      T({ type: 'income', accountId: 'cash', amount: 10, date: '2026-11-01' }),
      T({ type: 'income', accountId: 'cash', amount: 20, date: '2026-11-05' }),
    ];
    expect(balanceAsOf(accounts, txs, 'cash', 'DOP', '2026-10-31')).toBe(0);
    expect(balanceAsOf(accounts, txs, 'cash', 'DOP', '2026-11-01')).toBe(10);
    expect(balanceAsOf(accounts, txs, 'cash', 'DOP', '2026-12-31')).toBe(30);
  });

  it('handles empty lists and zero', () => {
    expect(totalBalance([], [], 'DOP')).toBe(0);
    expect(accountBalance(accounts, [], 'bank', 'DOP')).toBe(1000);
    expect(accountBalance(accounts, [], 'nope', 'DOP')).toBe(0);
  });

  it('a linked debit card spends the money of its bank account', () => {
    const debit = A({ id: 'debit', type: 'card', cardKind: 'debit', linkedAccountId: 'bank', initialBalance: 0 });
    const list = [bank, debit];
    expect(ownerId(list, 'debit')).toBe('bank');
    const txs = [T({ type: 'expense', accountId: 'debit', amount: 100 })];
    expect(accountBalance(list, txs, 'bank', 'DOP')).toBe(900);
    expect(accountBalance(list, txs, 'debit', 'DOP')).toBe(0);
  });

  it('archived accounts are out of the totals but keep their balance', () => {
    const old = A({ id: 'old', initialBalance: 700, archived: true });
    const list = [bank, old];
    expect(totalBalance(list, [], 'DOP')).toBe(1000);
    expect(accountBalance(list, [], 'old', 'DOP')).toBe(700);
  });

  it('liquidOnly leaves out non-liquid accounts', () => {
    const card = A({ id: 'card', type: 'card', cardKind: 'credit', liquid: false, initialBalance: -300 });
    expect(totalBalance([bank, card], [], 'DOP', { liquidOnly: true })).toBe(1000);
    expect(totalBalance([bank, card], [], 'DOP')).toBe(700);
  });

  it('legacy movements of a removed account keep the old total (orphan net)', () => {
    const txs = [
      T({ type: 'expense', accountId: 'gone', amount: 100 }),
      T({ type: 'transfer', accountId: 'bank', toAccountId: 'gone', amount: 200 }),
    ];
    // old formula: initial 1000 - 100 (expense); the transfer was ignored
    expect(totalBalance([bank], txs, 'DOP')).toBe(900);
    expect(balances([bank], txs, 'DOP').orphan).toBe(100);
    expect(orphanTransactions([bank], txs)).toHaveLength(2);
  });
});

describe('stats', () => {
  it('counts income/expense/fee, not transfers, in RD$ only', () => {
    const txs = [
      T({ type: 'income', amount: 1000 }),
      T({ type: 'expense', amount: 300, fee: 2 }),
      T({ type: 'transfer', accountId: 'a', toAccountId: 'b', amount: 5000, fee: 10 }),
      T({ type: 'expense', amount: 99, currency: 'USD' }),
    ];
    expect(summarize(txs)).toEqual({ income: 1000, expense: 312 });
    expect(totalsByCategory(txs, 'expense')).toEqual([
      { categoryId: 'cat-other-expense', total: 300 },
      { categoryId: 'cat-bank-fees', total: 12 },
    ]);
  });

  it('skips reversed pairs and reconciliation adjustments but the fee the bank kept stays', () => {
    const original = T({ id: 'o', type: 'expense', amount: 500, fee: 5, status: 'reversed', reversedBy: 'r' });
    const inverse = T({ id: 'r', type: 'income', amount: 500, status: 'reversed', reversalOf: 'o', origin: 'reversal' });
    const adj = T({ type: 'expense', amount: 77, origin: 'adjustment' });
    expect(isCounted(original)).toBe(false);
    expect(isCounted(adj)).toBe(false);
    expect(summarize([original, inverse, adj])).toEqual({ income: 0, expense: 5 });
  });

  it('spentInCategory rounds and skips reversed', () => {
    const txs = [
      T({ categoryId: 'c', amount: 0.1 }),
      T({ categoryId: 'c', amount: 0.2 }),
      T({ categoryId: 'c', amount: 50, status: 'reversed' }),
    ];
    expect(spentInCategory(txs, 'c')).toBe(0.3);
    expect(spentInCategory([], 'c')).toBe(0);
  });
});

describe('validateTransaction', () => {
  const bank = A({ id: 'bank' });
  const usd = A({ id: 'usd', currency: 'USD' });
  const dual = A({ id: 'dual', currency: 'dual', type: 'card', cardKind: 'credit' });
  const archived = A({ id: 'arch', archived: true });
  const debit = A({ id: 'debit', type: 'card', cardKind: 'debit', linkedAccountId: 'bank' });
  const accounts = [bank, usd, dual, archived, debit];
  const today = '2026-11-03';
  const ok = { type: 'expense' as const, amount: 10, accountId: 'bank', date: today };

  it('accepts a good movement', () => {
    expect(validateTransaction(ok, accounts, today)).toBeNull();
  });

  it.each([
    [{ ...ok, amount: 0 }, 'amount'],
    [{ ...ok, amount: -5 }, 'amount'],
    [{ ...ok, amount: NaN }, 'amount'],
    [{ ...ok, amount: Infinity }, 'amount'],
    [{ ...ok, fee: -1 }, 'fee'],
    [{ ...ok, fee: NaN }, 'fee'],
    [{ ...ok, date: '2026-02-30' }, 'date'],
    [{ ...ok, date: '' }, 'date'],
    [{ ...ok, date: '2028-01-01' }, 'date-far-future'],
    [{ ...ok, accountId: 'ghost' }, 'account'],
    [{ ...ok, accountId: 'arch' }, 'account-archived'],
    [{ ...ok, currency: 'USD' as const }, 'currency'],
    [{ ...ok, type: 'transfer' as const, toAccountId: 'ghost' }, 'to-account'],
    [{ ...ok, type: 'transfer' as const, toAccountId: 'arch' }, 'account-archived'],
    [{ ...ok, type: 'transfer' as const, toAccountId: 'bank' }, 'same-account'],
    [{ ...ok, type: 'transfer' as const, toAccountId: 'debit' }, 'same-account'],
    [{ ...ok, type: 'transfer' as const, toAccountId: 'usd' }, 'cross-currency'],
  ])('rejects %j as %s', (input, code) => {
    expect(validateTransaction(input as never, accounts, today)).toBe(code);
  });

  it('allows a date up to one year ahead, and further only when confirmed', () => {
    expect(validateTransaction({ ...ok, date: '2027-11-03' }, accounts, today)).toBeNull();
    expect(validateTransaction({ ...ok, date: '2027-11-04' }, accounts, today)).toBe('date-far-future');
    expect(validateTransaction({ ...ok, date: '2030-01-01' }, accounts, today, { confirmFarFuture: true })).toBeNull();
  });

  it('dual accounts take either currency; transfers need both sides to accept it', () => {
    expect(validateTransaction({ ...ok, accountId: 'dual', currency: 'USD' }, accounts, today)).toBeNull();
    expect(validateTransaction({ ...ok, type: 'transfer', accountId: 'bank', toAccountId: 'dual' }, accounts, today)).toBeNull();
    expect(validateTransaction({ ...ok, type: 'transfer', accountId: 'dual', toAccountId: 'usd', currency: 'USD' }, accounts, today)).toBeNull();
    expect(validateTransaction({ ...ok, type: 'transfer', accountId: 'usd', toAccountId: 'bank', currency: 'USD' }, accounts, today)).toBe('cross-currency');
  });
});

describe('reversal helpers', () => {
  it('builds the inverse of each kind without touching the original date', () => {
    const expense = T({ id: 'e', type: 'expense', amount: 10, date: '2026-10-01' });
    const inv = buildReversal(expense, '2026-11-03', 'r', 'now');
    expect(inv).toMatchObject({ type: 'income', amount: 10, date: '2026-11-03', reversalOf: 'e', origin: 'reversal', status: 'reversed' });
    expect(expense.date).toBe('2026-10-01');
    const transfer = T({ id: 't', type: 'transfer', accountId: 'a', toAccountId: 'b', amount: 5, fee: 1 });
    const back = buildReversal(transfer, '2026-11-03', 'r2', 'now');
    expect(back).toMatchObject({ type: 'transfer', accountId: 'b', toAccountId: 'a', amount: 5 });
    expect(back.fee).toBeUndefined(); // the fee the bank kept is not refunded
  });

  it('groups linked movements and treats a loose one as a group of one', () => {
    const a = T({ id: 'a', linkedId: 'g' });
    const b = T({ id: 'b', linkedId: 'g' });
    const c = T({ id: 'c' });
    expect(groupOf([a, b, c], a).map((t) => t.id)).toEqual(['a', 'b']);
    expect(groupOf([a, b, c], c)).toEqual([c]);
  });

  it('partial operations never exceed the declared total', () => {
    const parts = [T({ amount: 40.1 }), T({ amount: 30.2 }), T({ amount: 99, status: 'reversed' })];
    expect(partsTotal(parts)).toBe(70.3);
    expect(partFits(parts, 29.7, 100)).toBe(true);
    expect(partFits(parts, 29.71, 100)).toBe(false);
    expect(partFits([], 100, 100)).toBe(true);
  });
});

describe('detectUnmarkedTransfers', () => {
  const accounts = [A({ id: 'a' }), A({ id: 'b' }), A({ id: 'usd', currency: 'USD' })];

  it('finds an expense + income of the same amount within 3 days across own accounts', () => {
    const txs = [
      T({ id: 'e', type: 'expense', accountId: 'a', amount: 5000, date: '2026-11-01' }),
      T({ id: 'i', type: 'income', accountId: 'b', amount: 5000, date: '2026-11-03' }),
    ];
    expect(detectUnmarkedTransfers(txs, accounts)).toMatchObject([{ expenseId: 'e', incomeId: 'i', amount: 5000, fee: 0 }]);
  });

  it('tolerates a bank fee (what left minus what arrived)', () => {
    const txs = [
      T({ id: 'e', type: 'expense', accountId: 'a', amount: 5010, date: '2026-11-01' }),
      T({ id: 'i', type: 'income', accountId: 'b', amount: 5000, date: '2026-11-01' }),
    ];
    expect(detectUnmarkedTransfers(txs, accounts)[0].fee).toBe(10);
  });

  it.each([
    ['4 days apart', { d1: '2026-11-01', d2: '2026-11-05' }],
  ])('does not pair %s', (_n, { d1, d2 }) => {
    const txs = [
      T({ type: 'expense', accountId: 'a', amount: 100, date: d1 }),
      T({ type: 'income', accountId: 'b', amount: 100, date: d2 }),
    ];
    expect(detectUnmarkedTransfers(txs, accounts)).toEqual([]);
  });

  it('ignores same account, other currency, arrived more than left, big gaps, already linked or reversed', () => {
    const base = { date: '2026-11-01' };
    expect(detectUnmarkedTransfers([T({ type: 'expense', accountId: 'a', amount: 10, ...base }), T({ type: 'income', accountId: 'a', amount: 10, ...base })], accounts)).toEqual([]);
    expect(detectUnmarkedTransfers([T({ type: 'expense', accountId: 'a', amount: 10, ...base }), T({ type: 'income', accountId: 'usd', amount: 10, currency: 'USD', ...base })], accounts)).toEqual([]);
    expect(detectUnmarkedTransfers([T({ type: 'expense', accountId: 'a', amount: 10, ...base }), T({ type: 'income', accountId: 'b', amount: 11, ...base })], accounts)).toEqual([]);
    expect(detectUnmarkedTransfers([T({ type: 'expense', accountId: 'a', amount: 5000, ...base }), T({ type: 'income', accountId: 'b', amount: 4000, ...base })], accounts)).toEqual([]);
    expect(detectUnmarkedTransfers([T({ type: 'expense', accountId: 'a', amount: 10, linkedId: 'x', ...base }), T({ type: 'income', accountId: 'b', amount: 10, ...base })], accounts)).toEqual([]);
    expect(detectUnmarkedTransfers([T({ type: 'expense', accountId: 'a', amount: 10, status: 'reversed', ...base }), T({ type: 'income', accountId: 'b', amount: 10, ...base })], accounts)).toEqual([]);
  });

  it('uses each movement once, picks the closest and honors dismissals', () => {
    const txs = [
      T({ id: 'e', type: 'expense', accountId: 'a', amount: 100, date: '2026-11-01' }),
      T({ id: 'i1', type: 'income', accountId: 'b', amount: 100, date: '2026-11-01' }),
      T({ id: 'i2', type: 'income', accountId: 'b', amount: 100, date: '2026-11-03' }),
    ];
    const found = detectUnmarkedTransfers(txs, accounts);
    expect(found).toHaveLength(1);
    expect(found[0].incomeId).toBe('i1');
    expect(detectUnmarkedTransfers(txs, accounts, [found[0].key])[0].incomeId).toBe('i2');
  });

  it('works with empty lists and archived accounts', () => {
    expect(detectUnmarkedTransfers([], accounts)).toEqual([]);
    const archived = [A({ id: 'a', archived: true }), A({ id: 'b' })];
    const txs = [T({ type: 'expense', accountId: 'a', amount: 10 }), T({ type: 'income', accountId: 'b', amount: 10 })];
    expect(detectUnmarkedTransfers(txs, archived)).toEqual([]);
  });
});

describe('detectRecurringIncomes', () => {
  const accounts = [A({ id: 'bank', type: 'bank' }), A({ id: 'cash', type: 'cash' })];
  const pay = (id: string, date: string, amount = 30000, accountId = 'bank') => T({ id, type: 'income', accountId, amount, date, categoryId: 'cat-salary' });

  it('detects a biweekly payroll', () => {
    const txs = ['2026-08-15', '2026-08-30', '2026-09-15', '2026-09-30', '2026-10-15', '2026-10-30'].map((d, i) => pay(`p${i}`, d));
    const found = detectRecurringIncomes(txs, accounts);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ cadence: 'biweekly', count: 6, amount: 30000, accountId: 'bank' });
  });

  it('detects a monthly payroll with amounts within 5%', () => {
    const txs = [pay('a', '2026-08-31', 50000), pay('b', '2026-09-30', 51000), pay('c', '2026-10-31', 49500)];
    expect(detectRecurringIncomes(txs, accounts)[0]).toMatchObject({ cadence: 'monthly', count: 3 });
  });

  it('detects a weekly income', () => {
    const txs = ['2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23'].map((d, i) => pay(`w${i}`, d, 5000));
    expect(detectRecurringIncomes(txs, accounts)[0].cadence).toBe('weekly');
  });

  it('still detects it when one payment arrives late', () => {
    const txs = [pay('a', '2026-08-30'), pay('b', '2026-09-30'), pay('c', '2026-10-31'), pay('d', '2026-12-05'), pay('e', '2026-12-30')];
    expect(detectRecurringIncomes(txs, accounts)[0].cadence).toBe('monthly');
  });

  it('does NOT detect irregular incomes, different amounts, too few, or same-day deposits', () => {
    const irregular = [pay('a', '2026-09-01'), pay('b', '2026-09-09'), pay('c', '2026-10-20'), pay('d', '2026-10-25'), pay('e', '2026-11-30')];
    expect(detectRecurringIncomes(irregular, accounts)).toEqual([]);
    const different = [pay('a', '2026-08-30', 1000), pay('b', '2026-09-30', 9000), pay('c', '2026-10-31', 25000)];
    expect(detectRecurringIncomes(different, accounts)).toEqual([]);
    expect(detectRecurringIncomes([pay('a', '2026-09-30'), pay('b', '2026-10-31')], accounts)).toEqual([]);
    expect(detectRecurringIncomes([pay('a', '2026-10-01'), pay('b', '2026-10-01'), pay('c', '2026-10-01')], accounts)).toEqual([]);
  });

  it('only looks at bank/savings accounts, RD$, and valid incomes; honors skip keys', () => {
    const txs = ['2026-08-31', '2026-09-30', '2026-10-31'];
    expect(detectRecurringIncomes(txs.map((d, i) => pay(`c${i}`, d, 30000, 'cash')), accounts)).toEqual([]);
    expect(detectRecurringIncomes(txs.map((d, i) => ({ ...pay(`u${i}`, d), currency: 'USD' as const })), accounts)).toEqual([]);
    expect(detectRecurringIncomes(txs.map((d, i) => ({ ...pay(`r${i}`, d), status: 'reversed' as const })), accounts)).toEqual([]);
    const found = detectRecurringIncomes(txs.map((d, i) => pay(`k${i}`, d)), accounts);
    expect(detectRecurringIncomes(txs.map((d, i) => pay(`k${i}`, d)), accounts, [found[0].key])).toEqual([]);
  });

  it('handles empty input', () => {
    expect(detectRecurringIncomes([], accounts)).toEqual([]);
  });
});

describe('netWorth', () => {
  const cash = A({ id: 'cash', type: 'cash', initialBalance: 100 });
  const bank = A({ id: 'bank', type: 'bank', initialBalance: 1000 });
  const savings = A({ id: 'sav', type: 'savings', initialBalance: 500, currency: 'USD' });
  const card = A({ id: 'card', type: 'card', cardKind: 'credit', currency: 'dual', initialBalance: 0 });
  const other = A({ id: 'oth', type: 'other', initialBalance: 9999 });

  it('liquid = cash + bank + savings; cards and other accounts are not liquid by default', () => {
    expect(defaultLiquid('cash')).toBe(true);
    expect(defaultLiquid('card')).toBe(false);
    expect(defaultLiquid('other')).toBe(false);
    const txs = [T({ type: 'expense', accountId: 'card', amount: 300 }), T({ type: 'expense', accountId: 'card', amount: 20, currency: 'USD' })];
    const nw = netWorth([cash, bank, savings, card, other], txs);
    expect(nw.liquid).toEqual({ DOP: 1100, USD: 500 });
    expect(nw.cardDebt).toEqual({ DOP: 300, USD: 20 });
    expect(nw.net).toEqual({ DOP: 800, USD: 480 });
    expect(nw.rows.find((r) => r.accountId === 'oth')?.liquid).toBe(false);
    expect(nw.rows.find((r) => r.accountId === 'card')?.debt).toBe(true);
  });

  it('respects the liquid flag and leaves archived accounts out', () => {
    const flagged = A({ id: 'f', type: 'other', liquid: true, initialBalance: 40 });
    const gone = A({ id: 'g', type: 'bank', initialBalance: 5000, archived: true });
    const nw = netWorth([bank, flagged, gone], []);
    expect(nw.liquid.DOP).toBe(1040);
    expect(nw.rows.map((r) => r.accountId)).toEqual(['bank', 'f']);
  });

  it('is zero for no accounts and never mixes currencies', () => {
    expect(netWorth([], []).net).toEqual({ DOP: 0, USD: 0 });
  });
});

describe('reconcile', () => {
  const bank = A({ id: 'bank', initialBalance: 1000 });
  const txs = [
    T({ id: 'a', type: 'income', accountId: 'bank', amount: 200, date: '2026-10-05' }),
    T({ id: 'b', type: 'expense', accountId: 'bank', amount: 50, date: '2026-10-20' }),
    T({ id: 'c', type: 'expense', accountId: 'bank', amount: 999, date: '2026-11-20' }),
  ];

  it('compares the statement balance with the balance calculated at the statement date', () => {
    const v = reconcileView([bank], txs, 'bank', 'DOP', '2026-10-31', 1150);
    expect(v.calculated).toBe(1150);
    expect(v.difference).toBe(0);
    expect(v.pending.map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('reports the difference and only lists movements since the last reconciliation', () => {
    const v = reconcileView([bank], txs, 'bank', 'DOP', '2026-10-31', 1100, '2026-10-10');
    expect(v.difference).toBe(-50);
    expect(v.pending.map((t) => t.id)).toEqual(['b']);
  });

  it('builds an adjustment in the right direction, or none when it matches', () => {
    expect(adjustmentFor(50)).toEqual({ type: 'income', amount: 50 });
    expect(adjustmentFor(-12.5)).toEqual({ type: 'expense', amount: 12.5 });
    expect(adjustmentFor(0)).toBeNull();
    expect(adjustmentFor(0.001)).toBeNull();
  });
});
