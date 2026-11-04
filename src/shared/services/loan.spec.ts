// Prompt 08 (v2.14.0) on the real services: the disbursement is not income, a payment splits into
// principal (not an expense) and interest and charges (an expense), what is owed is derived, extra
// payments recompute the schedule, everything is reversible, and the loans reach net worth, the
// dashboard, the budget and the emergency fund. Capacity never reads non-monetary benefits (rule 4).
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, vi } from 'vitest';
import { MemoryStorage, boot } from '../testing/memory-storage';
import { cashSnapshot } from '../testing/non-cash-guard';
import { account } from '../testing/builders';
import { isSyncedKey } from '../data-layer/registry';
import { parseBackup } from '../data-layer/backup';
import { LoanInput } from '../domain/loans';
import { AuditLogService } from './audit-log.service';
import { BenefitService } from './benefit.service';
import { BorrowingService } from './borrowing.service';
import { BudgetService } from './budget.service';
import { DashboardService } from './dashboard.service';
import { GoalService } from './goal.service';
import { IncomeService } from './income.service';
import { LoanResult, LoanService } from './loan.service';
import { NetWorthService } from './net-worth.service';

const bank = account({ id: 'bank', name: 'Bank', type: 'bank', initialBalance: 100000 });
const cash = account({ id: 'cash', name: 'Cash', type: 'cash', initialBalance: 5000 });
const usd = account({ id: 'usd', name: 'Dollars', type: 'bank', currency: 'USD', initialBalance: 100 });
const card = account({ id: 'card', name: 'Visa', type: 'card', cardKind: 'credit', initialBalance: 0, card: { limit: 50000 } as never });
const payroll = { id: 'pay', name: 'Pay', kind: 'payroll', icon: 'x', color: '#000', active: true, stability: 'recurring', schedule: { mode: 'month-days', days: [15, 30] }, method: 'transfer', verifiability: 'documented', expectedNet: 30000, createdAt: 'x' };

const input: LoanInput = { amount: 120000, rate: { value: 18, type: 'nominal' }, method: 'french', termMonths: 12, frequency: 'monthly', firstDate: '2026-12-15' };

function session(extra: Record<string, unknown> = {}) {
  const s = boot(new MemoryStorage().seed({ accounts: [bank, cash, usd, card], incomeSources: [payroll], ...extra }));
  return {
    ...s,
    loans: TestBed.inject(LoanService),
    borrowing: TestBed.inject(BorrowingService),
    dashboard: TestBed.inject(DashboardService),
    netWorth: TestBed.inject(NetWorthService),
    goals: TestBed.inject(GoalService),
    budget: TestBed.inject(BudgetService),
    income: TestBed.inject(IncomeService),
    benefits: TestBed.inject(BenefitService),
    audit: TestBed.inject(AuditLogService),
  };
}
type S = ReturnType<typeof session>;
const id = (r: LoanResult) => {
  if (!r.ok) throw new Error(`rejected: ${r.error}`);
  return r.id;
};
const register = (s: S, over: Partial<Parameters<LoanService['register']>[0]> = {}) =>
  id(s.loans.register({ input, name: 'Car loan', lender: 'Bank', disbursementAccountId: 'bank', payAccountId: 'bank', disbursementDate: '2026-11-18', ...over }));
const balance = (s: S, accountId = 'bank') => s.transactions.accountBalance(accountId, 'DOP');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-20T12:00:00'));
});
afterEach(() => vi.useRealTimers());

