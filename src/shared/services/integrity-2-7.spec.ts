// Prompt 01 (v2.7.0): trace fields, reversals, corrections, atomic groups, conversions,
// reconciliation, audit, net worth, suggestions, rules 1/2/3/9 and ledger invariants.
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, vi } from 'vitest';
import { MemoryStorage, boot } from '../testing/memory-storage';
import { account, transaction } from '../testing/builders';
import { AUDIT_LIMIT, AuditLogService } from './audit-log.service';
import { NetWorthService } from './net-worth.service';
import { ReconciliationService } from './reconciliation.service';
import { SuggestionsService } from './suggestions.service';
import { TxResult } from '../domain/validation';
import { round2 } from '../utils/money';

const NOW = '2026-11-03T12:00:00';
const bank = account({ id: 'bank', name: 'Bank', type: 'bank', initialBalance: 10000 });
const cash = account({ id: 'cash', name: 'Cash', type: 'cash', initialBalance: 500 });
const card = account({ id: 'card', name: 'Visa', type: 'card', cardKind: 'credit', initialBalance: 0, liquid: false });
const usdAcc = account({ id: 'usd', name: 'USD', type: 'bank', currency: 'USD', initialBalance: 100 });

function session(extra: Record<string, unknown> = {}, accounts = [bank, cash, card, usdAcc]) {
  return boot(new MemoryStorage().seed({ accounts, ...extra }));
}
const idOf = (r: TxResult) => {
  if (!r.ok) throw new Error(`rejected: ${r.error}`);
  return r.id;
};
const audit = (s: ReturnType<typeof session>) => s.storage.get<{ type: string; entityId: string; before?: any; after?: any; origin: string; deviceId: string }[]>('audit', []);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => vi.useRealTimers());

describe('trace fields (schema v2)', () => {
  it('stamps origin, status and timestamps on every new movement', () => {
    const s = session();
    const id = idOf(s.transactions.add({ type: 'expense', amount: 10, accountId: 'cash', date: '2026-11-03', categoryId: 'cat-food' }));
    expect(s.transactions.byId(id)).toMatchObject({ origin: 'manual', status: 'posted', createdAt: '2026-11-03T16:00:00.000Z', updatedAt: '2026-11-03T16:00:00.000Z' });
    const t = idOf(s.transactions.add({ type: 'transfer', amount: 10, accountId: 'bank', toAccountId: 'cash', date: '2026-11-03' }));
    expect(s.transactions.byId(t)?.origin).toBe('transfer');
  });

  it('a transfer to a credit card is a card payment (rule 3)', () => {
    const s = session();
    const id = idOf(s.transactions.add({ type: 'transfer', amount: 100, accountId: 'bank', toAccountId: 'card', date: '2026-11-03' }));
    expect(s.transactions.byId(id)?.origin).toBe('card-payment');
  });

  it('an edit changes updatedAt but not createdAt, origin of special movements or links', () => {
    const s = session();
    const id = idOf(s.transactions.add({ type: 'expense', amount: 10, accountId: 'cash', date: '2026-11-03', categoryId: 'cat-food', origin: 'import' }));
    vi.setSystemTime(new Date('2026-11-03T15:00:00'));
    const created = s.transactions.byId(id)!;
    idOf(s.transactions.update({ ...created, amount: 12, createdAt: 'forged', origin: 'manual', linkedId: 'x' }));
    const edited = s.transactions.byId(id)!;
    expect(edited).toMatchObject({ amount: 12, origin: 'import', createdAt: created.createdAt, updatedAt: '2026-11-03T19:00:00.000Z' });
    expect(edited.linkedId).toBeUndefined();
  });
});

