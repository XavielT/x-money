import { transaction } from '../testing/builders';
import { MinimizerContext } from './minimizer';
import { TextRule, buildNarration, groupByText, matchRule, normalizeText, parseChoice, parseClassification, parseGroups, parseJson, parseNames, parseOrder, parseVerdicts, rankByGroups, ruleWordFor, slug, unusualIncome, wordsOf } from './inputs';
import { finalizeText } from './output';

const ctx: MinimizerContext = { accountNames: ['Zorvex Nomina'], bankNames: ['Banco Tarkan'], knownIds: ['acc-1'], personNames: ['Mauricio'] };

describe('buildNarration', () => {
  const rows = [
    { key: 'inc', label: 'Payroll', amount: 52000.456, percent: 61.234, count: 3, text: 'payroll', date: '2026-11-15' },
    { key: 'bank', label: 'Banco Tarkan 4242', amount: 10 }, // identifying label: it never travels
  ];

  it('the wire carries rounded numbers and safe labels; the values of the markers are formatted here; the model never sees dates or texts', () => {
    const p = buildNarration('x', rows, 'Income {inc_amount} ({inc_pct}), {inc_n} times, last on {inc_date}: {inc_text}.', ctx);
    expect(p.wire.figures).toEqual({ inc_amount: 52000.46, inc_pct: 61.23, bank_amount: 10 });
    expect(p.wire.counts).toEqual({ inc_n: 3 });
    expect(p.wire.labels).toEqual({ inc: 'Payroll', bank: 'Other' });
    expect(p.values['inc_amount']).toBe('RD$52,000.46');
    expect(p.values['inc_pct']).toBe('61.2%');
    expect(p.values['inc_date']).toBe('2026-11-15');
    expect(JSON.stringify(p.wire)).not.toContain('2026-11-15'); // dates and local words are marker-only
    expect(JSON.stringify(p.wire)).not.toContain('Tarkan');
    expect(p.wire.placeholders).toEqual(expect.arrayContaining(['inc_amount', 'inc_pct', 'inc_n', 'inc_date', 'inc_text', 'bank_amount']));
    expect(p.fallback).toBe('Income RD$52,000.46 (61.2%), 3 times, last on 2026-11-15: payroll.');
  });

  it('a template that mentions a marker with no value falls back to the plain lines; an empty template does too', () => {
    const lines = buildNarration('x', rows, 'Hello {nope}', ctx).fallback;
    expect(lines).toContain('Payroll: RD$52,000.46 · 61.2% · 3 · 2026-11-15');
    expect(buildNarration('x', rows, '', ctx).fallback).toBe(lines);
  });

  it('keeps at most 14 rows, drops bad keys and NaN, and turns a series into rounded numbers', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ key: `r${i}`, amount: i }));
    const p = buildNarration('x', [...many, { key: 'Bad Key', amount: 1 }, { key: 'nan', amount: NaN }], '', ctx, { series: { s: [1.006, 2, NaN] }, context: { period: 'month' } });
    expect(Object.keys(p.wire.figures)).toHaveLength(14);
    expect(p.wire.series['s']).toEqual([1.01, 2]);
    expect(p.wire.context).toEqual({ period: 'month' });
  });

  it('the text of the model with the markers and the local values is what reaches the screen, and figures of its own never do', () => {
    const p = buildNarration('x', [{ key: 'inc', amount: 100 }], '', ctx);
    expect(finalizeText('Tu ingreso fue {{inc_amount}}.', p.values)).toEqual({ ok: true, text: 'Tu ingreso fue RD$100.00.' });
    expect(finalizeText('Tu ingreso fue RD$100.', p.values).ok).toBe(false);
  });

  it('slug makes marker-safe keys', () => {
    expect(slug('Available money')).toBe('available_money');
    expect(slug('Año Nuevo!')).toBe('ano_nuevo');
    expect(slug('123')).toBe('x123');
    expect(slug('commercial-profit')).toBe('commercial_profit');
  });
});

describe('strict parsing of the JSON answers', () => {
  it('reads plain JSON and JSON inside a code fence, and nothing else', () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJson('here you go: {"a":1}')).toBeNull();
    expect(parseJson('')).toBeNull();
  });

  it('classification: only the options offered, at most 3, sorted, confidence clamped, indexes in range', () => {
    const raw = JSON.stringify({ results: [{ i: 0, picks: [{ o: 'Food', c: 0.4 }, { o: 'Transport', c: 7 }, { o: 'Hacked', c: 1 }, { o: 'Home', c: 0.9 }, { o: 'Fun', c: 0.1 }, { o: 'Food', c: 0.2 }] }, { i: 9, picks: [{ o: 'Food', c: 1 }] }, { i: 1, picks: 'x' }] });
    const out = parseClassification(raw, 3, ['Food', 'Transport', 'Home', 'Fun'])!;
    expect(out[0]).toEqual([{ option: 'Transport', confidence: 1 }, { option: 'Home', confidence: 0.9 }, { option: 'Food', confidence: 0.4 }]);
    expect(out[1]).toEqual([]);
    expect(out[2]).toEqual([]);
    expect(parseClassification('nonsense', 2, ['Food'])).toBeNull();
    expect(parseClassification('{"results":"x"}', 2, ['Food'])).toBeNull();
  });

  it('names: short, no markers, in range; groups: 2 or more members, never repeated across groups', () => {
    expect(parseNames('{"names":[{"i":0,"name":" Netflix "},{"i":1,"name":"{{x}}"},{"i":5,"name":"Out"},{"i":2,"name":"a"}]}', 3)).toEqual(['Netflix', null, null]);
    const groups = parseGroups('{"groups":[{"name":"Civic screen","members":[0,1,1,7]},{"name":"Other","members":[1,2]},{"name":"x","members":[2,3]},{"name":"Solo","members":[3]}]}', 4)!;
    expect(groups).toEqual([{ name: 'Civic screen', members: [0, 1] }]);
    expect(parseGroups('[]', 2)).toBeNull();
  });

  it('verdicts: only the three words; the reason may not carry figures; the order: the model only reorders the ids it was given', () => {
    const v = parseVerdicts('{"verdicts":[{"i":0,"verdict":"duplicate","reason":"Same note and day"},{"i":1,"verdict":"doubtful","reason":"cost RD$500 twice"},{"i":2,"verdict":"maybe"},{"i":9,"verdict":"duplicate"}]}', 3)!;
    expect(v).toEqual([{ index: 0, verdict: 'duplicate', reason: 'Same note and day' }, { index: 1, verdict: 'doubtful', reason: '' }]);
    expect(parseOrder('{"order":["b","zzz","a","b"]}', ['a', 'b', 'c'])).toEqual(['b', 'a', 'c']);
    expect(parseOrder('{"order":"x"}', ['a'])).toBeNull();
    expect(parseChoice('{"choice":"historical","text":"Because {{x}}"}', ['historical', 'adjusted'])).toEqual({ choice: 'historical', text: 'Because {{x}}' });
    expect(parseChoice('{"choice":"invented","text":"x"}', ['historical'])).toBeNull();
  });
});