describe('the disbursement is not income', () => {
  it('the money enters the account, creates a liability, and income, expenses and net worth do not move', () => {
    const s = session();
    const netBefore = s.netWorth.summary().net.DOP;
    const month = s.transactions.monthSummary(2026, 11);
    const l = s.loans.byId(register(s))!;
    expect(balance(s)).toBe(220000);
    expect(s.transactions.monthSummary(2026, 11)).toEqual(month); // no income, no expense
    expect(s.income.monthBreakdown(2026, 11).personalNet).toBe(0);
    expect(s.income.monthBreakdown(2026, 11).unclassified).toBe(0);
    expect(s.loans.owed(l)).toBe(120000);
    expect(s.netWorth.summary().loanDebt.DOP).toBe(120000);
    expect(s.netWorth.summary().net.DOP).toBe(netBefore); // +120,000 cash, -120,000 debt
    const tx = s.transactions.transactions().find((t) => t.linkedId === l.disbursementLinkedId)!;
    expect(tx).toMatchObject({ type: 'income', origin: 'loan-disbursement', amount: 120000 });
  });

  it('is not a recurring-income suggestion and not "unclassified income" either', () => {
    const s = session();
    register(s);
    expect(s.income.monthBreakdown(2026, 11).unclassified).toBe(0);
    expect(s.income.monthBreakdown(2026, 11).available).toBe(0);
  });

  it('the schedule is saved and the registry keeps every cent: principal adds up to the amount', () => {
    const s = session();
    const l = s.loans.byId(register(s))!;
    expect(l.schedule).toHaveLength(12);
    expect(l.schedule.reduce((sum, r) => sum + r.principal, 0)).toBeCloseTo(120000, 2);
    expect(l.debt).toBe(120000);
    expect(l.status).toBe('active');
  });

  it('charges paid at the start are a real expense; a financed commission makes the debt bigger than the cash', () => {
    const s = session();
    const l = s.loans.byId(register(s, { input: { ...input, costs: { commission: { mode: 'percent', value: 2, financed: false }, others: [{ amount: 600, recurring: false }] } } }))!;
    expect(s.transactions.monthSummary(2026, 11).expense).toBe(3000); // 2,400 + 600
    expect(balance(s)).toBe(100000 + 120000 - 3000);
    const f = s.loans.byId(register(s, { name: 'Financed', input: { ...input, costs: { commission: { mode: 'percent', value: 5, financed: true } } } }))!;
    expect(f.debt).toBe(126000);
    expect(f.amount).toBe(120000);
    expect(s.loans.totalOwed()).toBe(l.debt + 126000);
  });

  it('is all or nothing and refuses cards, US$ accounts and bad data', () => {
    const s = session();
    const count = s.transactions.transactions().length;
    expect(s.loans.register({ input, name: 'x', disbursementAccountId: 'card', payAccountId: 'bank', disbursementDate: '2026-11-18' })).toEqual({ ok: false, error: 'account' });
    expect(s.loans.register({ input, name: 'x', disbursementAccountId: 'usd', payAccountId: 'bank', disbursementDate: '2026-11-18' })).toEqual({ ok: false, error: 'account' });
    expect(s.loans.register({ input, name: '  ', disbursementAccountId: 'bank', payAccountId: 'bank', disbursementDate: '2026-11-18' })).toEqual({ ok: false, error: 'name' });
    expect(s.loans.register({ input: { ...input, amount: 0 }, name: 'x', disbursementAccountId: 'bank', payAccountId: 'bank', disbursementDate: '2026-11-18' })).toEqual({ ok: false, error: 'amount' });
    expect(s.transactions.transactions()).toHaveLength(count);
    expect(s.loans.loans()).toEqual([]);
  });
});