describe('reversals (rule 9: nothing is deleted, balances stay consistent)', () => {
  it('reversing an expense adds the inverse, keeps both, leaves the balance as it was and out of statistics', () => {
    const s = session();
    const id = idOf(s.transactions.add({ type: 'expense', amount: 300, accountId: 'bank', date: '2026-11-03', categoryId: 'cat-food' }));
    expect(s.transactions.accountBalance('bank')).toBe(9700);
    const inverseId = idOf(s.transactions.reverse(id));

    const original = s.transactions.byId(id)!;
    const inverse = s.transactions.byId(inverseId)!;
    expect(original).toMatchObject({ status: 'reversed', reversedBy: inverseId });
    expect(inverse).toMatchObject({ status: 'reversed', origin: 'reversal', reversalOf: id, type: 'income', amount: 300 });
    expect(s.transactions.transactions()).toHaveLength(2); // both visible
    expect(s.transactions.accountBalance('bank')).toBe(10000);
    expect(s.transactions.monthSummary(2026, 11)).toEqual({ income: 0, expense: 0 });
    expect(s.transactions.categoryTotals(2026, 11, 'expense')).toEqual([]);
    expect(s.transactions.countedForMonth(2026, 11)).toEqual([]);
  });

  it('reversing a transfer restores both accounts; the fee the bank kept stays an expense', () => {
    const s = session();
    const id = idOf(s.transactions.add({ type: 'transfer', amount: 1000, fee: 2, accountId: 'bank', toAccountId: 'cash', date: '2026-11-03' }));
    expect(s.transactions.accountBalance('bank')).toBe(8998);
    idOf(s.transactions.reverse(id));
    expect(s.transactions.accountBalance('bank')).toBe(9998); // only the fee is gone
    expect(s.transactions.accountBalance('cash')).toBe(500);
    expect(s.transactions.monthSummary(2026, 11)).toEqual({ income: 0, expense: 2 });
  });

  it('never changes the date of other movements or reorders the history', () => {
    const s = session();
    const first = idOf(s.transactions.add({ type: 'expense', amount: 1, accountId: 'cash', date: '2026-10-01', categoryId: 'cat-food' }));
    idOf(s.transactions.add({ type: 'expense', amount: 2, accountId: 'cash', date: '2026-10-15', categoryId: 'cat-food' }));
    const datesBefore = s.transactions.transactions().map((t) => [t.id, t.date]);
    const inverse = idOf(s.transactions.reverse(first));
    for (const [id, date] of datesBefore) expect(s.transactions.byId(id as string)?.date).toBe(date);
    expect(s.transactions.byId(inverse)?.date).toBe('2026-11-03'); // dated when it was reversed
  });

  it('cannot reverse twice, cannot reverse a reversal, cannot edit or hard-delete a reversed pair', () => {
    const s = session();
    const id = idOf(s.transactions.add({ type: 'expense', amount: 5, accountId: 'cash', date: '2026-11-03', categoryId: 'cat-food' }));
    const inverse = idOf(s.transactions.reverse(id));
    expect(s.transactions.reverse(id)).toEqual({ ok: false, error: 'already-reversed' });
    expect(s.transactions.reverse(inverse)).toEqual({ ok: false, error: 'already-reversed' });
    expect(s.transactions.update({ ...s.transactions.byId(id)!, amount: 9 })).toEqual({ ok: false, error: 'reversed' });
    expect(s.transactions.remove(id)).toEqual({ ok: false, error: 'linked' });
    expect(s.transactions.remove(inverse)).toEqual({ ok: false, error: 'linked' });
    expect(s.transactions.reverse('missing')).toEqual({ ok: false, error: 'not-found' });
  });

  it('budgets and insights skip the reversed pair', () => {
    const s = session();
    const id = idOf(s.transactions.add({ type: 'expense', amount: 400, accountId: 'cash', date: '2026-11-03', categoryId: 'cat-food' }));
    idOf(s.transactions.add({ type: 'expense', amount: 100, accountId: 'cash', date: '2026-11-03', categoryId: 'cat-food' }));
    idOf(s.transactions.reverse(id));
    expect(s.transactions.monthSummary(2026, 11).expense).toBe(100);
    expect(s.transactions.accountBalance('cash')).toBe(400);
  });
});

