// Prompt 02 (v2.8.0): credit cards. Pure functions: periods and cuts (short months, leap year,
// cut day), due dates, debt / available credit / utilization, statements, payments as
// settlement, alerts and the notices planned for the device.
import { AccountModel, CardConfig } from '../models/account.model';
import { CardStatementModel } from '../models/card-statement.model';
import { account, transaction } from '../testing/builders';
import {
  CARD_INTEREST_CATEGORY,
  amountPaid,
  breakdown,
  buildStatement,
  cardAlerts,
  cardDebt,
  consolidatedUtilization,
  consumptionOf,
  cutDateIn,
  cutForDate,
  cutsToClose,
  dueDateOf,
  interestGap,
  isEmptyStatement,
  minimumPayment,
  missingCardData,
  nextCutAfter,
  nextCutOnOrAfter,
  paymentsAfter,
  periodOfCut,
  plannedNotices,
  prevCutBefore,
  prevCutOnOrBefore,
  remainingOf,
  statementStatus,
  utilizationOf,
} from './cards';
import { accountBalance } from './ledger';
import { detectCardPaymentExpenses } from './card-payments';
import { smallPurchases } from './small-purchases';

const CONFIG: CardConfig = { creditLimit: 50000, cutDay: 15, dueMode: 'days-after', dueDays: 20, minPercent: 5, minFloor: 500 };
const bank = account({ id: 'bank', name: 'Bank', type: 'bank', initialBalance: 100000 });
const visa = account({ id: 'visa', name: 'Visa', type: 'card', cardKind: 'credit', initialBalance: 0, card: CONFIG });

const buy = (amount: number, date: string, extra: Partial<ReturnType<typeof transaction>> = {}) =>
  transaction({ type: 'expense', amount, accountId: 'visa', date, categoryId: 'cat-shopping', ...extra });
const pay = (amount: number, date: string, extra: Partial<ReturnType<typeof transaction>> = {}) =>
  transaction({ type: 'transfer', amount, accountId: 'bank', toAccountId: 'visa', date, origin: 'card-payment', ...extra });

describe('card data completeness', () => {
  it('a card created before 2.8.0 has none of it and is reported as incomplete', () => {
    const old: AccountModel = account({ id: 'old', type: 'card', cardKind: 'credit' }); // 2.7.0 shape: no `card`
    expect(missingCardData(old)).toEqual(['limit', 'cut', 'due']);
  });

  it('is complete with limit, cut and due; a dual card needs a limit per currency', () => {
    expect(missingCardData(visa)).toEqual([]);
    const dual = { currency: 'dual' as const, card: CONFIG };
    expect(missingCardData(dual)).toEqual(['limit']);
    expect(missingCardData({ currency: 'dual', card: { ...CONFIG, creditLimitUsd: 1000 } })).toEqual([]);
  });

  it('rejects an impossible cut or due day instead of guessing', () => {
    expect(missingCardData({ card: { ...CONFIG, cutDay: 32 } })).toEqual(['cut']);
    expect(missingCardData({ card: { ...CONFIG, cutDay: 0 } })).toEqual(['cut']);
    expect(missingCardData({ card: { ...CONFIG, dueMode: 'fixed-day' } })).toEqual(['due']);
    expect(missingCardData({ card: { ...CONFIG, dueMode: 'days-after', dueDays: -1 } })).toEqual(['due']);
  });
});