describe('a payment splits: principal is not an expense, interest and charges are', () => {
  it('pays the installment with the amount prefilled; the expense is only the interest and charges', () => {
    const s = session();
    const lid = register(s);
    const l = s.loans.byId(lid)!;
    const row = l.schedule[0];
    const before = s.transactions.monthSummary(2026, 12);
    id(s.loans.pay(lid, { amount: row.payment, date: '2026-12-15' }));
    expect(balance(s)).toBe(220000 - row.payment);
    const month = s.transactions.monthSummary(2026, 12);
    expect(month.expense - before.expense).toBeCloseTo(row.interest + row.fees, 2); // the principal is NOT spending
    expect(month.income).toBe(before.income);
    expect(s.loans.owed(s.loans.byId(lid)!)).toBeCloseTo(120000 - row.principal, 2);
    const txs = s.transactions.transactions().filter((t) => t.linkedId === s.loans.byId(lid)!.payments[0].linkedId);
    expect(txs.map((t) => t.origin).sort()).toEqual(['loan-payment', 'loan-principal']);
    expect(txs.find((t) => t.origin === 'loan-payment')!.categoryId).toBe('cat-loan-interest');
    expect(s.loans.next(s.loans.byId(lid)!)!.n).toBe(2);
  });

  it('net worth only drops by what the lender charged, never by the principal repaid', () => {
    const s = session();
    const lid = register(s);
    const netBefore = s.netWorth.summary().net.DOP;
    const row = s.loans.byId(lid)!.schedule[0];
    id(s.loans.pay(lid, { amount: row.payment, date: '2026-12-15' }));
    expect(netBefore - s.netWorth.summary().net.DOP).toBeCloseTo(row.interest + row.fees, 2);
  });

  it('a partial payment covers interest and charges first and leaves the installment pending; a second one completes it', () => {
    const s = session();
    const lid = register(s);
    const row = s.loans.byId(lid)!.schedule[0];
    id(s.loans.pay(lid, { amount: 500, date: '2026-12-10' }));
    let l = s.loans.byId(lid)!;
    expect(l.payments[0]).toMatchObject({ kind: 'partial', interest: 500, principal: 0 });
    expect(s.loans.next(l)!.n).toBe(1);
    expect(s.loans.remaining(l, 1)).toBeCloseTo(row.payment - 500, 2);
    expect(s.loans.owed(l)).toBe(120000); // nothing of the principal was paid yet
    id(s.loans.pay(lid, { amount: s.loans.remaining(l, 1), date: '2026-12-15' }));
    l = s.loans.byId(lid)!;
    expect(s.loans.next(l)!.n).toBe(2);
    expect(s.loans.owed(l)).toBeCloseTo(120000 - row.principal, 2);
    expect(l.payments.reduce((sum, p) => sum + p.amount, 0)).toBeCloseTo(row.payment, 2);
  });

  it('cannot pay more than what is left on the installment, nothing, or an unknown one', () => {
    const s = session();
    const lid = register(s);
    const row = s.loans.byId(lid)!.schedule[0];
    expect(s.loans.pay(lid, { amount: row.payment + 1 })).toEqual({ ok: false, error: 'exceeds' });
    expect(s.loans.pay(lid, { amount: 0 })).toEqual({ ok: false, error: 'amount' });
    expect(s.loans.pay(lid, { amount: 10, installment: 99 })).toEqual({ ok: false, error: 'no-installment' });
    expect(s.loans.pay('nope', { amount: 10 })).toEqual({ ok: false, error: 'not-found' });
    expect(s.loans.pay(lid, { amount: 10, accountId: 'usd' })).toEqual({ ok: false, error: 'account' });
  });

  it('an advance payment of a later installment is allowed and flagged; the schedule does not change', () => {
    const s = session();
    const lid = register(s);
    const schedule = s.loans.byId(lid)!.schedule;
    id(s.loans.pay(lid, { amount: schedule[1].payment, installment: 2, date: '2026-11-25' }));
    const l = s.loans.byId(lid)!;
    expect(l.payments[0].kind).toBe('advance');
    expect(l.schedule).toEqual(schedule);
    expect(s.loans.next(l)!.n).toBe(1);
  });

  it('paying every installment closes the loan with zero owed', () => {
    const s = session();
    const lid = register(s);
    for (const r of s.loans.byId(lid)!.schedule) id(s.loans.pay(lid, { amount: r.payment, date: r.date }));
    const l = s.loans.byId(lid)!;
    expect(l.status).toBe('paid');
    expect(s.loans.owed(l)).toBe(0);
    expect(s.netWorth.summary().loanDebt.DOP).toBe(0);
    expect(s.loans.pay(lid, { amount: 10 })).toEqual({ ok: false, error: 'inactive' });
    expect(s.loans.alerts()).toEqual([]);
  });
});

