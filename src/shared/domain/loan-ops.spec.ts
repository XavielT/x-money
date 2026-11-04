import { LoanModel, LoanPayment } from '../models/loan.model';
import { allocate, installmentsDue, loanAlerts, monthlyInstallments, nextInstallment, outstanding, paidThrough, reschedule } from './loan-ops';
import { LoanInput, quoteLoan } from './loans';

const input: LoanInput = { amount: 120000, rate: { value: 18, type: 'nominal' }, method: 'french', termMonths: 12, frequency: 'monthly', firstDate: '2026-12-15' };

function loan(over: Partial<LoanModel> = {}, i: LoanInput = input): LoanModel {
  const q = quoteLoan(i);
  return {
    id: 'l1',
    name: 'Car',
    amount: i.amount,
    debt: q.totals.principal,
    rate: i.rate,
    method: i.method,
    termMonths: i.termMonths,
    frequency: i.frequency,
    periods: q.periods,
    firstDate: i.firstDate,
    disbursementDate: '2026-11-15',
    disbursementAccountId: 'bank',
    payAccountId: 'bank',
    disbursementLinkedId: 'd',
    schedule: q.rows,
    payments: [],
    status: 'active',
    createdAt: '2026-11-15T00:00:00Z',
    ...over,
  };
}
const pay = (l: LoanModel, n: number, amount?: number, over: Partial<LoanPayment> = {}): LoanPayment => {
  const row = l.schedule[n - 1];
  const a = amount ?? row.payment;
  const s = allocate(row, 0, a);
  return { id: 'p' + n + Math.random(), date: row.date, installment: n, kind: 'regular', amount: a, ...s, linkedId: 'x' + n, ...over };
};

describe('splitting a payment', () => {
  const row = { n: 1, date: '2026-12-15', opening: 1000, principal: 700, interest: 200, fees: 100, payment: 1000, extra: 0, balance: 300 };

  it('interest first, then charges, then principal; the total is the amount paid', () => {
    expect(allocate(row, 0, 1000)).toEqual({ interest: 200, fees: 100, principal: 700 });
    expect(allocate(row, 0, 150)).toEqual({ interest: 150, fees: 0, principal: 0 });
    expect(allocate(row, 0, 250)).toEqual({ interest: 200, fees: 50, principal: 0 });
    expect(allocate(row, 0, 400)).toEqual({ interest: 200, fees: 100, principal: 100 });
  });

  it('a second partial payment continues where the first stopped', () => {
    const second = allocate(row, 250, 750);
    expect(second).toEqual({ interest: 0, fees: 50, principal: 700 });
    const a = allocate(row, 0, 250);
    expect(a.interest + a.fees + a.principal + second.interest + second.fees + second.principal).toBe(1000);
  });
});

describe('what is owed', () => {
  it('is the debt minus the principal paid; reversed payments count for nothing; paying all leaves zero', () => {
    const l = loan();
    expect(outstanding(l)).toBe(120000);
    const p1 = pay(l, 1);
    const withP1 = { ...l, payments: [p1] };
    expect(outstanding(withP1)).toBe(120000 - l.schedule[0].principal);
    expect(outstanding({ ...l, payments: [{ ...p1, reversed: true }] })).toBe(120000);
    const all = { ...l, payments: l.schedule.map((_, i) => pay(l, i + 1)) };
    expect(outstanding(all)).toBe(0);
    expect(outstanding({ ...l, status: 'voided' })).toBe(0);
  });

  it('the next installment is the first one not fully paid; a partial one stays next', () => {
    const l = loan();
    expect(nextInstallment(l)!.n).toBe(1);
    const partial = { ...l, payments: [pay(l, 1, 500)] };
    expect(nextInstallment(partial)!.n).toBe(1);
    expect(paidThrough(partial)).toBe(0);
    const paid1 = { ...l, payments: [pay(l, 1)] };
    expect(nextInstallment(paid1)!.n).toBe(2);
    expect(paidThrough(paid1)).toBe(1);
    expect(nextInstallment({ ...l, status: 'paid' })).toBeUndefined();
  });
});