describe('cut calendar', () => {
  it('a cut on day 29-31 falls on the last day of a short month', () => {
    expect(cutDateIn(2026, 2, 31)).toBe('2026-02-28');
    expect(cutDateIn(2026, 4, 31)).toBe('2026-04-30');
    expect(cutDateIn(2026, 1, 31)).toBe('2026-01-31');
  });

  it('leap year: day 29-31 of February is the 29th', () => {
    expect(cutDateIn(2028, 2, 30)).toBe('2028-02-29');
    expect(cutDateIn(2100, 2, 29)).toBe('2100-02-28'); // 2100 is not a leap year
  });

  it('next and previous cuts, across a month and a year change', () => {
    expect(nextCutOnOrAfter('2026-11-15', 15)).toBe('2026-11-15');
    expect(nextCutOnOrAfter('2026-11-16', 15)).toBe('2026-12-15');
    expect(nextCutOnOrAfter('2026-12-16', 15)).toBe('2027-01-15');
    expect(prevCutOnOrBefore('2026-01-10', 15)).toBe('2025-12-15');
    expect(nextCutAfter('2026-11-15', 15)).toBe('2026-12-15');
    expect(prevCutBefore('2026-11-15', 15)).toBe('2026-10-15');
  });

  it('day-31 card: Jan 31, Feb 28, Mar 31', () => {
    expect(nextCutAfter('2026-01-31', 31)).toBe('2026-02-28');
    expect(nextCutAfter('2026-02-28', 31)).toBe('2026-03-31');
    expect(prevCutBefore('2026-03-31', 31)).toBe('2026-02-28');
  });

  it('a purchase ON the cut day closes with that statement by default, or goes to the next one', () => {
    expect(cutForDate('2026-11-15', CONFIG)).toBe('2026-11-15');
    expect(cutForDate('2026-11-16', CONFIG)).toBe('2026-12-15');
    const next: CardConfig = { ...CONFIG, cutDayPurchases: 'next' };
    expect(cutForDate('2026-11-15', next)).toBe('2026-12-15');
    expect(cutForDate('2026-11-14', next)).toBe('2026-11-15');
  });

  it('periods never overlap and leave no gap (both rules)', () => {
    for (const rule of ['closing', 'next'] as const) {
      const config: CardConfig = { ...CONFIG, cutDayPurchases: rule };
      const a = periodOfCut('2026-11-15', config);
      const b = periodOfCut('2026-12-15', config);
      expect(b.start).toBe(new Date(Date.parse(a.end) + 86_400_000).toISOString().slice(0, 10));
    }
    expect(periodOfCut('2026-11-15', CONFIG)).toEqual({ start: '2026-10-16', end: '2026-11-15', cut: '2026-11-15' });
    expect(periodOfCut('2026-11-15', { ...CONFIG, cutDayPurchases: 'next' })).toEqual({ start: '2026-10-15', end: '2026-11-14', cut: '2026-11-15' });
  });
});

describe('due date', () => {
  it('N days after the cut, across months', () => {
    expect(dueDateOf('2026-11-15', CONFIG)).toBe('2026-12-05');
    expect(dueDateOf('2026-12-15', CONFIG)).toBe('2027-01-04');
  });

  it('a fixed day of the month is the first one after the cut', () => {
    const fixed: CardConfig = { ...CONFIG, dueMode: 'fixed-day', dueDay: 5 };
    expect(dueDateOf('2026-11-15', fixed)).toBe('2026-12-05');
    expect(dueDateOf('2026-11-15', { ...fixed, dueDay: 28 })).toBe('2026-11-28');
    expect(dueDateOf('2027-01-31', { ...fixed, dueDay: 30 })).toBe('2027-02-28');
  });
});