describe('extra payment to principal', () => {
  it('reduce term: the installment stays, the end date moves up, the interest saved is real and the schedule is audited', () => {
    const s = session();
    const lid = register(s);
    const old = s.loans.byId(lid)!.schedule;
    id(s.loans.pay(lid, { amount: old[0].payment, date: '2026-12-15' }));
    id(s.loans.payExtra(lid, { amount: 30000, mode: 'reduce-term', date: '2026-12-20' }));
    const l = s.loans.byId(lid)!;
    expect(l.schedule.length).toBeLessThan(12);
    expect(l.schedule[1].payment).toBeCloseTo(old[1].payment, 1);
    expect(l.schedule[0]).toEqual(old[0]);
    expect(s.loans.owed(l)).toBeCloseTo(120000 - old[0].principal - 30000, 2);
    expect(l.schedule.reduce((sum, r) => sum + r.principal, 0)).toBeCloseTo(120000 - 30000, 1);
    // the extra payment is principal only: no expense
    const extra = l.payments[1];
    expect(extra).toMatchObject({ kind: 'extra', installment: null, interest: 0, principal: 30000 });
    expect(s.audit.events().some((e) => e.type === 'loan-payment')).toBe(true);
    for (const r of l.schedule.slice(1)) id(s.loans.pay(lid, { amount: r.payment, date: r.date }));
    expect(s.loans.byId(lid)!.status).toBe('paid');
    expect(s.loans.owed(s.loans.byId(lid)!)).toBe(0);
  });

  it('reduce installment: same number of installments, a lighter one', () => {
    const s = session();
    const lid = register(s);
    const old = s.loans.byId(lid)!.schedule;
    id(s.loans.pay(lid, { amount: old[0].payment, date: '2026-12-15' }));
    id(s.loans.payExtra(lid, { amount: 30000, mode: 'reduce-installment' }));
    const l = s.loans.byId(lid)!;
    expect(l.schedule).toHaveLength(12);
    expect(l.schedule[1].payment).toBeLessThan(old[1].payment);
  });

  it('is refused for a flat-rate loan, a partly paid installment and an amount that clears the debt', () => {
    const s = session();
    const flat = register(s, { name: 'Flat', input: { ...input, rate: { value: 12, type: 'flat' }, method: 'flat' } });
    expect(s.loans.payExtra(flat, { amount: 1000, mode: 'reduce-term' })).toEqual({ ok: false, error: 'method-rate' });
    const lid = register(s);
    id(s.loans.pay(lid, { amount: 400, date: '2026-12-10' }));
    expect(s.loans.payExtra(lid, { amount: 1000, mode: 'reduce-term' })).toEqual({ ok: false, error: 'partial-pending' });
    const l2 = register(s, { name: 'Other' });
    expect(s.loans.payExtra(l2, { amount: 120000, mode: 'reduce-term' })).toEqual({ ok: false, error: 'exceeds' });
  });
});