describe('atomic groups and partial operations', () => {
  it('reversing or deleting one linked movement affects the whole group', () => {
    const s = session();
    const a = idOf(s.transactions.add({ type: 'expense', amount: 10, accountId: 'cash', date: '2026-11-03', categoryId: 'cat-food', linkedId: 'doc-1' }));
    const b = idOf(s.transactions.add({ type: 'income', amount: 10, accountId: 'cash', date: '2026-11-03', categoryId: 'cat-salary', linkedId: 'doc-1' }));
    idOf(s.transactions.reverse(a));
    expect(s.transactions.byId(a)?.status).toBe('reversed');
    expect(s.transactions.byId(b)?.status).toBe('reversed'); // the pair went together
    expect(s.transactions.transactions().filter((t) => t.origin === 'reversal')).toHaveLength(2);

    const c = idOf(s.transactions.add({ type: 'expense', amount: 1, accountId: 'cash', date: '2026-11-03', categoryId: 'cat-food', linkedId: 'doc-2' }));
    const d = idOf(s.transactions.add({ type: 'expense', amount: 2, accountId: 'cash', date: '2026-11-03', categoryId: 'cat-food', linkedId: 'doc-2' }));
    idOf(s.transactions.remove(c));
    expect(s.transactions.byId(c)).toBeUndefined();
    expect(s.transactions.byId(d)).toBeUndefined(); // deleted with its pair
  });

  it('parts of one operation never exceed the declared total', () => {
    const s = session();
    const part = (amount: number) => s.transactions.add({ type: 'transfer', amount, accountId: 'bank', toAccountId: 'card', date: '2026-11-03', linkedId: 'payment-1', groupTotal: 100 });
    expect(part(60.1).ok).toBe(true);
    expect(part(39.9).ok).toBe(true); // exactly the total, with no float noise
    expect(part(0.01)).toEqual({ ok: false, error: 'partial-exceeds' });
    // a reversed part frees its share
    const first = s.transactions.transactions().find((t) => t.amount === 60.1)!;
    idOf(s.transactions.reverse(first.id));
    expect(part(60.1).ok).toBe(true);
  });

  it('editing a part cannot push the group over its total', () => {
    const s = session();
    const a = idOf(s.transactions.add({ type: 'transfer', amount: 50, accountId: 'bank', toAccountId: 'card', date: '2026-11-03', linkedId: 'p', groupTotal: 100 }));
    idOf(s.transactions.add({ type: 'transfer', amount: 40, accountId: 'bank', toAccountId: 'card', date: '2026-11-03', linkedId: 'p', groupTotal: 100 }));
    expect(s.transactions.update({ ...s.transactions.byId(a)!, amount: 70 })).toEqual({ ok: false, error: 'partial-exceeds' });
    expect(s.transactions.update({ ...s.transactions.byId(a)!, amount: 60 }).ok).toBe(true);
  });
});

describe('corrections, reconciled movements and audit', () => {
  it('an edit is audited with the previous and the new value', () => {
    const s = session();
    const id = idOf(s.transactions.add({ type: 'expense', amount: 10, accountId: 'cash', date: '2026-11-03', categoryId: 'cat-food' }));
    idOf(s.transactions.update({ ...s.transactions.byId(id)!, amount: 25, note: 'fixed' }));
    const edit = audit(s).find((e) => e.type === 'edit')!;
    expect(edit.before).toMatchObject({ amount: 10 });
    expect(edit.after).toMatchObject({ amount: 25, note: 'fixed' });
    expect(edit.entityId).toBe(id);
  });

  it('a reconciled movement is not edited in place: it asks, then goes through reversal + new movement', () => {
    const s = session();
    const id = idOf(s.transactions.add({ type: 'expense', amount: 80, accountId: 'bank', date: '2026-11-02', categoryId: 'cat-food' }));
    s.transactions.setReconciled([id], true);

    expect(s.transactions.update({ ...s.transactions.byId(id)!, amount: 90 })).toEqual({ ok: false, error: 'reconciled' });
    expect(s.transactions.correct(id, { amount: 90 })).toEqual({ ok: false, error: 'reconciled' }); // needs confirmation
    const created = idOf(s.transactions.correct(id, { amount: 90 }, { confirmReconciled: true }));

    expect(s.transactions.byId(id)).toMatchObject({ status: 'reversed', amount: 80 }); // original kept
    expect(s.transactions.byId(created)).toMatchObject({ amount: 90, correctionOf: id, status: 'posted' });
    expect(s.transactions.accountBalance('bank')).toBe(9910); // 10000 - 90
    expect(s.transactions.monthSummary(2026, 11).expense).toBe(90);
    expect(audit(s).some((e) => e.type === 'reverse' && e.origin === 'correction')).toBe(true);
  });

  it('a normal movement is corrected in place', () => {
    const s = session();
    const id = idOf(s.transactions.add({ type: 'expense', amount: 80, accountId: 'bank', date: '2026-11-02', categoryId: 'cat-food' }));
    expect(idOf(s.transactions.correct(id, { amount: 85 }))).toBe(id);
    expect(s.transactions.byId(id)?.amount).toBe(85);
  });

  it('a reconciled movement cannot be hard-deleted', () => {
    const s = session();
    const id = idOf(s.transactions.add({ type: 'expense', amount: 80, accountId: 'bank', date: '2026-11-02', categoryId: 'cat-food' }));
    s.transactions.setReconciled([id], true);
    expect(s.transactions.remove(id)).toEqual({ ok: false, error: 'reconciled' });
  });

  it('hard delete is audited with what was deleted, and names the device', () => {
    const s = session();
    const id = idOf(s.transactions.add({ type: 'expense', amount: 7, accountId: 'cash', date: '2026-11-03', categoryId: 'cat-food' }));
    idOf(s.transactions.remove(id));
    const del = audit(s).find((e) => e.type === 'delete')!;
    expect(del.before).toMatchObject({ amount: 7 });
    expect(del.deviceId).toBe('unknown');
    expect(audit(s).map((e) => e.type)).toEqual(['create', 'delete']);
  });

  it('is append-only and capped: older events are trimmed and the trim is recorded', () => {
    const s = session();
    const log = TestBed.inject(AuditLogService);
    for (let i = 0; i < AUDIT_LIMIT + 5; i++) log.log({ type: 'edit', entity: 'transaction', entityId: `t${i}` });
    const events = log.events();
    expect(events.length).toBeLessThanOrEqual(AUDIT_LIMIT);
    expect(events[events.length - 1].type).toBe('audit-trim');
    expect(events.some((e) => e.type === 'audit-trim')).toBe(true);
    expect(events.find((e) => e.entityId === 't0')).toBeUndefined(); // the oldest went
    expect(events.find((e) => e.entityId === `t${AUDIT_LIMIT + 4}`)).toBeDefined(); // the newest stayed
    expect(s.storage.get<unknown[]>('audit', []).length).toBe(events.length);
  });
});