describe('local rules are applied before any AI call', () => {
  const rules: TextRule[] = [
    { id: 'expense:uber', scope: 'expense', word: 'uber', target: 'cat-transport', createdAt: '' },
    { id: 'expense:uber eats', scope: 'expense', word: 'ubereats', target: 'cat-food', createdAt: '' },
    { id: 'income:quincena', scope: 'income', word: 'quincena', target: 'payroll', createdAt: '' },
  ];

  it('normalizes accents, digits and punctuation; matches whole words; the longest word wins; scopes do not mix', () => {
    expect(normalizeText('  Quincena Año 2026!! ')).toBe('quincena ano');
    expect(wordsOf('Pago de UBER 123')).toEqual(['pago', 'uber']);
    expect(matchRule('Uber casa', 'expense', rules)?.target).toBe('cat-transport');
    expect(matchRule('UBEREATS pizza', 'expense', rules)?.target).toBe('cat-food');
    expect(matchRule('suber', 'expense', rules)).toBeUndefined(); // not a whole word
    expect(matchRule('quincena', 'expense', rules)).toBeUndefined();
    expect(matchRule('quincena noviembre', 'income', rules)?.target).toBe('payroll');
  });

  it('remembers the longest word of a note, and nothing from a note without useful words', () => {
    expect(ruleWordFor('Pago de Netflix')).toBe('netflix');
    expect(ruleWordFor('de la')).toBeNull();
  });

  it('equal texts are grouped so the model is asked once per distinct text', () => {
    const g = groupByText([{ id: '1', note: 'Uber' }, { id: '2', note: 'uber ' }, { id: '3', note: 'Café' }, { id: '4', note: 'UBER 55' }, { id: '5', note: '' }]);
    expect(g.map((x) => [x.key, x.count])).toEqual([['uber', 3], ['cafe', 1]]);
    expect(g[0].ids).toEqual(['1', '2', '4']);
  });
});

describe('unusual income and business ranking', () => {
  const inc = (date: string, amount: number, source = 's1') => transaction({ type: 'income', amount, accountId: 'bank', date, categoryId: 'cat-salary', incomeSourceId: source });
  const base = ['2026-06-15', '2026-07-15', '2026-08-15', '2026-09-15', '2026-10-15'].map((d, i) => inc(d, 30000 + i * 100));

  it('flags a recent income far above the usual of its source and ignores normal ones, old ones and short histories', () => {
    const big = inc('2026-11-10', 90000);
    expect(unusualIncome([...base, big], '2026-11-20')).toMatchObject([{ txId: big.id, amount: 90000, median: 30200 }]);
    expect(unusualIncome([...base, inc('2026-11-10', 31000)], '2026-11-20')).toEqual([]);
    expect(unusualIncome([...base, inc('2026-08-20', 90000)], '2026-11-20')).toEqual([]); // not recent
    expect(unusualIncome([...base.slice(0, 3), big], '2026-11-20')).toEqual([]); // fewer than 5 before it
    expect(unusualIncome([...base, inc('2026-11-10', 90000, 's2')], '2026-11-20')).toEqual([]); // another source with no history
  });

  it('the ranking is calculated on the confirmed groups: names without a rule stay alone', () => {
    const rules: TextRule[] = [
      { id: 'item:pantalla', scope: 'item', word: 'pantalla', target: 'Civic screen', createdAt: '' },
      { id: 'item:display', scope: 'item', word: 'display', target: 'Civic screen', createdAt: '' },
    ];
    const r = rankByGroups(
      [
        { name: 'pantalla civic 2016', units: 2, netProfit: 3000 },
        { name: 'display Civic 16', units: 3, netProfit: 4000.5 },
        { name: 'Bumper', units: 4, netProfit: 100 },
      ],
      rules
    );
    expect(r).toEqual([
      { group: 'Civic screen', units: 5, netProfit: 7000.5, members: 2 },
      { group: 'Bumper', units: 4, netProfit: 100, members: 1 },
    ]);
    expect(rankByGroups([], rules)).toEqual([]);
  });
});