describe('everything is reversible and audited', () => {
  it('reversing a payment restores balance, debt and the pending installment; the movements stay in the history', () => {
    const s = session();
    const lid = register(s);
    const row = s.loans.byId(lid)!.schedule[0];
    const before = cashSnapshot(2026, 12);
    const pid = id(s.loans.pay(lid, { amount: row.payment, date: '2026-12-15' }));
    id(s.loans.reversePayment(lid, pid));
    const l = s.loans.byId(lid)!;
    expect(l.payments[0].reversed).toBe(true);
    expect(s.loans.owed(l)).toBe(120000);
    expect(s.loans.next(l)!.n).toBe(1);
    expect(balance(s)).toBe(220000);
    const after = cashSnapshot(2026, 12);
    expect(after.totalBalance).toBe(before.totalBalance);
    expect(after.monthSummary).toEqual(before.monthSummary); // the reversed pair counts for nothing
    expect(s.transactions.transactions().filter((t) => t.linkedId === l.payments[0].linkedId).every((t) => t.status === 'reversed')).toBe(true);
    expect(s.loans.reversePayment(lid, pid)).toEqual({ ok: false, error: 'already-reversed' });
    expect(s.audit.events().filter((e) => e.type === 'loan-payment').length).toBeGreaterThanOrEqual(2);
  });

  it('reversing an extra payment restores the old schedule; order rules protect the history', () => {
    const s = session();
    const lid = register(s);
    const old = s.loans.byId(lid)!.schedule;
    const p1 = id(s.loans.pay(lid, { amount: old[0].payment, date: '2026-12-15' }));
    const x = id(s.loans.payExtra(lid, { amount: 30000, mode: 'reduce-term' }));
    // a regular payment cannot be undone under an extra payment
    expect(s.loans.reversePayment(lid, p1)).toEqual({ ok: false, error: 'later-payments' });
    id(s.loans.reversePayment(lid, x));
    expect(s.loans.byId(lid)!.schedule).toEqual(old);
    expect(s.loans.owed(s.loans.byId(lid)!)).toBeCloseTo(120000 - old[0].principal, 2);
    id(s.loans.reversePayment(lid, p1));
    expect(s.loans.owed(s.loans.byId(lid)!)).toBe(120000);
    // and an extra cannot be undone while a payment came after it
    const p1b = id(s.loans.pay(lid, { amount: old[0].payment, date: '2026-12-15' }));
    const x2 = id(s.loans.payExtra(lid, { amount: 10000, mode: 'reduce-term' }));
    const l = s.loans.byId(lid)!;
    id(s.loans.pay(lid, { amount: l.schedule[1].payment, date: '2027-01-15' }));
    expect(s.loans.reversePayment(lid, x2)).toEqual({ ok: false, error: 'later-payments' });
    expect(p1b).toBeTruthy();
  });

  it('a loan without payments can be undone: the disbursement is reversed and nothing is owed', () => {
    const s = session();
    const lid = register(s);
    id(s.loans.undo(lid));
    expect(s.loans.byId(lid)!.status).toBe('voided');
    expect(balance(s)).toBe(100000);
    expect(s.loans.totalOwed()).toBe(0);
    expect(s.transactions.monthSummary(2026, 11).income).toBe(0);
    const l2 = register(s, { name: 'Second' });
    id(s.loans.pay(l2, { amount: 100, date: '2026-12-10' }));
    expect(s.loans.undo(l2)).toEqual({ ok: false, error: 'later-payments' });
  });
});