describe('transfers between own accounts (rule 1)', () => {
  it('is never income, expense, budget, statistic or insight', () => {
    const s = session({ budgets: [{ id: 'b', categoryId: 'cat-food', monthlyLimit: 100 }] });
    idOf(s.transactions.add({ type: 'transfer', amount: 5000, accountId: 'bank', toAccountId: 'cash', date: '2026-11-03' }));
    expect(s.transactions.monthSummary(2026, 11)).toEqual({ income: 0, expense: 0 });
    expect(s.transactions.yearSummary(2026)).toEqual({ income: 0, expense: 0 });
    expect(s.transactions.categoryTotals(2026, 11, 'expense')).toEqual([]);
    expect(s.transactions.categoryTotals(2026, 11, 'income')).toEqual([]);
    expect(s.transactions.totalBalance()).toBe(10500); // 10000 + 500: only money moved (US$ is separate)
    expect(TestBed.inject(NetWorthService).summary().liquid.DOP).toBe(10500);
  });

  it('RD$ to US$ transfers are blocked with a clear code, never converted', () => {
    const s = session();
    expect(s.transactions.add({ type: 'transfer', amount: 10, accountId: 'bank', toAccountId: 'usd', date: '2026-11-03' })).toEqual({ ok: false, error: 'cross-currency' });
    expect(s.transactions.add({ type: 'transfer', amount: 10, currency: 'USD', accountId: 'usd', toAccountId: 'bank', date: '2026-11-03' })).toEqual({ ok: false, error: 'cross-currency' });
  });

  it('the DGII fee of a transfer stays a separate real expense (decision: current behavior kept)', () => {
    const s = session();
    idOf(s.transactions.add({ type: 'transfer', amount: 1000, fee: 2, accountId: 'bank', toAccountId: 'cash', date: '2026-11-03' }));
    expect(s.transactions.monthSummary(2026, 11)).toEqual({ income: 0, expense: 2 });
    expect(s.transactions.categoryTotals(2026, 11, 'expense')).toEqual([{ categoryId: 'cat-bank-fees', total: 2 }]);
  });
});

describe('rules 2 and 3: credit cards', () => {
  it('a card purchase is one expense and a debt; the payment is a transfer that does not count again', () => {
    const s = session();
    idOf(s.transactions.add({ type: 'expense', amount: 3000, accountId: 'card', date: '2026-11-02', categoryId: 'cat-shopping' }));
    expect(s.transactions.monthSummary(2026, 11)).toEqual({ income: 0, expense: 3000 });
    const nw = TestBed.inject(NetWorthService);
    expect(nw.summary().cardDebt.DOP).toBe(3000);
    expect(nw.summary().net.DOP).toBe(7500); // 10500 liquid - 3000 debt

    const payment = idOf(s.transactions.add({ type: 'transfer', amount: 3000, accountId: 'bank', toAccountId: 'card', date: '2026-11-03' }));
    expect(s.transactions.byId(payment)?.origin).toBe('card-payment');
    expect(s.transactions.monthSummary(2026, 11)).toEqual({ income: 0, expense: 3000 }); // still once
    expect(nw.summary().cardDebt.DOP).toBe(0);
    expect(nw.summary().liquid.DOP).toBe(7500);
    expect(nw.summary().net.DOP).toBe(7500); // paying a debt with cash does not change net worth
  });

  it('a partial card payment leaves the remaining debt', () => {
    const s = session();
    idOf(s.transactions.add({ type: 'expense', amount: 1000, accountId: 'card', date: '2026-11-02', categoryId: 'cat-shopping' }));
    idOf(s.transactions.add({ type: 'transfer', amount: 400, accountId: 'bank', toAccountId: 'card', date: '2026-11-03' }));
    expect(TestBed.inject(NetWorthService).summary().cardDebt.DOP).toBe(600);
  });
});