describe('debt, available credit and utilization (from movements, never stored)', () => {
  const accounts = [bank, visa];

  it('purchases and payments, partial payment included', () => {
    const txs = [buy(5000, '2026-11-02'), buy(2500.5, '2026-11-03'), pay(3000, '2026-11-04')];
    const d = cardDebt(accounts, txs, visa, 'DOP');
    expect(d).toMatchObject({ owed: 4500.5, inFavor: 0, limit: 50000, available: 45499.5 });
  });

  it('paying more than owed leaves a balance in your favor, not negative debt', () => {
    const d = cardDebt(accounts, [buy(1000, '2026-11-02'), pay(1500, '2026-11-04')], visa, 'DOP');
    expect(d).toMatchObject({ owed: 0, inFavor: 500, available: 50000 });
  });

  it('a dual card keeps RD$ and US$ apart, each with its own limit', () => {
    const dual = account({ id: 'dual', type: 'card', cardKind: 'credit', currency: 'dual', card: { ...CONFIG, creditLimitUsd: 2000 } });
    const txs = [
      transaction({ type: 'expense', amount: 1000, accountId: 'dual', date: '2026-11-02' }),
      transaction({ type: 'expense', amount: 150, currency: 'USD', accountId: 'dual', date: '2026-11-02' }),
    ];
    expect(cardDebt([dual], txs, dual, 'DOP')).toMatchObject({ owed: 1000, limit: 50000 });
    expect(cardDebt([dual], txs, dual, 'USD')).toMatchObject({ owed: 150, limit: 2000, available: 1850 });
  });

  it('without a limit there is no available credit and no utilization', () => {
    const bare = account({ id: 'bare', type: 'card', cardKind: 'credit' });
    const d = cardDebt([bare], [transaction({ type: 'expense', amount: 10, accountId: 'bare' })], bare, 'DOP');
    expect(d.available).toBeUndefined();
    expect(utilizationOf(d.owed, d.limit)).toEqual({ percent: null, level: null });
    expect(utilizationOf(10, 0)).toEqual({ percent: null, level: null });
  });

  it('utilization levels follow the thresholds, which are editable (30 / 90 are only the usual reference)', () => {
    expect(utilizationOf(1000, 10000)).toEqual({ percent: 10, level: 'ok' });
    expect(utilizationOf(3000, 10000).level).toBe('warn');
    expect(utilizationOf(9000, 10000).level).toBe('danger');
    expect(utilizationOf(3000, 10000, 50, 80).level).toBe('ok');
    expect(utilizationOf(12000, 10000)).toEqual({ percent: 120, level: 'danger' });
    expect(utilizationOf(0, 10000)).toEqual({ percent: 0, level: 'ok' });
  });

  it('consolidated utilization adds only cards with a limit, in one currency', () => {
    const c = consolidatedUtilization([
      { currency: 'DOP', owed: 1000, inFavor: 0, limit: 10000, available: 9000 },
      { currency: 'DOP', owed: 3000, inFavor: 0, limit: 10000, available: 7000 },
      { currency: 'DOP', owed: 999, inFavor: 0 }, // no limit: left out of the ratio
    ]);
    expect(c).toMatchObject({ owed: 4000, limit: 20000, percent: 20, level: 'ok' });
    expect(consolidatedUtilization([])).toMatchObject({ owed: 0, limit: undefined, percent: null });
  });
});

describe('minimum payment', () => {
  it('percentage with a floor, never above the balance, zero without debt', () => {
    expect(minimumPayment(20000, CONFIG, 'DOP')).toBe(1000);
    expect(minimumPayment(4000, CONFIG, 'DOP')).toBe(500); // 5% = 200 -> floor
    expect(minimumPayment(300, CONFIG, 'DOP')).toBe(300); // capped by the balance
    expect(minimumPayment(0, CONFIG, 'DOP')).toBe(0);
    expect(minimumPayment(-50, CONFIG, 'DOP')).toBe(0);
    expect(minimumPayment(1000, undefined, 'DOP')).toBe(50); // default 5 %
    expect(minimumPayment(200, { ...CONFIG, minFloorUsd: 25 }, 'USD')).toBe(25);
  });
});