describe('extra payment: the unpaid schedule is recomputed from what is owed', () => {
  it('reduce term keeps the installment and the principal still adds up', () => {
    const l = loan();
    const l1 = { ...l, payments: [pay(l, 1)] };
    const r = reschedule(l1, 30000, 'reduce-term');
    if ('error' in r) throw new Error(r.error);
    expect(r.rows[0]).toEqual(l.schedule[0]); // what was paid is kept as it was
    expect(r.rows.length).toBeLessThan(12);
    expect(r.rows[1].payment).toBeCloseTo(l.schedule[1].payment, 1);
    const paidAfter = r.rows.slice(1).reduce((s, x) => s + x.principal, 0);
    expect(paidAfter).toBeCloseTo(outstanding(l1) - 30000, 2);
    expect(r.rows[r.rows.length - 1].balance).toBe(0);
    expect(r.rows[1].n).toBe(2);
  });

  it('reduce installment keeps the number of installments', () => {
    const l = loan();
    const l1 = { ...l, payments: [pay(l, 1)] };
    const r = reschedule(l1, 30000, 'reduce-installment');
    if ('error' in r) throw new Error(r.error);
    expect(r.rows).toHaveLength(12);
    expect(r.rows[1].payment).toBeLessThan(l.schedule[1].payment);
  });

  it('is refused for flat loans, a partly paid installment, out-of-order payments and amounts that are not below the balance', () => {
    const l = loan();
    expect(reschedule(loan({}, { ...input, rate: { value: 12, type: 'flat' }, method: 'flat' }), 1000, 'reduce-term')).toEqual({ error: 'method-rate' });
    expect(reschedule({ ...l, payments: [pay(l, 1, 500)] }, 1000, 'reduce-term')).toEqual({ error: 'partial-pending' });
    expect(reschedule({ ...l, payments: [pay(l, 3)] }, 1000, 'reduce-term')).toEqual({ error: 'out-of-order' });
    expect(reschedule(l, 0, 'reduce-term')).toEqual({ error: 'amount' });
    expect(reschedule(l, 120000, 'reduce-term')).toEqual({ error: 'exceeds' });
  });
});

describe('alerts at 7, 3 and 1 day and overdue', () => {
  const l = loan(); // first installment on 2026-12-15
  const stage = (today: string) => loanAlerts([l], today)[0]?.stage;

  it('shows the most urgent stage only', () => {
    expect(stage('2026-12-01')).toBeUndefined();
    expect(stage('2026-12-08')).toBe('due-7');
    expect(stage('2026-12-11')).toBe('due-7'); // 4 days left
    expect(stage('2026-12-12')).toBe('due-3');
    expect(stage('2026-12-14')).toBe('due-1');
    expect(stage('2026-12-15')).toBe('due-1'); // today
    expect(stage('2026-12-16')).toBe('overdue');
    expect(loanAlerts([l], '2026-12-16')[0].daysLeft).toBe(-1);
  });

  it('a paid installment raises no alert; the next one is the one that counts', () => {
    const paid = { ...l, payments: [pay(l, 1)] };
    expect(loanAlerts([paid], '2026-12-16')).toEqual([]);
    expect(loanAlerts([paid], '2027-01-12')[0]).toMatchObject({ stage: 'due-3', date: '2027-01-15' });
    expect(loanAlerts([{ ...l, status: 'voided' }], '2026-12-16')).toEqual([]);
  });

  it('the key is stable per loan, installment and stage', () => {
    expect(loanAlerts([l], '2026-12-08')[0].key).toBe('l1:1:due-7');
  });
});

describe('monthly weight and installments due', () => {
  it('a biweekly loan weighs 26/12 installments per month', () => {
    const bi = loan({}, { ...input, frequency: 'biweekly', firstDate: '2026-12-04' });
    expect(monthlyInstallments([bi])).toBeCloseTo((bi.schedule[0].payment * 26) / 12, 1);
    expect(monthlyInstallments([loan()])).toBe(loan().schedule[0].payment);
    expect(monthlyInstallments([loan({ status: 'paid' })])).toBe(0);
    expect(monthlyInstallments([])).toBe(0);
  });

  it('what falls due in a window; overdue ones count as due on the first day', () => {
    const l = loan();
    const due = installmentsDue([l], '2026-12-20', '2027-01-31');
    expect(due.map((d) => d.date)).toEqual(['2026-12-20', '2027-01-15']); // the first one is overdue
    expect(installmentsDue([{ ...l, payments: [pay(l, 1)] }], '2026-12-20', '2027-01-31').map((d) => d.date)).toEqual(['2027-01-15']);
    expect(installmentsDue([l], '2026-01-01', '2026-06-01')).toEqual([]);
  });
});