describe('alerts, net worth and the dashboard', () => {
  it('alerts at 7 days, 3 days, 1 day and overdue, inside the app', () => {
    const s = session();
    register(s);
    expect(s.loans.alerts()).toEqual([]); // the first installment is 25 days away
    for (const [today, stage] of [
      ['2026-12-08', 'due-7'],
      ['2026-12-12', 'due-3'],
      ['2026-12-14', 'due-1'],
      ['2026-12-16', 'overdue'],
    ] as const) {
      vi.setSystemTime(new Date(`${today}T12:00:00`));
      boot(s.storage);
      expect(TestBed.inject(LoanService).alerts()[0]?.stage).toBe(stage);
    }
  });

  it('"Pending debts" adds cards and loans and is no longer hidden; the loan is a liability in net worth', () => {
    const s = session();
    expect(s.dashboard.byId('debts')!.value).toBe(0);
    const lid = register(s);
    const debts = s.dashboard.byId('debts')!;
    expect(debts).toMatchObject({ available: true, value: 120000 });
    expect(debts.components.find((c) => c.label === 'Loans')).toMatchObject({ amount: 120000 });
    const nw = s.dashboard.byId('net-worth')!;
    expect(nw.components.find((c) => c.label === 'Loans')).toMatchObject({ amount: -120000 });
    id(s.loans.pay(lid, { amount: s.loans.byId(lid)!.schedule[0].payment, date: '2026-12-15' }));
    expect(s.dashboard.byId('debts')!.value).toBeLessThan(120000);
  });

  it('available money subtracts the installments due in 30 days; the cash flow carries the schedule', () => {
    const s = session();
    const availableBefore = s.dashboard.byId('available')!.value!;
    const flowBefore = s.dashboard.cashflow().summaries.find((x) => x.days === 90)!.mid;
    const lid = register(s);
    const rows = s.loans.byId(lid)!.schedule;
    // +120,000 arrived; the December installment (due in 25 days) is already set aside
    expect(s.dashboard.byId('available')!.value!).toBeCloseTo(availableBefore + 120000 - rows[0].payment, 2);
    expect(s.dashboard.byId('available')!.components.find((c) => c.label === 'Loan installments due in 30 days')).toMatchObject({ amount: -rows[0].payment });
    // 90 days: the December, January and February installments
    const flowAfter = s.dashboard.cashflow().summaries.find((x) => x.days === 90)!.mid;
    expect(flowAfter).toBeCloseTo(flowBefore + 120000 - (rows[0].payment + rows[1].payment + rows[2].payment), 0);
  });
});

describe('budget, emergency fund and capacity', () => {
  it('the budget block "Debt payments" reflects the real loan payments of the month', () => {
    const s = session();
    const lid = register(s);
    const row = s.loans.byId(lid)!.schedule[0];
    const rowOf = () => s.budget.bucketRows(2026, 12).find((r) => r.bucket.kind === 'debt-payments')!;
    expect(rowOf().spent).toBe(0);
    vi.setSystemTime(new Date('2026-12-16T12:00:00'));
    id(s.loans.pay(lid, { amount: row.payment, date: '2026-12-15' }));
    expect(rowOf().spent).toBeCloseTo(row.payment, 2);
  });

  it('the loan interest category belongs to the essential block and is a counted expense', () => {
    const s = session();
    const lid = register(s);
    const row = s.loans.byId(lid)!.schedule[0];
    vi.setSystemTime(new Date('2026-12-16T12:00:00'));
    id(s.loans.pay(lid, { amount: row.payment, date: '2026-12-15' }));
    const essential = s.budget.bucketRows(2026, 12).find((r) => r.bucket.kind === 'essential')!;
    expect(essential.spent).toBeCloseTo(row.interest + row.fees, 2);
  });

  it('the emergency fund base includes the loan installments', () => {
    const s = session();
    expect(s.goals.debtPayments()).toBe(0);
    register(s);
    expect(s.goals.debtPayments()).toBeCloseTo(s.loans.loans()[0].schedule[0].payment, 2);
  });

  it('capacity: existing debts include the installments, the simulated one is added, and it is an estimate', () => {
    const s = session();
    const first = s.borrowing.evaluate(10000);
    expect(first.obligations.debts).toBe(0);
    expect(first.readings[0].income).toBe(60000); // documented payroll only
    expect(first.estimate).toBe(true);
    register(s);
    const second = s.borrowing.evaluate(10000);
    expect(second.obligations.debts).toBeCloseTo(s.loans.loans()[0].schedule[0].payment, 2);
    expect(second.rows[0].availableAfter).toBeLessThan(first.rows[0].availableAfter);
  });

  it('with fewer than 3 months of history it uses the declared variable spending and says so', () => {
    const s = session();
    expect(s.borrowing.obligations().variableBasis).toBe('declared');
    expect(s.loans.updateSettings({ declaredVariable: 12000 })).toBe(true);
    expect(s.borrowing.obligations().variable).toBe(12000);
  });

  it('RULE 4: non-monetary benefits never enter the capacity, any reading, any income level', () => {
    const s = session();
    const before = s.borrowing.evaluate(10000);
    const snap = cashSnapshot(2026, 11);
    const b = s.benefits.add({ name: 'Fuel card', kind: 'fuel-card', provider: 'Employer', monthlyValue: 50000, monthlyLimit: 60000, active: true });
    if (!b.ok) throw new Error('benefit');
    s.benefits.addUse(b.id, { date: '2026-11-03', amount: 2500 });
    expect(s.borrowing.evaluate(10000)).toEqual(before);
    expect(s.borrowing.tiers()).toEqual({ salary: 60000, bonuses: 0, commercial: 0, declared: 0 });
    expect(cashSnapshot(2026, 11)).toEqual(snap);
    expect(s.dashboard.byId('available')!.components.find((c) => c.label === 'Non-monetary benefits')).toMatchObject({ kind: 'excluded' });
  });

  it('settings: switches, discount and thresholds are validated and kept', () => {
    const s = session();
    expect(s.loans.updateSettings({ commercialDiscount: 30, comfortable: 30, tight: 45 })).toBe(true);
    expect(s.loans.settings()).toMatchObject({ commercialDiscount: 30, comfortable: 30, tight: 45 });
    expect(s.loans.updateSettings({ comfortable: 60, tight: 40 })).toBe(false);
    expect(s.loans.updateSettings({ commercialDiscount: 120 })).toBe(false);
    expect(s.loans.updateSettings({ switches: { salary: false } as never })).toBe(true);
    expect(s.borrowing.evaluate(1000).readings[0].income).toBe(0);
    expect(boot(s.storage).storage.get<{ commercialDiscount: number }>('loanSettings', {} as never).commercialDiscount).toBe(30);
  });
});