describe('statement breakdown matches the ledger exactly', () => {
  const accounts = [bank, visa];
  const txs = [
    buy(1000, '2026-10-20'),
    buy(250.75, '2026-10-30', { fee: 10 }),
    pay(500, '2026-11-02'),
    transaction({ type: 'income', amount: 100, accountId: 'visa', date: '2026-11-05' }), // refund
    buy(40, '2026-11-15', { categoryId: CARD_INTEREST_CATEGORY }), // interest posted by the bank
    transaction({ type: 'transfer', amount: 300, accountId: 'visa', toAccountId: 'bank', date: '2026-11-10' }), // cash advance
    buy(99, '2026-11-16'),
  ];

  it('previous + purchases + charges + advances - payments - credits = closing = -balance at the end', () => {
    const b = breakdown(accounts, txs, 'visa', 'DOP', '2026-10-16', '2026-11-15');
    expect(b).toEqual({ previous: 0, purchases: 1250.75, charges: 50, advances: 300, payments: 500, credits: 100, closing: 1000.75 });
    expect(b.closing).toBe(-accountBalance(accounts, txs, 'visa', 'DOP', '2026-11-15'));
  });

  it('the next period starts from what the previous one closed with', () => {
    const next = breakdown(accounts, txs, 'visa', 'DOP', '2026-11-16', '2026-12-15');
    expect(next.previous).toBe(1000.75);
    expect(next.closing).toBe(1099.75);
  });

  it('opening debt (negative initial balance) is the previous balance of the first period', () => {
    const old = account({ id: 'old', type: 'card', cardKind: 'credit', initialBalance: -2000, card: CONFIG });
    expect(breakdown([old], [], 'old', 'DOP', '2026-10-16', '2026-11-15')).toMatchObject({ previous: 2000, closing: 2000 });
  });

  it('a reversed purchase stays on both sides, so the identity still holds', () => {
    const original = buy(700, '2026-11-01', { id: 'o', status: 'reversed', reversedBy: 'r' });
    const inverse = transaction({ id: 'r', type: 'income', amount: 700, accountId: 'visa', date: '2026-11-03', status: 'reversed', reversalOf: 'o', origin: 'reversal' });
    const b = breakdown(accounts, [original, inverse], 'visa', 'DOP', '2026-10-16', '2026-11-15');
    expect(b).toMatchObject({ purchases: 700, credits: 700, closing: 0 });
  });
});

describe('closing statements', () => {
  const accounts = [bank, visa];
  const txs = [buy(10000, '2026-10-20'), pay(4000, '2026-10-25'), buy(2000, '2026-11-15'), buy(999, '2026-11-16')];

  it('builds the statement of a cut from the movements (cut-day purchase included)', () => {
    const s = buildStatement(accounts, txs, visa, 'DOP', '2026-11-15', '2026-11-15T10:00:00Z');
    expect(s).toMatchObject({
      id: 'stmt-visa-DOP-2026-11-15',
      periodStart: '2026-10-16',
      periodEnd: '2026-11-15',
      dueDate: '2026-12-05',
      previousBalance: 0,
      purchases: 12000,
      payments: 4000,
      calculatedBalance: 8000,
      calculatedMinimum: 500, // 5% = 400, below the 500 floor
    });
  });

  it('with "next", the cut-day purchase falls in the following statement', () => {
    const card = { ...visa, card: { ...CONFIG, cutDayPurchases: 'next' as const } };
    const s = buildStatement(accounts, txs, card, 'DOP', '2026-11-15', 'x');
    expect(s.periodEnd).toBe('2026-11-14');
    expect(s.purchases).toBe(10000);
    expect(s.calculatedBalance).toBe(6000);
  });

  it('the first time only the latest cut is closed (history is not invented); afterwards every missed one', () => {
    expect(cutsToClose(CONFIG, [], '2026-11-20')).toEqual(['2026-11-15']);
    const last = { cutDate: '2026-08-15' } as CardStatementModel;
    expect(cutsToClose(CONFIG, [last], '2026-11-20')).toEqual(['2026-09-15', '2026-10-15', '2026-11-15']);
  });

  it('closes on the cut day itself, not before', () => {
    expect(cutsToClose(CONFIG, [], '2026-11-14')).toEqual(['2026-10-15']);
    expect(cutsToClose(CONFIG, [], '2026-11-15')).toEqual(['2026-11-15']);
  });

  it('never closes more than a year at once, and not at all without cut or due data', () => {
    const old = { cutDate: '2020-01-15' } as CardStatementModel;
    expect(cutsToClose(CONFIG, [old], '2026-11-20')).toHaveLength(12);
    expect(cutsToClose({ creditLimit: 5 }, [], '2026-11-20')).toEqual([]);
  });

  it('a period with nothing in it is not worth a statement', () => {
    const empty = buildStatement([bank, visa], [], visa, 'DOP', '2026-11-15', 'x');
    expect(isEmptyStatement(empty)).toBe(true);
  });
});

