// Prompt 02 (v2.8.0): credit cards end to end on the real services. These are the scenarios
// that protect integrity rules 2 (a card purchase is ONE expense) and 3 (paying the card is a
// settlement, not a second expense), plus statements, bank figures, alerts and the old shape.
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, vi } from 'vitest';
import { MemoryStorage, boot } from '../testing/memory-storage';
import { account } from '../testing/builders';
import { CardConfig } from '../models/account.model';
import { TxResult } from '../domain/validation';
import { CARD_INTEREST_CATEGORY } from '../domain/cards';
import { CreditCardService } from './credit-card.service';
import { InsightsService } from './insights.service';
import { SuggestionsService } from './suggestions.service';
import { AuditLogService } from './audit-log.service';

const CONFIG: CardConfig = { creditLimit: 50000, cutDay: 15, dueMode: 'days-after', dueDays: 20, minPercent: 5, minFloor: 500 };
const bank = account({ id: 'bank', name: 'Bank', type: 'bank', initialBalance: 100000 });
const visa = account({ id: 'visa', name: 'Visa', type: 'card', cardKind: 'credit', initialBalance: 0, liquid: false, card: CONFIG });
const dual = account({ id: 'dual', name: 'Dual', type: 'card', cardKind: 'credit', currency: 'dual', initialBalance: 0, liquid: false, card: { ...CONFIG, creditLimitUsd: 2000 } });
const usdBank = account({ id: 'usdbank', name: 'USD bank', type: 'bank', currency: 'USD', initialBalance: 1000 });

function session(accounts = [bank, visa, dual, usdBank], extra: Record<string, unknown> = {}) {
  const s = boot(new MemoryStorage().seed({ accounts, ...extra }));
  return { ...s, cards: TestBed.inject(CreditCardService), insights: TestBed.inject(InsightsService), suggestions: TestBed.inject(SuggestionsService) };
}
type S = ReturnType<typeof session>;
const id = (r: TxResult) => {
  if (!r.ok) throw new Error(`rejected: ${r.error}`);
  return r.id;
};
const buy = (s: S, amount: number, date: string, extra: Record<string, unknown> = {}) =>
  id(s.transactions.add({ type: 'expense', amount, accountId: 'visa', date, categoryId: 'cat-shopping', ...extra }));
const payFromBank = (s: S, amount: number, date: string) =>
  id(s.cards.pay({ cardId: 'visa', fromAccountId: 'bank', amount, date, currency: 'DOP' }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-20T12:00:00'));
});
afterEach(() => vi.useRealTimers());

