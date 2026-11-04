import { LoanInput, amortize, cancelEarly, compareGrid, compareOffers, effectiveToNominal, irr, nominalToEffective, periodsFor, quoteLoan, savingsOf, validateLoan } from './loans';
import { sumMoney } from '../utils/money';

// REFERENCE VALUES. Python was not available on the development machine, so they come from an
// independent script (closed-form PMT = P*i/(1-(1+i)^-n), bisection IRR, none of this engine's
// code), kept in the commit message of v2.14.0 and reproduced here:
//   A  500,000 at 18% nominal (monthly capitalization), 36 months, french:  PMT 18,076.1978, interest 150,743.12
//   B  300,000 at 24% EFFECTIVE annual, 24 months, french:                  i = 1.8087582%/month, PMT 15,519.7918, interest 72,475.00
//   C  400,000 at 15% nominal, 48 months, commission 2% financed (debt 408,000), insurance 0.04% of the
//      opening balance per period and 150 per period. Rounded each period: installment 11,354.95,
//      first payment 11,668.15 (principal 6,254.95, interest 5,100.00, charges 313.20, balance 401,745.05),
//      last payment 11,509.10 (principal 11,214.43, interest 140.18, charges 154.49, balance 0),
//      interest 137,037.26, charges 11,585.17, effective cost (IRR of the cash flow) 18.7467% a year
//   D  100,000 at 12% FLAT, 12 months: installment 9,333.33, equivalent effective annual rate 23.6984%
//   E  60,000 at 20% nominal, 12 months paid every two weeks (26 periods): i = 0.7658083%/period, PMT 2,553.8498, interest 6,400.09
//   F  120,000 german at 18% nominal, 12 months: principal 10,000, first interest 1,800, last 150, interest 11,700
//   G  TEA of 18% nominal/12 = 19.5618%; nominal of TEA 24% = 21.7051%
//   I  A with an extra 100,000 at installment 12 (reduce term): 29 installments, interest 114,678.35 (base 150,743.11, saved 36,064.76)
const base: LoanInput = { amount: 500000, rate: { value: 18, type: 'nominal' }, method: 'french', termMonths: 36, frequency: 'monthly', firstDate: '2026-12-15' };
const principalOf = (rows: { principal: number; extra: number }[]) => sumMoney(rows.map((r) => r.principal + r.extra));

describe('rates', () => {
  it('nominal <-> effective, and back (reference G)', () => {
    expect(nominalToEffective(18, 12)).toBeCloseTo(19.5618, 3);
    expect(effectiveToNominal(24, 12)).toBeCloseTo(21.7051, 3);
    for (const v of [0, 1, 7.5, 18, 36, 60]) expect(effectiveToNominal(nominalToEffective(v, 12), 12)).toBeCloseTo(v, 9);
    for (const m of [1, 2, 4, 12, 365]) expect(nominalToEffective(effectiveToNominal(24, m), m)).toBeCloseTo(24, 9);
  });

  it('periods follow the frequency (12 months = 12, 26 or 52 payments)', () => {
    expect(periodsFor(12, 'monthly')).toBe(12);
    expect(periodsFor(12, 'biweekly')).toBe(26);
    expect(periodsFor(12, 'weekly')).toBe(52);
    expect(periodsFor(1, 'weekly')).toBe(4);
  });

  it('irr: a plain loan gives its own periodic rate; no solution gives null', () => {
    const r = irr([1000, ...Array(12).fill(-1000 / 12 - 10)])!;
    expect(r).toBeGreaterThan(0);
    expect(irr([100, 50, 50])).toBeNull(); // nothing is ever repaid: no rate
  });
});