describe('accounts: archive, liquid flag, other accounts, net worth', () => {
  it('"other" accounts keep their own emoji and are not liquid by default', () => {
    const s = session({}, [bank]);
    s.accounts.add({ name: 'Crypto', type: 'other', icon: '🪙', initialBalance: 700, currency: 'DOP' });
    const other = s.accounts.accounts().find((a) => a.name === 'Crypto')!;
    expect(other).toMatchObject({ icon: '🪙', liquid: false });
    s.accounts.update({ ...other, name: 'Crypto wallet' });
    expect(s.accounts.byId(other.id)?.icon).toBe('🪙');
    expect(TestBed.inject(NetWorthService).summary().liquid.DOP).toBe(10000); // not counted
    s.accounts.update({ ...s.accounts.byId(other.id)!, liquid: true });
    expect(TestBed.inject(NetWorthService).summary().liquid.DOP).toBe(10700);
  });

  it('archiving is audited and hides the account from selectors and totals', () => {
    const s = session();
    s.accounts.setArchived('cash', true);
    expect(s.accounts.activeAccounts().map((a) => a.id)).not.toContain('cash');
    expect(s.accounts.linkableAccounts().map((a) => a.id)).not.toContain('cash');
    expect(s.transactions.add({ type: 'expense', amount: 1, accountId: 'cash', date: '2026-11-03', categoryId: 'cat-food' })).toEqual({ ok: false, error: 'account-archived' });
    expect(TestBed.inject(NetWorthService).summary().rows.map((r) => r.accountId)).not.toContain('cash');
    expect(audit(s).map((e) => e.type)).toContain('account-archive');
  });

  it('liquid and total net worth are per currency and never mixed', () => {
    const s = session();
    idOf(s.transactions.add({ type: 'expense', amount: 30, currency: 'USD', accountId: 'usd', date: '2026-11-03', categoryId: 'cat-food' }));
    const nw = TestBed.inject(NetWorthService).summary();
    expect(nw.liquid).toEqual({ DOP: 10500, USD: 70 });
  });
});

describe('reconciliation', () => {
  it('shows the calculated balance at the statement date and never adjusts silently', () => {
    const s = session();
    idOf(s.transactions.add({ type: 'income', amount: 200, accountId: 'bank', date: '2026-10-05', categoryId: 'cat-salary' }));
    idOf(s.transactions.add({ type: 'expense', amount: 50, accountId: 'bank', date: '2026-10-20', categoryId: 'cat-food' }));
    idOf(s.transactions.add({ type: 'expense', amount: 999, accountId: 'bank', date: '2026-11-02', categoryId: 'cat-food' }));
    const recon = TestBed.inject(ReconciliationService);
    const view = recon.view('bank', 'DOP', '2026-10-31', 10100);
    expect(view.calculated).toBe(10150);
    expect(view.difference).toBe(-50);
    expect(view.pending.map((t) => t.amount)).toEqual([50, 200]);
    expect(s.transactions.accountBalance('bank')).toBe(9151); // nothing changed by looking
  });

  it('an adjustment is a visible movement, audited, outside income/expense, and closes the difference', () => {
    const s = session();
    const recon = TestBed.inject(ReconciliationService);
    const result = recon.createAdjustment('bank', 'DOP', '2026-11-03', -50)!;
    const id = idOf(result);
    expect(s.transactions.byId(id)).toMatchObject({ origin: 'adjustment', type: 'expense', amount: 50, categoryId: 'cat-recon-adjustment' });
    expect(s.transactions.accountBalance('bank')).toBe(9950); // balances include it
    expect(s.transactions.monthSummary(2026, 11)).toEqual({ income: 0, expense: 0 }); // statistics do not
    expect(recon.view('bank', 'DOP', '2026-11-03', 9950).difference).toBe(0);
    expect(audit(s).map((e) => e.type)).toEqual(expect.arrayContaining(['create', 'balance-adjustment']));
    expect(recon.createAdjustment('bank', 'DOP', '2026-11-03', 0)).toBeNull();
  });

  it('finishing marks the ticked movements and stamps the account; the next time starts from there', () => {
    const s = session();
    const a = idOf(s.transactions.add({ type: 'income', amount: 200, accountId: 'bank', date: '2026-10-05', categoryId: 'cat-salary' }));
    idOf(s.transactions.add({ type: 'expense', amount: 50, accountId: 'bank', date: '2026-10-20', categoryId: 'cat-food' }));
    const recon = TestBed.inject(ReconciliationService);
    recon.complete('bank', '2026-10-31', [a], 10150, 0);
    expect(s.transactions.byId(a)?.reconciled).toBe(true);
    expect(s.accounts.byId('bank')?.reconciledAt).toBe('2026-10-31');
    const later = idOf(s.transactions.add({ type: 'expense', amount: 5, accountId: 'bank', date: '2026-11-05', categoryId: 'cat-food' }));
    // the next reconciliation starts after the last one: only newer movements are listed
    expect(recon.view('bank', 'DOP', '2026-11-30', 10145).pending.map((t) => t.id)).toEqual([later]);
    expect(audit(s).map((e) => e.type)).toContain('reconcile');
  });
});