describe('payments settle statements, oldest first, and are derived (never stored)', () => {
  const accounts = [bank, visa];
  const stmt = (over: Partial<CardStatementModel> = {}): CardStatementModel => ({
    id: 's1',
    accountId: 'visa',
    currency: 'DOP',
    periodStart: '2026-10-16',
    periodEnd: '2026-11-15',
    cutDate: '2026-11-15',
    dueDate: '2026-12-05',
    previousBalance: 0,
    purchases: 8000,
    charges: 0,
    payments: 0,
    credits: 0,
    calculatedBalance: 8000,
    calculatedMinimum: 500,
    generatedAt: 'x',
    ...over,
  });

  it('counts only payments after the cut, in the card currency, not reversed', () => {
    const txs = [
      pay(1000, '2026-11-15'), // on the cut day: already inside the balance
      pay(3000, '2026-11-20'),
      pay(500, '2026-11-21', { status: 'reversed' }),
      pay(200, '2026-11-22', { currency: 'USD' }),
    ];
    expect(paymentsAfter(accounts, txs, 'visa', 'DOP', '2026-11-15')).toBe(3000);
  });

  it('status: closed -> partial -> paid; overdue once the due date passes unpaid', () => {
    const s = stmt();
    expect(statementStatus(s, 0, '2026-11-20')).toBe('closed');
    expect(statementStatus(s, 3000, '2026-11-20')).toBe('partial');
    expect(statementStatus(s, 8000, '2026-11-20')).toBe('paid');
    expect(statementStatus(s, 9000, '2026-11-20')).toBe('paid'); // overpayment
    expect(statementStatus(s, 0, '2026-12-06')).toBe('overdue');
    expect(statementStatus(s, 3000, '2026-12-06')).toBe('overdue');
    expect(statementStatus(s, 0, '2026-12-05')).toBe('closed'); // the due day itself is still on time
  });

  it('a statement with nothing owed (or a balance in favor) is paid', () => {
    expect(statementStatus(stmt({ calculatedBalance: 0 }), 0, '2027-01-01')).toBe('paid');
    expect(statementStatus(stmt({ calculatedBalance: -50 }), 0, '2027-01-01')).toBe('paid');
  });

  it('the bank figure wins over the calculated one', () => {
    const s = stmt({ bankBalance: 8200, bankMinimum: 650 });
    expect(amountPaid(s, 8000)).toBe(8000);
    expect(remainingOf(s, 8000)).toBe(200);
    expect(statementStatus(s, 8000, '2026-11-20')).toBe('partial');
    expect(interestGap(s)).toBe(200);
  });

  it('reversing a payment (reversed status) puts the statement back', () => {
    const p = pay(8000, '2026-11-20', { id: 'p1' });
    expect(statementStatus(stmt(), paymentsAfter(accounts, [p], 'visa', 'DOP', '2026-11-15'), '2026-11-21')).toBe('paid');
    const reversed = [{ ...p, status: 'reversed' as const }];
    expect(statementStatus(stmt(), paymentsAfter(accounts, reversed, 'visa', 'DOP', '2026-11-15'), '2026-11-21')).toBe('closed');
  });

  it('no gap when the bank charged less or the same', () => {
    expect(interestGap(stmt({ bankBalance: 7900 }))).toBe(0);
    expect(interestGap(stmt())).toBe(0);
  });
});

describe('consumption vs paid (rules 2 and 3)', () => {
  const accounts = [bank, visa];

  it('the purchase counts once, on its day; the payment is settlement, not consumption', () => {
    const txs = [buy(5000, '2026-11-03'), pay(5000, '2026-11-20')];
    expect(consumptionOf(accounts, txs, 'visa', 'DOP', '2026-10-16', '2026-11-15')).toEqual({ consumption: 5000, paid: 0 });
    expect(consumptionOf(accounts, txs, 'visa', 'DOP', '2026-11-16', '2026-12-15')).toEqual({ consumption: 0, paid: 5000 });
  });

  it('reversed purchases do not count as consumption', () => {
    const txs = [buy(700, '2026-11-01', { status: 'reversed' })];
    expect(consumptionOf(accounts, txs, 'visa', 'DOP', '2026-10-16', '2026-11-15').consumption).toBe(0);
  });
});