describe('french method against the reference (A, B, C, E)', () => {
  it('A: 500,000 at 18% nominal, 36 months', () => {
    const q = quoteLoan(base);
    expect(q.error).toBeUndefined();
    expect(q.rows).toHaveLength(36);
    expect(q.totals.installment).toBeCloseTo(18076.2, 2);
    expect(Math.abs(q.totals.interest - 150743.12)).toBeLessThan(36 * 0.01);
    expect(q.totals.totalPayable).toBeCloseTo(500000 + q.totals.interest, 2);
    expect(q.effectiveRate).toBeCloseTo(19.5618, 3);
    expect(q.effectiveCost).toBeCloseTo(19.5618, 2); // no charges: the cost IS the rate
  });

  it('B: a 24% EFFECTIVE annual rate is not 2% a month', () => {
    const q = quoteLoan({ ...base, amount: 300000, rate: { value: 24, type: 'effective' }, termMonths: 24 });
    expect(q.periodicRate).toBeCloseTo(0.018087582, 8);
    expect(q.totals.installment).toBeCloseTo(15519.79, 2);
    expect(Math.abs(q.totals.interest - 72475)).toBeLessThan(24 * 0.01);
    expect(q.effectiveRate).toBe(24);
  });

  it('C: with a financed commission, insurance and a charge per period', () => {
    const q = quoteLoan({
      ...base,
      amount: 400000,
      rate: { value: 15, type: 'nominal' },
      termMonths: 48,
      costs: { commission: { mode: 'percent', value: 2, financed: true }, insurance: { mode: 'percent', value: 0.04 }, others: [{ amount: 150, recurring: true }] },
    });
    expect(q.totals.principal).toBe(408000);
    expect(q.totals.financedCommission).toBe(8000);
    expect(q.rows[0]).toMatchObject({ payment: 11668.15, principal: 6254.95, interest: 5100, fees: 313.2, balance: 401745.05 });
    // the last row absorbs the residue: it may differ by a cent from the reference on half-cent ties
    expect(q.rows[47].balance).toBe(0);
    expect(q.rows[47].payment).toBeCloseTo(11509.1, 1);
    expect(q.rows[47].principal).toBeCloseTo(11214.43, 1);
    expect(q.rows[47]).toMatchObject({ interest: 140.18, fees: 154.49 });
    expect(q.totals.interest).toBeCloseTo(137037.26, 1); // within a cent of the reference (half-cent ties)
    expect(q.totals.fees).toBeCloseTo(11585.17, 1);
    expect(q.effectiveCost!).toBeCloseTo(18.7467, 3);
    expect(q.effectiveCost!).toBeGreaterThan(q.effectiveRate!); // the charges make it cost more than the rate
    expect(q.totals.disbursed).toBe(400000);
  });

  it('commission NOT financed and one-off charges are paid at the start and lower the cash received', () => {
    const q = quoteLoan({ ...base, costs: { commission: { mode: 'fixed', value: 5000, financed: false }, others: [{ amount: 1000, recurring: false }] } });
    expect(q.totals.upfront).toBe(6000);
    expect(q.totals.disbursed).toBe(494000);
    expect(q.totals.principal).toBe(500000);
    expect(q.totals.totalCost).toBeCloseTo(q.totals.interest + 6000, 2);
    expect(q.effectiveCost!).toBeGreaterThan(q.effectiveRate!);
  });

  it('E: biweekly payments use the biweekly period rate', () => {
    const q = quoteLoan({ ...base, amount: 60000, rate: { value: 20, type: 'nominal' }, termMonths: 12, frequency: 'biweekly', firstDate: '2026-12-04' });
    expect(q.rows).toHaveLength(26);
    expect(q.periodicRate).toBeCloseTo(0.007658083, 8);
    expect(q.totals.installment).toBeCloseTo(2553.85, 2);
    expect(Math.abs(q.totals.interest - 6400.09)).toBeLessThan(26 * 0.01);
    expect(q.rows[1].date).toBe('2026-12-18'); // every 14 days
  });

  it('weekly payments are 7 days apart', () => {
    const q = quoteLoan({ ...base, amount: 10000, termMonths: 3, frequency: 'weekly', firstDate: '2026-12-04' });
    expect(q.rows).toHaveLength(13);
    expect(q.rows[1].date).toBe('2026-12-11');
  });
});