describe('rules 2 and 3: purchase with the card + payment of the card', () => {
  it('purchase of 5,000 and payment of 5,000: the month has ONE expense of 5,000, the bank is -5,000, the card owes 0', () => {
    const s = session();
    buy(s, 5000, '2026-11-03');
    payFromBank(s, 5000, '2026-11-20');
    expect(s.transactions.monthSummary(2026, 11)).toEqual({ income: 0, expense: 5000 });
    expect(s.transactions.accountBalance('bank')).toBe(95000);
    expect(s.cards.debtOf(visa, 'DOP').owed).toBe(0);
    expect(s.transactions.accountBalance('visa')).toBe(0);
    // the payment is not a category expense either
    expect(s.transactions.categoryTotals(2026, 11, 'expense')).toEqual([{ categoryId: 'cat-shopping', total: 5000 }]);
    // and net worth did not change by paying: it only changed by the purchase
    expect(s.transactions.totalBalance()).toBe(95000);
  });

  it('the payment is a transfer with origin card-payment, on the paying account and the card history', () => {
    const s = session();
    buy(s, 5000, '2026-11-03');
    const p = s.transactions.byId(payFromBank(s, 2000, '2026-11-20'))!;
    expect(p).toMatchObject({ type: 'transfer', origin: 'card-payment', accountId: 'bank', toAccountId: 'visa' });
    expect(s.cards.movementsIn('visa', 'DOP', '2026-11-01', '2026-11-30').map((t) => t.id)).toContain(p.id);
  });

  it('partial payment: the debt goes down only by what was paid, the expense stays at 5,000', () => {
    const s = session();
    buy(s, 5000, '2026-11-03');
    payFromBank(s, 1200.5, '2026-11-20');
    expect(s.cards.debtOf(visa, 'DOP').owed).toBe(3799.5);
    expect(s.transactions.monthSummary(2026, 11).expense).toBe(5000);
    expect(s.transactions.accountBalance('bank')).toBe(98799.5);
  });

  it('paying more than owed leaves a balance in your favor; still no extra expense', () => {
    const s = session();
    buy(s, 1000, '2026-11-03');
    payFromBank(s, 1500, '2026-11-20');
    expect(s.cards.debtOf(visa, 'DOP')).toMatchObject({ owed: 0, inFavor: 500 });
    expect(s.transactions.monthSummary(2026, 11).expense).toBe(1000);
  });

  it('a dual card: a US$ purchase affects only the US$ side and is paid from a US$ account', () => {
    const s = session();
    id(s.transactions.add({ type: 'expense', amount: 150, currency: 'USD', accountId: 'dual', date: '2026-11-03', categoryId: 'cat-shopping' }));
    expect(s.cards.debtOf(dual, 'USD').owed).toBe(150);
    expect(s.cards.debtOf(dual, 'DOP').owed).toBe(0);
    expect(s.transactions.monthSummary(2026, 11).expense).toBe(0); // stats are RD$ only, as before
    id(s.cards.pay({ cardId: 'dual', fromAccountId: 'usdbank', amount: 150, date: '2026-11-20', currency: 'USD' }));
    expect(s.cards.debtOf(dual, 'USD').owed).toBe(0);
    expect(s.transactions.accountBalance('usdbank', 'USD')).toBe(850);
    // RD$ and US$ are never mixed: paying US$ from a RD$ account is rejected
    const bad = s.cards.pay({ cardId: 'dual', fromAccountId: 'bank', amount: 10, date: '2026-11-20', currency: 'USD' });
    expect(bad).toEqual({ ok: false, error: 'currency' });
  });

  it('a reversed purchase: expense gone, debt gone, consumption zero', () => {
    const s = session();
    const p = buy(s, 700, '2026-11-18');
    id(s.transactions.reverse(p));
    expect(s.cards.debtOf(visa, 'DOP').owed).toBe(0);
    expect(s.transactions.countedForMonth(2026, 11)).toEqual([]);
    expect(s.cards.unbilled(s.accounts.byId('visa')!, 'DOP')!.consumption.consumption).toBe(0);
  });

  it('interest and charges of the bank are a real expense (the cost of credit), once', () => {
    const s = session();
    buy(s, 10000, '2026-11-03');
    s.cards.ensureStatements();
    const st = s.cards.statementsOf('visa')[0];
    expect(st.calculatedBalance).toBe(10000);
    // the bank says 10,350: 350 of interest and charges the user had not recorded
    expect(s.cards.setBankFigures(st.id, { balance: 10350, minimum: 800 })).toBe(true);
    expect(s.cards.gapOf(s.cards.byId(st.id)!)).toBe(350);
    const tx = id(s.cards.registerInterest(st.id));
    expect(s.transactions.byId(tx)).toMatchObject({ type: 'expense', amount: 350, accountId: 'visa', categoryId: CARD_INTEREST_CATEGORY, date: '2026-11-15' });
    expect(s.transactions.monthSummary(2026, 11).expense).toBe(10350);
    expect(s.cards.debtOf(visa, 'DOP').owed).toBe(10350); // now the app agrees with the bank
    // it cannot be registered twice
    expect(s.cards.registerInterest(st.id)).toEqual({ ok: false, error: 'changed' });
    expect(s.transactions.monthSummary(2026, 11).expense).toBe(10350);
    expect(s.cards.interestRegistered(s.cards.byId(st.id)!)).toBe(true);
  });
});