describe('saved simulations, backup and sync', () => {
  it('a simulation can be named, listed and removed', () => {
    const s = session();
    const sid = id(s.loans.saveSimulation('Bank A 500k', { ...input, amount: 500000 }));
    expect(s.loans.simulations()).toHaveLength(1);
    expect(s.loans.simulations()[0]).toMatchObject({ name: 'Bank A 500k', amount: 500000 });
    expect(s.loans.saveSimulation(' ', input)).toEqual({ ok: false, error: 'name' });
    expect(s.loans.saveSimulation('bad', { ...input, amount: 0 })).toEqual({ ok: false, error: 'amount' });
    s.loans.removeSimulation(sid);
    expect(s.loans.simulations()).toEqual([]);
  });

  it('loans are synced collections; they travel in backups; an old backup without them imports fine', () => {
    for (const k of ['loans', 'loanSimulations', 'loanSettings']) expect(isSyncedKey(k)).toBe(true);
    expect(parseBackup(JSON.stringify({ app: 'x-money', schemaVersion: 4, accounts: [bank] })).ok).toBe(true);
    expect(parseBackup(JSON.stringify({ app: 'x-money', schemaVersion: 4, loans: [{ id: 'l', name: 'x', amount: 1 }] }))).toMatchObject({ ok: false, error: { key: 'loans', field: 'schedule' } });
    const s = session();
    const lid = register(s);
    id(s.loans.pay(lid, { amount: s.loans.byId(lid)!.schedule[0].payment, date: '2026-12-15' }));
    s.loans.saveSimulation('Offer', input);
    s.loans.updateSettings({ commercialDiscount: 25 });
    const backup = s.settings.exportData();
    s.settings.wipeData();
    expect(boot(s.storage).settings.importData(backup).ok).toBe(true);
    boot(s.storage);
    const again = TestBed.inject(LoanService);
    expect(again.loans()).toHaveLength(1);
    expect(again.loans()[0].payments).toHaveLength(1);
    expect(again.simulations()).toHaveLength(1);
    expect(again.settings().commercialDiscount).toBe(25);
    expect(again.totalOwed()).toBeCloseTo(120000 - again.loans()[0].schedule[0].principal, 2);
  });
});