describe('edges and properties', () => {
  it('0% rate: equal principal, no interest, the last installment absorbs the cents', () => {
    const q = quoteLoan({ ...base, amount: 100000, rate: { value: 0, type: 'nominal' }, termMonths: 3 });
    expect(q.rows.map((r) => r.principal)).toEqual([33333.33, 33333.33, 33333.34]);
    expect(q.totals.interest).toBe(0);
    expect(q.rows[2].balance).toBe(0);
    expect(q.effectiveCost).toBeCloseTo(0, 6);
  });

  it('a one-period loan: one payment of principal + one period of interest', () => {
    const q = quoteLoan({ ...base, amount: 10000, termMonths: 1 });
    expect(q.rows).toHaveLength(1);
    expect(q.rows[0]).toMatchObject({ principal: 10000, interest: 150, balance: 0 });
  });

  it('the principal always adds up to what was borrowed, and the balance never goes below zero', () => {
    for (const method of ['french', 'german'] as const) {
      for (const [amount, rate, months, freq] of [
        [100000, 18, 36, 'monthly'],
        [333333.33, 23.99, 47, 'monthly'],
        [77777.77, 0.5, 7, 'biweekly'],
        [1234.56, 60, 13, 'weekly'],
        [999999.99, 9.25, 60, 'monthly'],
      ] as const) {
        const q = quoteLoan({ ...base, amount, rate: { value: rate, type: 'nominal' }, method, termMonths: months, frequency: freq });
        expect(q.error).toBeUndefined();
        expect(principalOf(q.rows)).toBeCloseTo(amount, 2);
        expect(q.rows.every((r) => r.balance >= 0)).toBe(true);
        expect(q.rows[q.rows.length - 1].balance).toBe(0);
        expect(q.totals.totalPayable).toBeCloseTo(sumMoney(q.rows.map((r) => r.payment)), 2);
      }
    }
  });

  it('the schedule dates keep the day of the month and use the last day of short months, leap year included', () => {
    const q = quoteLoan({ ...base, termMonths: 4, firstDate: '2027-01-31' });
    expect(q.rows.map((r) => r.date)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']);
    const leap = quoteLoan({ ...base, termMonths: 2, firstDate: '2028-01-31' });
    expect(leap.rows[1].date).toBe('2028-02-29');
  });
});

describe('german method (F)', () => {
  it('constant principal, decreasing installment', () => {
    const q = quoteLoan({ ...base, amount: 120000, method: 'german', termMonths: 12 });
    expect(q.rows.every((r) => r.principal === 10000)).toBe(true);
    expect(q.rows[0].interest).toBe(1800);
    expect(q.rows[11].interest).toBe(150);
    expect(q.totals.interest).toBe(11700);
    expect(q.rows[0].payment).toBeGreaterThan(q.rows[11].payment);
  });
});

describe('flat rate (D): it looks smaller than it is', () => {
  it('interest on the ORIGINAL amount every period; the effective rate is much higher', () => {
    const q = quoteLoan({ ...base, amount: 100000, rate: { value: 12, type: 'flat' }, method: 'flat', termMonths: 12 });
    expect(q.rows.every((r) => r.interest === 1000)).toBe(true);
    expect(q.rows[0].payment).toBeCloseTo(9333.33, 2);
    expect(q.totals.interest).toBe(12000);
    expect(q.effectiveRate!).toBeCloseTo(23.6984, 3);
    expect(q.effectiveRate!).toBeGreaterThan(12 * 1.9);
    expect(q.assumptions).toContain('A flat rate charges interest on the original amount every period: its effective rate is higher than the number looks.');
  });

  it('flat vs french for the same amount, term and number: flat costs more', () => {
    const flat = quoteLoan({ ...base, amount: 100000, rate: { value: 12, type: 'flat' }, method: 'flat', termMonths: 12 });
    const french = quoteLoan({ ...base, amount: 100000, rate: { value: 12, type: 'nominal' }, termMonths: 12 });
    expect(flat.totals.interest).toBeGreaterThan(french.totals.interest);
  });

  it('a flat method needs a flat rate and the other way around', () => {
    expect(validateLoan({ ...base, method: 'flat' })).toBe('method-rate');
    expect(validateLoan({ ...base, rate: { value: 12, type: 'flat' } })).toBe('method-rate');
  });
});

describe('validation', () => {
  it('rejects what makes no sense', () => {
    expect(validateLoan({ ...base, amount: 0 })).toBe('amount');
    expect(validateLoan({ ...base, amount: NaN })).toBe('amount');
    expect(validateLoan({ ...base, rate: { value: -1, type: 'nominal' } })).toBe('rate');
    expect(validateLoan({ ...base, termMonths: 0 })).toBe('term');
    expect(validateLoan({ ...base, termMonths: 1.5 })).toBe('term');
    expect(validateLoan({ ...base, firstDate: '2026-02-30' })).toBe('date');
    expect(validateLoan({ ...base, costs: { commission: { mode: 'percent', value: 120, financed: false } } })).toBe('costs');
    expect(validateLoan(base)).toBeNull();
    expect(quoteLoan({ ...base, amount: -5 }).rows).toEqual([]);
  });
});

describe('comparisons', () => {
  it('the amount x term grid is complete and the installment falls as the term grows', () => {
    const grid = compareGrid(base, [300000, 400000, 500000], [12, 24, 36, 48, 60]);
    expect(grid).toHaveLength(3);
    expect(grid.every((row) => row.length === 5)).toBe(true);
    for (const row of grid) for (let i = 1; i < row.length; i++) expect(row[i].installment).toBeLessThan(row[i - 1].installment);
    for (let i = 1; i < grid.length; i++) expect(grid[i][2].installment).toBeGreaterThan(grid[i - 1][2].installment);
    expect(grid[2][2].installment).toBeCloseTo(18076.2, 2);
  });

  it('offers: the cheapest by total cost is marked, an invalid one is never the best', () => {
    const out = compareOffers([
      { name: 'Bank A', input: base },
      { name: 'Bank B', input: { ...base, rate: { value: 15, type: 'nominal' }, costs: { commission: { mode: 'percent', value: 3, financed: false } } } },
      { name: 'Broken', input: { ...base, amount: 0 } },
    ]);
    expect(out.map((o) => o.best)).toEqual([false, true, false]);
    expect(out[2].quote.error).toBe('amount');
    expect(out[1].quote.totals.totalCost).toBeLessThan(out[0].quote.totals.totalCost);
  });
});

describe('what-if on a loan', () => {
  it('extra payment, reduce term (reference I): 29 installments and the interest saved', () => {
    const b = quoteLoan(base);
    const q = quoteLoan(base, { extras: [{ period: 12, amount: 100000 }], extraMode: 'reduce-term' });
    expect(q.rows).toHaveLength(29);
    expect(Math.abs(q.totals.interest - 114678.35)).toBeLessThan(0.05);
    const s = savingsOf(b, q);
    expect(Math.abs(s.interestSaved - 36064.76)).toBeLessThan(0.05);
    expect(s.periodsSaved).toBe(7);
    expect(s.newEndDate).toBe(q.rows[28].date);
    expect(principalOf(q.rows)).toBeCloseTo(500000, 2);
    expect(q.rows[28].balance).toBe(0);
  });

  it('extra payment, reduce installment: same end date, lighter installment', () => {
    const b = quoteLoan(base);
    const q = quoteLoan(base, { extras: [{ period: 12, amount: 100000 }], extraMode: 'reduce-installment' });
    expect(q.rows).toHaveLength(36);
    expect(q.rows[12].payment).toBeLessThan(b.rows[12].payment);
    expect(principalOf(q.rows)).toBeCloseTo(500000, 2);
    expect(savingsOf(b, q).interestSaved).toBeGreaterThan(0);
  });

  it('a periodic extra payment ends the loan sooner and never leaves a negative balance', () => {
    const q = quoteLoan(base, { recurringExtra: { amount: 5000, every: 1, from: 1 }, extraMode: 'reduce-term' });
    expect(q.rows.length).toBeLessThan(36);
    expect(q.rows.every((r) => r.balance >= 0)).toBe(true);
    expect(principalOf(q.rows)).toBeCloseTo(500000, 2);
  });

  it('an extra payment larger than the balance is capped at the balance', () => {
    const q = quoteLoan(base, { extras: [{ period: 2, amount: 9e9 }] });
    expect(q.rows).toHaveLength(2);
    expect(q.rows[1].balance).toBe(0);
    expect(principalOf(q.rows)).toBeCloseTo(500000, 2);
  });

  it('early cancellation at period k: payoff, penalty and what it saves', () => {
    const r = cancelEarly(base, 12, 2);
    expect(typeof r).toBe('object');
    const c = r as Exclude<typeof r, string>;
    const b = quoteLoan(base);
    expect(c.balance).toBe(b.rows[11].balance);
    expect(c.penalty).toBeCloseTo(c.balance * 0.02, 2);
    expect(c.payoff).toBeCloseTo(c.balance + c.penalty, 2);
    const rest = sumMoney(b.rows.slice(12).map((x) => x.payment));
    expect(c.savedVsEnd).toBeCloseTo(rest - c.payoff, 2);
    expect(c.savedVsEnd).toBeGreaterThan(0);
  });

  it('cancelling at the last period leaves a zero balance and no payoff', () => {
    const c = cancelEarly(base, 36, 5) as Exclude<ReturnType<typeof cancelEarly>, string>;
    expect(c.balance).toBe(0);
    expect(c.payoff).toBe(0);
    expect(c.savedVsEnd).toBe(0);
    expect(cancelEarly(base, 0)).toBe('term');
    expect(cancelEarly(base, 5, 150)).toBe('term');
  });

  it('a rate change at period k: the installment is recalculated (or the term moves)', () => {
    const up = quoteLoan(base, { rateChanges: [{ period: 13, rate: { value: 24, type: 'nominal' } }], rateChangeMode: 'adjust-installment' });
    expect(up.rows).toHaveLength(36);
    expect(up.rows[12].payment).toBeGreaterThan(up.rows[11].payment);
    expect(principalOf(up.rows)).toBeCloseTo(500000, 2);
    const longer = quoteLoan(base, { rateChanges: [{ period: 13, rate: { value: 24, type: 'nominal' } }], rateChangeMode: 'adjust-term' });
    expect(longer.rows.length).toBeGreaterThan(36);
    expect(longer.rows[12].payment).toBeCloseTo(longer.rows[11].payment, 1);
    expect(principalOf(longer.rows)).toBeCloseTo(500000, 2);
    expect(longer.rows[longer.rows.length - 1].balance).toBe(0);
    const down = quoteLoan(base, { rateChanges: [{ period: 13, rate: { value: 9, type: 'nominal' } }], rateChangeMode: 'adjust-term' });
    expect(down.rows.length).toBeLessThan(36);
    expect(down.rows.every((r) => r.balance >= 0)).toBe(true);
  });

  it('several rate changes apply in order', () => {
    const q = quoteLoan(base, {
      rateChanges: [
        { period: 7, rate: { value: 20, type: 'nominal' } },
        { period: 19, rate: { value: 12, type: 'nominal' } },
      ],
      rateChangeMode: 'adjust-installment',
    });
    expect(q.rows).toHaveLength(36);
    expect(principalOf(q.rows)).toBeCloseTo(500000, 2);
    expect(q.rows[6].payment).not.toBe(q.rows[5].payment);
  });

  it('reducing the term compares installment, interest and total', () => {
    const long = quoteLoan(base);
    const short = quoteLoan({ ...base, termMonths: 24 });
    expect(short.totals.installment).toBeGreaterThan(long.totals.installment);
    expect(short.totals.interest).toBeLessThan(long.totals.interest);
    expect(short.totals.totalPayable).toBeLessThan(long.totals.totalPayable);
  });

  it('a flat-rate loan does not support extra payments or rate changes (no invented rebate rule)', () => {
    const flat: LoanInput = { ...base, amount: 100000, rate: { value: 12, type: 'flat' }, method: 'flat', termMonths: 12 };
    expect(quoteLoan(flat, { extras: [{ period: 3, amount: 1000 }] }).error).toBe('method-rate');
    expect(quoteLoan(flat, { rateChanges: [{ period: 3, rate: { value: 20, type: 'flat' } }] }).error).toBe('method-rate');
    expect(typeof cancelEarly(flat, 6, 0)).toBe('object');
  });

  it('the engine refuses an installment that never covers the interest', () => {
    const r = amortize({ principal: 100000, periods: 12, frequency: 'monthly', method: 'french', rate: { value: 60, type: 'nominal' }, firstDate: '2026-12-01', keepInstallment: 100 });
    expect(r.error).toBe('no-amortization');
  });
});