describe('statements', () => {
  it('closes the periods whose cut arrived, from the movements, once and with a stable id', () => {
    const s = session();
    buy(s, 10000, '2026-10-20');
    buy(s, 2000, '2026-11-15');
    buy(s, 999, '2026-11-16'); // next period
    s.cards.ensureStatements();
    s.cards.ensureStatements(); // idempotent
    const list = s.cards.statementsOf('visa');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'stmt-visa-DOP-2026-11-15', purchases: 12000, calculatedBalance: 12000, dueDate: '2026-12-05', calculatedMinimum: 600 });
    expect(s.storage.get<unknown[]>('statements', [])).toHaveLength(1);
  });

  it('the next boot reads them back and does not duplicate them', () => {
    const s = session();
    buy(s, 10000, '2026-10-20');
    s.cards.ensureStatements();
    const again = boot(s.storage);
    const cards = TestBed.inject(CreditCardService);
    cards.ensureStatements();
    expect(cards.statements()).toHaveLength(1);
    expect(again.storage).toBe(s.storage);
  });

  it('catches up the cuts that passed while the app was closed (after the first statement)', () => {
    const s = session();
    buy(s, 1000, '2026-08-10');
    vi.setSystemTime(new Date('2026-08-20T12:00:00'));
    s.cards.ensureStatements();
    expect(s.cards.statementsOf('visa').map((x) => x.cutDate)).toEqual(['2026-08-15']);
    buy(s, 500, '2026-09-20');
    vi.setSystemTime(new Date('2026-11-20T12:00:00'));
    s.cards.ensureStatements();
    expect(s.cards.statementsOf('visa').map((x) => x.cutDate)).toEqual(['2026-11-15', '2026-10-15', '2026-09-15', '2026-08-15']);
    // balances are cumulative: nothing was paid, so each closes with everything owed
    expect(s.cards.statementsOf('visa').map((x) => x.calculatedBalance)).toEqual([1500, 1500, 1000, 1000]);
  });

  it('a card with no cut data (the 2.7.0 shape) keeps working and produces no statements, alerts or errors', () => {
    const old = account({ id: 'visa', name: 'Old Visa', type: 'card', cardKind: 'credit', initialBalance: 0, liquid: false });
    const s = session([bank, old]);
    buy(s, 3000, '2026-11-03');
    s.cards.ensureStatements();
    expect(s.cards.statements()).toEqual([]);
    expect(s.cards.alerts()).toEqual([]);
    expect(s.cards.incompleteCards().map((c) => c.id)).toEqual(['visa']);
    expect(s.cards.debtOf(old, 'DOP')).toMatchObject({ owed: 3000, limit: undefined, available: undefined });
    expect(s.transactions.accountBalance('visa')).toBe(-3000);
  });

  it('completing the data on an old card closes its latest statement right away', () => {
    const old = account({ id: 'visa', name: 'Old Visa', type: 'card', cardKind: 'credit', initialBalance: 0, liquid: false });
    const s = session([bank, old]);
    buy(s, 3000, '2026-11-03');
    s.cards.setConfig('visa', CONFIG);
    expect(s.cards.incompleteCards()).toEqual([]);
    expect(s.cards.statementsOf('visa')[0]).toMatchObject({ calculatedBalance: 3000, cutDate: '2026-11-15' });
    expect(s.accounts.byId('visa')!.card).toEqual(CONFIG); // kept in the account, synced with it
    expect(TestBed.inject(AuditLogService).events().some((e) => e.type === 'card-config')).toBe(true);
  });

  it('a period with no activity creates no statement', () => {
    const s = session();
    s.cards.ensureStatements();
    expect(s.cards.statements()).toEqual([]);
  });

  it('the bank figures replace the calculated ones and nothing is adjusted silently', () => {
    const s = session();
    buy(s, 10000, '2026-11-03');
    s.cards.ensureStatements();
    const st = s.cards.statementsOf('visa')[0];
    const before = s.transactions.transactions().length;
    s.cards.setBankFigures(st.id, { balance: 10400 });
    expect(s.transactions.transactions().length).toBe(before);
    expect(s.transactions.accountBalance('visa')).toBe(-10000);
    expect(s.cards.remainingOf(s.cards.byId(st.id)!)).toBe(10400);
    expect(s.cards.setBankFigures(st.id, { balance: -5 })).toBe(false);
    expect(s.cards.setBankFigures(st.id, { balance: null })).toBe(true); // back to the calculated one
    expect(s.cards.remainingOf(s.cards.byId(st.id)!)).toBe(10000);
  });

  it('a payment settles the oldest open statement first; status follows, and reversing the payment puts it back', () => {
    const s = session();
    buy(s, 10000, '2026-10-20');
    s.cards.ensureStatements();
    const st = s.cards.statementsOf('visa')[0];
    expect(s.cards.statusOf(st)).toBe('closed');
    expect(s.cards.oldestOpen('visa', 'DOP')?.id).toBe(st.id);
    const p1 = payFromBank(s, 4000, '2026-11-20');
    expect(s.cards.statusOf(st)).toBe('partial');
    expect(s.cards.remainingOf(st)).toBe(6000);
    payFromBank(s, 6000, '2026-11-20');
    expect(s.cards.statusOf(st)).toBe('paid');
    expect(s.cards.oldestOpen('visa', 'DOP')).toBeUndefined();
    id(s.transactions.reverse(p1));
    expect(s.cards.statusOf(st)).toBe('partial'); // 6,000 of 10,000 paid again
    expect(s.cards.remainingOf(st)).toBe(4000);
  });

  it('turns overdue after the due date', () => {
    const s = session();
    buy(s, 10000, '2026-10-20');
    s.cards.ensureStatements();
    const st = s.cards.statementsOf('visa')[0];
    vi.setSystemTime(new Date('2026-12-06T12:00:00'));
    expect(s.cards.statusOf(st)).toBe('overdue');
  });

  it('recalculating picks up a late entry and keeps the bank figures', () => {
    const s = session();
    buy(s, 10000, '2026-10-20');
    s.cards.ensureStatements();
    const st = s.cards.statementsOf('visa')[0];
    s.cards.setBankFigures(st.id, { balance: 10500 });
    buy(s, 300, '2026-11-01'); // entered late, belongs to the closed period
    s.cards.recalculate(st.id);
    expect(s.cards.byId(st.id)).toMatchObject({ calculatedBalance: 10300, bankBalance: 10500 });
  });
});