describe('alerts', () => {
  const stmt = (due: string, over: Partial<CardStatementModel> = {}): CardStatementModel => ({
    id: `s-${due}`,
    accountId: 'visa',
    currency: 'DOP',
    periodStart: '2026-10-16',
    periodEnd: '2026-11-15',
    cutDate: '2026-11-15',
    dueDate: due,
    previousBalance: 0,
    purchases: 8000,
    charges: 0,
    payments: 0,
    credits: 0,
    calculatedBalance: 8000,
    calculatedMinimum: 500,
    generatedAt: 'x',
    ...over,
  });
  const run = (statements: CardStatementModel[], today: string, paid = 0, card = visa) =>
    cardAlerts([{ card, statements, paidAfter: () => paid }], today);

  it('cut: 3 days before and on the day, with no statement needed', () => {
    expect(run([], '2026-11-12').map((a) => a.stage)).toEqual(['cut-3']);
    expect(run([], '2026-11-13').map((a) => a.stage)).toEqual(['cut-3']);
    expect(run([], '2026-11-15').map((a) => a.stage)).toEqual(['cut-today']);
    expect(run([], '2026-11-11')).toEqual([]);
    expect(run([], '2026-11-16')).toEqual([]);
  });

  it('cut across a month change and in a short month', () => {
    const c31 = { ...visa, card: { ...CONFIG, cutDay: 31 } };
    expect(run([], '2026-02-26', 0, c31).map((a) => a.daysLeft)).toEqual([2]);
    expect(run([], '2026-12-31', 0, c31).map((a) => a.stage)).toEqual(['cut-today']);
    expect(run([], '2026-12-28', 0, { ...visa, card: { ...CONFIG, cutDay: 1 } })).toEqual([]);
    expect(run([], '2026-12-29', 0, { ...visa, card: { ...CONFIG, cutDay: 1 } }).map((a) => a.stage)).toEqual(['cut-3']); // across the year
    expect(run([], '2026-12-30', 0, { ...visa, card: { ...CONFIG, cutDay: 2 } }).map((a) => a.stage)).toEqual(['cut-3']);
  });

  it('due: 7, 3 and 1 days before, then overdue, with the amounts', () => {
    const s = stmt('2026-12-05');
    const stage = (today: string) => run([s], today).find((a) => a.stage.startsWith('due') || a.stage === 'overdue')?.stage;
    expect(stage('2026-11-27')).toBeUndefined();
    expect(stage('2026-11-28')).toBe('due-7');
    expect(stage('2026-12-02')).toBe('due-3');
    expect(stage('2026-12-04')).toBe('due-1');
    expect(stage('2026-12-05')).toBe('due-1');
    expect(stage('2026-12-06')).toBe('overdue');
    const a = run([s], '2026-12-04', 3000).find((x) => x.stage === 'due-1')!;
    expect(a).toMatchObject({ balance: 5000, minimum: 500, daysLeft: 1 });
  });

  it('no due alert once the statement is paid', () => {
    expect(run([stmt('2026-12-05')], '2026-12-04', 8000)).toEqual([]);
  });

  it('a card without data produces no alert and does not break', () => {
    const bare = account({ id: 'visa', type: 'card', cardKind: 'credit' });
    expect(run([], '2026-11-13', 0, bare)).toEqual([]);
  });

  it('an unpaid old statement stays overdue', () => {
    expect(run([stmt('2026-11-01')], '2026-11-20').map((a) => a.stage)).toContain('overdue');
  });
});