describe('suggestions: nothing happens without confirmation', () => {
  it('suggests a transfer and converts it only when asked; balances do not change; it is auditable and undoable', () => {
    const s = session();
    const e = idOf(s.transactions.add({ type: 'expense', amount: 5010, accountId: 'bank', date: '2026-11-01', categoryId: 'cat-other-expense' }));
    const i = idOf(s.transactions.add({ type: 'income', amount: 5000, accountId: 'cash', date: '2026-11-02', categoryId: 'cat-other-income' }));
    const suggestions = TestBed.inject(SuggestionsService);
    expect(suggestions.transfers()).toHaveLength(1);
    expect(s.transactions.transactions()).toHaveLength(2); // still untouched
    const balances = [s.transactions.accountBalance('bank'), s.transactions.accountBalance('cash'), s.transactions.totalBalance()];

    const converted = idOf(suggestions.convertTransfer(suggestions.transfers()[0]));
    expect(converted).toBe(e);
    expect(s.transactions.byId(e)).toMatchObject({ type: 'transfer', amount: 5000, fee: 10, toAccountId: 'cash', origin: 'transfer' });
    expect(s.transactions.byId(i)).toBeUndefined();
    expect([s.transactions.accountBalance('bank'), s.transactions.accountBalance('cash'), s.transactions.totalBalance()]).toEqual(balances);
    expect(s.transactions.monthSummary(2026, 11)).toEqual({ income: 0, expense: 10 }); // only the fee is an expense now
    expect(suggestions.transfers()).toHaveLength(0);

    const event = audit(s).find((x) => x.type === 'convert-transfer')!;
    expect(event.before.expense.id).toBe(e);
    const eventId = TestBed.inject(AuditLogService).events().find((x) => x.type === 'convert-transfer')!.id;
    idOf(s.transactions.undoConversion(eventId));
    expect(s.transactions.byId(e)).toMatchObject({ type: 'expense', amount: 5010 });
    expect(s.transactions.byId(i)).toMatchObject({ type: 'income', amount: 5000 });
    expect([s.transactions.accountBalance('bank'), s.transactions.accountBalance('cash')]).toEqual([balances[0], balances[1]]);
  });

  it('an undo is refused when the transfer changed since', () => {
    const s = session();
    idOf(s.transactions.add({ type: 'expense', amount: 100, accountId: 'bank', date: '2026-11-01', categoryId: 'cat-other-expense' }));
    idOf(s.transactions.add({ type: 'income', amount: 100, accountId: 'cash', date: '2026-11-01', categoryId: 'cat-other-income' }));
    const suggestions = TestBed.inject(SuggestionsService);
    const id = idOf(suggestions.convertTransfer(suggestions.transfers()[0]));
    idOf(s.transactions.update({ ...s.transactions.byId(id)!, amount: 120 }));
    const eventId = TestBed.inject(AuditLogService).events().find((x) => x.type === 'convert-transfer')!.id;
    expect(s.transactions.undoConversion(eventId)).toEqual({ ok: false, error: 'changed' });
  });

  it('a dismissed transfer suggestion does not come back', () => {
    const s = session();
    idOf(s.transactions.add({ type: 'expense', amount: 100, accountId: 'bank', date: '2026-11-01', categoryId: 'cat-other-expense' }));
    idOf(s.transactions.add({ type: 'income', amount: 100, accountId: 'cash', date: '2026-11-01', categoryId: 'cat-other-income' }));
    const suggestions = TestBed.inject(SuggestionsService);
    suggestions.dismissTransfer(suggestions.transfers()[0]);
    expect(suggestions.transfers()).toEqual([]);
    expect(s.settings.suggestions().transferDismissed).toHaveLength(1);
  });

  it('suggests a payroll, tags it only after confirmation and remembers the answer', () => {
    const s = session();
    const dates = ['2026-08-15', '2026-08-30', '2026-09-15', '2026-09-30', '2026-10-15', '2026-10-30'];
    for (const d of dates) idOf(s.transactions.add({ type: 'income', amount: 30000, accountId: 'bank', date: d, categoryId: 'cat-salary' }));
    const suggestions = TestBed.inject(SuggestionsService);
    expect(suggestions.incomes()).toHaveLength(1);
    expect(s.transactions.transactions().every((t) => t.incomePattern === undefined)).toBe(true);

    suggestions.confirmIncome(suggestions.incomes()[0]);
    expect(s.transactions.transactions().every((t) => t.incomePattern?.includes('biweekly'))).toBe(true);
    expect(suggestions.incomes()).toEqual([]);
    expect(s.settings.suggestions().incomeConfirmed).toHaveLength(1);
    expect(audit(s).map((e) => e.type)).toContain('income-pattern');
  });

  it('a dismissed income suggestion is remembered and nothing is tagged', () => {
    const s = session();
    for (const d of ['2026-08-30', '2026-09-30', '2026-10-31']) idOf(s.transactions.add({ type: 'income', amount: 50000, accountId: 'bank', date: d, categoryId: 'cat-salary' }));
    const suggestions = TestBed.inject(SuggestionsService);
    suggestions.dismissIncome(suggestions.incomes()[0]);
    expect(suggestions.incomes()).toEqual([]);
    expect(s.transactions.transactions().every((t) => t.incomePattern === undefined)).toBe(true);
  });
});