describe('alerts and utilization through the service', () => {
  it('raises the cut and due alerts and drops the due ones once paid', () => {
    const s = session();
    buy(s, 10000, '2026-10-20');
    s.cards.ensureStatements();
    vi.setSystemTime(new Date('2026-12-03T12:00:00'));
    s.cards.ensureStatements();
    const stages = s.cards.alerts().map((a) => a.stage);
    expect(stages).toContain('due-3');
    expect(s.cards.alerts().find((a) => a.stage === 'due-3')).toMatchObject({ balance: 10000, minimum: 500 });
    payFromBank(s, 10000, '2026-12-03');
    expect(s.cards.alerts().map((a) => a.stage)).not.toContain('due-3');
  });

  it('utilization per card and consolidated, from the same debt as the balance', () => {
    const s = session();
    buy(s, 15000, '2026-11-03');
    expect(s.cards.utilization(visa)).toEqual({ percent: 30, level: 'warn' });
    const total = s.cards.consolidated('DOP');
    expect(total).toMatchObject({ owed: 15000, limit: 100000 }); // visa 50,000 + dual 50,000
    expect(s.cards.totalOwed()).toEqual({ DOP: 15000, USD: 0 });
  });

  it('per-card thresholds are used', () => {
    const custom = account({ id: 'visa', type: 'card', cardKind: 'credit', liquid: false, card: { ...CONFIG, warnAt: 50, dangerAt: 70 } });
    const s = session([bank, custom]);
    buy(s, 15000, '2026-11-03');
    expect(s.cards.utilization(custom).level).toBe('ok');
    buy(s, 25000, '2026-11-04');
    expect(s.cards.utilization(custom).level).toBe('danger');
  });
});

describe('card view: consumption of the period and small purchases', () => {
  it('"not yet billed" shows the purchases of the open period and the payments made in it', () => {
    const s = session();
    buy(s, 3000, '2026-11-18');
    buy(s, 40, '2026-11-19');
    payFromBank(s, 1000, '2026-11-20');
    const v = s.cards.unbilled(s.accounts.byId('visa')!, 'DOP')!;
    expect(v.period).toEqual({ start: '2026-11-16', end: '2026-12-15', cut: '2026-12-15' });
    expect(v.consumption).toEqual({ consumption: 3040, paid: 1000 });
  });

  it('small purchases of ONE card and period, with the same rule as the monthly insight', () => {
    const s = session();
    for (let i = 0; i < 6; i++) buy(s, 50, `2026-11-0${i + 1}`);
    buy(s, 9000, '2026-11-09');
    s.transactions.add({ type: 'expense', amount: 60, accountId: 'bank', date: '2026-11-10', categoryId: 'cat-food' }); // other account
    const card = s.insights.antExpensesFor({ accountId: 'visa', from: '2026-10-16', to: '2026-11-15' });
    expect(card).toMatchObject({ count: 6, total: 300 });
    expect(card.percent).toBe(3);
    const month = s.insights.antExpenses(2026, 11);
    expect(month.count).toBe(7); // the bank purchase counts in the month, not in the card
    expect(s.insights.antExpensesFor({ accountId: 'visa', from: '2026-10-16', to: '2026-11-15', ceiling: 40 }).count).toBe(0);
  });
});