describe('notices planned for the device', () => {
  const s: CardStatementModel = {
    id: 's1',
    accountId: 'visa',
    currency: 'DOP',
    periodStart: '2026-10-16',
    periodEnd: '2026-11-15',
    cutDate: '2026-11-15',
    dueDate: '2026-12-05',
    previousBalance: 0,
    purchases: 100,
    charges: 0,
    payments: 0,
    credits: 0,
    calculatedBalance: 100,
    calculatedMinimum: 50,
    generatedAt: 'x',
  };

  it('plans the cut (3 days and the day) and each due reminder (7, 3, 1), none in the past', () => {
    const n = plannedNotices([{ card: visa, statements: [s], paidAfter: () => 0 }], '2026-11-10', 30);
    const at = n.map((x) => `${x.kind}@${x.at}`);
    expect(at).toEqual(expect.arrayContaining(['cut@2026-11-12', 'cut@2026-11-15', 'due@2026-11-28', 'due@2026-12-02', 'due@2026-12-04']));
    expect(n.every((x) => x.at >= '2026-11-10')).toBe(true);
    expect(n.every((x) => x.at <= '2026-12-10')).toBe(true);
    expect(new Set(n.map((x) => x.key)).size).toBe(n.length);
  });

  it('plans no due reminders for a paid statement', () => {
    const n = plannedNotices([{ card: visa, statements: [s], paidAfter: () => 100 }], '2026-11-10', 30);
    expect(n.some((x) => x.kind === 'due')).toBe(false);
  });
});

describe('rule 3: an expense that was really the card payment is found, never converted on its own', () => {
  const s: CardStatementModel = {
    id: 's1',
    accountId: 'visa',
    currency: 'DOP',
    periodStart: '2026-10-16',
    periodEnd: '2026-11-15',
    cutDate: '2026-11-15',
    dueDate: '2026-12-05',
    previousBalance: 0,
    purchases: 8000,
    charges: 0,
    payments: 0,
    credits: 0,
    calculatedBalance: 8000,
    calculatedMinimum: 500,
    generatedAt: 'x',
  };
  const accounts = [bank, visa];
  const find = (txs: ReturnType<typeof transaction>[], dismissed: string[] = []) => detectCardPaymentExpenses(txs, accounts, [s], () => 0, dismissed);

  it('an expense from the bank equal to the statement balance or the minimum, after the cut', () => {
    const bills = transaction({ id: 'e1', type: 'expense', amount: 8000, accountId: 'bank', date: '2026-11-25', categoryId: 'cat-bills' });
    expect(find([bills]).map((x) => x.expenseId)).toEqual(['e1']);
    const min = transaction({ id: 'e2', type: 'expense', amount: 500, accountId: 'bank', date: '2026-11-25' });
    expect(find([min]).map((x) => x.expenseId)).toEqual(['e2']);
  });

  it('does not suggest purchases on a card, other amounts, other currencies, old dates or dismissed ones', () => {
    const base = { type: 'expense' as const, accountId: 'bank', date: '2026-11-25', amount: 8000 };
    expect(find([transaction({ ...base, accountId: 'visa' })])).toEqual([]);
    expect(find([transaction({ ...base, amount: 8001 })])).toEqual([]);
    expect(find([transaction({ ...base, currency: 'USD' })])).toEqual([]);
    expect(find([transaction({ ...base, date: '2026-11-10' })])).toEqual([]);
    expect(find([transaction({ ...base, date: '2027-01-10' })])).toEqual([]);
    expect(find([transaction({ ...base, status: 'reversed' })])).toEqual([]);
    expect(find([transaction({ ...base, id: 'd1' })], ['cardpay:d1'])).toEqual([]);
  });

  it('nothing to suggest when the statement is already paid', () => {
    const e = transaction({ type: 'expense', amount: 8000, accountId: 'bank', date: '2026-11-25' });
    expect(detectCardPaymentExpenses([e], accounts, [s], () => 8000)).toEqual([]);
  });
});

describe('small purchases (one rule for the month and for a card)', () => {
  it('relative rule by default, ceiling when given, empty list safe', () => {
    expect(smallPurchases([])).toEqual({ count: 0, total: 0, percent: 0, threshold: 0 });
    const amounts = [50, 80, 120, 5000, 4750];
    expect(smallPurchases(amounts)).toMatchObject({ count: 3, total: 250, threshold: 200, percent: 3 });
    expect(smallPurchases(amounts, 100)).toMatchObject({ count: 2, total: 130, threshold: 100 });
    expect(smallPurchases([0.1, 0.2], 1)).toMatchObject({ total: 0.3 });
  });
});