describe('validation at save (rule: integrity before screens)', () => {
  it('confirms dates more than a year ahead and accepts them after confirmation', () => {
    const s = session();
    const far = { type: 'expense' as const, amount: 10, accountId: 'cash', date: '2028-01-01', categoryId: 'cat-food' };
    expect(s.transactions.add(far)).toEqual({ ok: false, error: 'date-far-future' });
    expect(s.transactions.add(far, { confirmFarFuture: true }).ok).toBe(true);
  });

  it('rounds amounts and fees to cents when saving', () => {
    const s = session();
    const id = idOf(s.transactions.add({ type: 'expense', amount: 10.005, fee: 0.014, accountId: 'cash', date: '2026-11-03', categoryId: 'cat-food' }));
    expect(s.transactions.byId(id)).toMatchObject({ amount: 10.01, fee: 0.01 });
  });

  it('is read-only when the app is older than the data', () => {
    const s = session();
    s.storage.readOnly = () => true;
    expect(s.transactions.add({ type: 'expense', amount: 1, accountId: 'cash', date: '2026-11-03', categoryId: 'cat-food' })).toEqual({ ok: false, error: 'read-only' });
  });
});

// ---------------------------------------------------------------- invariants

// Deterministic generator (mulberry32): the same sequences on every run
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('ledger invariants over random sequences (fixed seeds)', () => {
  const ids = ['bank', 'cash', 'card'];
  const initial: Record<string, number> = { bank: 10000, cash: 500, card: 0 };

  // Independent recomputation in integer cents
  function expected(s: ReturnType<typeof session>) {
    const cents = (n: number) => Math.round(n * 100);
    const per: Record<string, number> = Object.fromEntries(ids.map((id) => [id, cents(initial[id])]));
    let income = 0;
    let expense = 0;
    let fees = 0;
    for (const t of s.transactions.transactions()) {
      if (t.currency === 'USD') continue;
      const amount = cents(t.amount);
      const fee = cents(t.fee ?? 0);
      per[t.accountId] -= fee;
      fees += fee;
      if (t.type === 'income') {
        per[t.accountId] += amount;
        income += amount;
      } else if (t.type === 'expense') {
        per[t.accountId] -= amount;
        expense += amount;
      } else {
        per[t.accountId] -= amount;
        per[t.toAccountId!] += amount;
      }
    }
    return { per, delta: income - expense - fees };
  }

  it.each([1, 7, 42, 2026, 31337])('seed %i: balances equal the recomputation after every operation, and transfers never move the total', (seed) => {
    const s = session({}, [bank, cash, card]);
    const rand = rng(seed);
    const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)];
    const amount = () => round2(Math.floor(rand() * 100000) / 100 + 0.01);

    for (let step = 0; step < 120; step++) {
      const all = s.transactions.transactions();
      const op = rand();
      if (op < 0.3) {
        s.transactions.add({ type: 'income', amount: amount(), accountId: pick(ids), date: '2026-11-03', categoryId: 'cat-salary', fee: rand() < 0.2 ? 1.25 : undefined });
      } else if (op < 0.55) {
        s.transactions.add({ type: 'expense', amount: amount(), accountId: pick(ids), date: '2026-11-03', categoryId: 'cat-food', fee: rand() < 0.2 ? 0.8 : undefined });
      } else if (op < 0.75) {
        const from = pick(ids);
        s.transactions.add({ type: 'transfer', amount: amount(), accountId: from, toAccountId: pick(ids.filter((x) => x !== from)), date: '2026-11-03', fee: rand() < 0.3 ? 2 : undefined });
      } else if (all.length) {
        const t = pick(all);
        if (op < 0.85) s.transactions.update({ ...t, amount: amount(), accountId: t.type === 'transfer' ? t.accountId : pick(ids) });
        else if (op < 0.93) s.transactions.reverse(t.id);
        else s.transactions.remove(t.id);
      }

      const { per, delta } = expected(s);
      for (const id of ids) expect(Math.round(s.transactions.accountBalance(id) * 100), `${id} at step ${step}`).toBe(per[id]);
      // the sum of all balances moves by exactly income - expense - fees; transfers do not count
      const total = Math.round(s.transactions.totalBalance() * 100);
      expect(total).toBe(Math.round((initial['bank'] + initial['cash'] + initial['card']) * 100) + delta);
    }
    // the sequence really exercised the service (not a vacuous pass)
    expect(s.transactions.transactions().length).toBeGreaterThan(20);
    expect(s.transactions.transactions().some((t) => t.status === 'reversed')).toBe(true);
  });

  it('the ledger gives the same numbers as the formulas of 2.5.1 on random data (no regression)', () => {
    // 2.5.1 formulas, copied from the old TransactionService
    const oldBalance = (accounts: any[], txs: any[], id: string, currency: string) => {
      const owner = (aid: string) => {
        const a = accounts.find((x) => x.id === aid);
        return a?.linkedAccountId && accounts.some((x) => x.id === a.linkedAccountId) ? a.linkedAccountId : aid;
      };
      const acc = accounts.find((x) => x.id === id);
      const initialCurrency = acc?.currency === 'USD' ? 'USD' : 'DOP';
      return txs.reduce((sum, t) => {
        if ((t.currency ?? 'DOP') !== currency) return sum;
        const from = owner(t.accountId);
        if (from === id) sum -= t.fee ?? 0;
        if (t.type === 'transfer') {
          const to = t.toAccountId ? owner(t.toAccountId) : undefined;
          if (from === id) sum -= t.amount;
          if (to === id) sum += t.amount;
          return sum;
        }
        if (from !== id) return sum;
        return sum + (t.type === 'income' ? t.amount : -t.amount);
      }, initialCurrency === currency ? acc?.initialBalance ?? 0 : 0);
    };
    const oldTotal = (accounts: any[], txs: any[], currency: string) => {
      const initial = accounts.reduce((sum, a) => ((a.currency === 'USD' ? 'USD' : 'DOP') === currency ? sum + a.initialBalance : sum), 0);
      return txs.reduce((sum, t) => {
        if ((t.currency ?? 'DOP') !== currency) return sum;
        sum -= t.fee ?? 0;
        if (t.type === 'income') return sum + t.amount;
        if (t.type === 'expense') return sum - t.amount;
        return sum;
      }, initial);
    };

    const rand = rng(99);
    const accounts = [
      bank,
      cash,
      card,
      usdAcc,
      account({ id: 'debit', type: 'card', cardKind: 'debit', linkedAccountId: 'bank', initialBalance: 0 }),
      account({ id: 'dual', type: 'card', cardKind: 'credit', currency: 'dual', initialBalance: 250 }),
    ];
    const txs: any[] = [];
    const ids2 = accounts.map((a) => a.id);
    for (let i = 0; i < 300; i++) {
      const type = ['income', 'expense', 'transfer'][Math.floor(rand() * 3)];
      const from = ids2[Math.floor(rand() * ids2.length)];
      const to = ids2[Math.floor(rand() * ids2.length)];
      txs.push({ id: `t${i}`, type, amount: Math.floor(rand() * 5000) / 100 + 1, accountId: from, toAccountId: type === 'transfer' ? to : undefined, currency: rand() < 0.3 ? 'USD' : undefined, fee: rand() < 0.2 ? 1.5 : undefined, date: '2026-11-03', status: 'posted' });
    }
    const s = session({ transactions: txs }, accounts);
    for (const currency of ['DOP', 'USD'] as const) {
      for (const a of accounts) {
        expect(round2(s.transactions.accountBalance(a.id, currency)), `${a.id} ${currency}`).toBeCloseTo(oldBalance(accounts, txs, a.id, currency), 6);
      }
    }
    expect(s.transactions.totalBalance()).toBeCloseTo(oldTotal(accounts, txs, 'DOP'), 6);
    expect(s.transactions.totalBalanceUsd()).toBeCloseTo(oldTotal(accounts, txs, 'USD'), 6);
  });
});