describe('rule 3 for payments that were typed as a plain expense', () => {
  it('suggests converting it; once confirmed the purchases are no longer counted twice, and it can be undone', () => {
    const s = session();
    buy(s, 8000, '2026-10-20');
    s.cards.ensureStatements();
    // the user paid the card from the bank and recorded it as a "Bills" expense
    const e = id(s.transactions.add({ type: 'expense', amount: 8000, accountId: 'bank', date: '2026-11-25', categoryId: 'cat-bills' }));
    vi.setSystemTime(new Date('2026-11-26T12:00:00'));
    expect(s.transactions.monthSummary(2026, 11).expense).toBe(8000); // only the bills one in November...
    expect(s.transactions.monthSummary(2026, 10).expense).toBe(8000); // ...and the purchase in October: double counted
    const [suggestion] = s.suggestions.cardPayments();
    expect(suggestion).toMatchObject({ expenseId: e, cardId: 'visa', amount: 8000 });
    // nothing happened on its own
    expect(s.transactions.byId(e)?.type).toBe('expense');

    id(s.suggestions.convertCardPayment(suggestion));
    expect(s.transactions.byId(e)).toMatchObject({ type: 'transfer', toAccountId: 'visa', origin: 'card-payment' });
    expect(s.transactions.byId(e)?.categoryId).toBeUndefined();
    expect(s.transactions.monthSummary(2026, 11).expense).toBe(0);
    expect(s.transactions.accountBalance('bank')).toBe(92000);
    expect(s.cards.debtOf(visa, 'DOP').owed).toBe(0);
    expect(s.cards.statusOf(s.cards.statementsOf('visa')[0])).toBe('paid');
    expect(s.suggestions.cardPayments()).toEqual([]);

    const event = TestBed.inject(AuditLogService).events().find((x) => x.type === 'card-payment-convert')!;
    id(s.transactions.undoCardPaymentConversion(event.id));
    expect(s.transactions.byId(e)).toMatchObject({ type: 'expense', categoryId: 'cat-bills', accountId: 'bank' });
    expect(s.transactions.byId(e)?.toAccountId).toBeUndefined();
  });

  it('a dismissed suggestion is not offered again', () => {
    const s = session();
    buy(s, 8000, '2026-10-20');
    s.cards.ensureStatements();
    s.transactions.add({ type: 'expense', amount: 8000, accountId: 'bank', date: '2026-11-25', categoryId: 'cat-bills' });
    const [suggestion] = s.suggestions.cardPayments();
    s.suggestions.dismissCardPayment(suggestion);
    expect(s.suggestions.cardPayments()).toEqual([]);
  });

  it('a reconciled expense is never converted', () => {
    const s = session();
    const e = id(s.transactions.add({ type: 'expense', amount: 8000, accountId: 'bank', date: '2026-11-25', categoryId: 'cat-bills' }));
    s.transactions.setReconciled([e], true);
    expect(s.transactions.convertToCardPayment(e, 'visa')).toEqual({ ok: false, error: 'reconciled' });
  });
});

describe('synchronization of statements', () => {
  it('statements are a synced collection and two devices build the same id', () => {
    const a = session();
    buy(a, 10000, '2026-10-20');
    a.cards.ensureStatements();
    const b = session([bank, visa, dual, usdBank], { transactions: a.storage.get('transactions', []) });
    b.cards.ensureStatements();
    expect(b.cards.statements().map((x) => x.id)).toEqual(a.cards.statements().map((x) => x.id));
  });
});
