import { describe, expect, it } from 'vitest';
import { category, transaction } from '../testing/builders';
import { rankCategories, splitCategories } from './category-usage';

const cats = ['a', 'b', 'c', 'd'].map((id) => category({ id, name: id.toUpperCase() }));
const use = (categoryId: string, n: number, extra: Parameters<typeof transaction>[0] = {}) => Array.from({ length: n }, () => transaction({ categoryId, ...extra }));

describe('rankCategories', () => {
  it('most used first; ties and unused keep the catalog order', () => {
    const txs = [...use('c', 3), ...use('b', 1), ...use('d', 1)];
    expect(rankCategories(cats, txs, 'expense').map((c) => c.id)).toEqual(['c', 'b', 'd', 'a']);
  });

  it('no movements at all: the catalog order, nothing lost', () => {
    expect(rankCategories(cats, [], 'expense').map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(rankCategories([], [], 'income')).toEqual([]);
  });

  it('only the asked type counts; reversed originals and reversals say nothing about habit', () => {
    const txs = [...use('d', 2, { type: 'income' }), ...use('a', 1), ...use('b', 5, { status: 'reversed' }), ...use('c', 5, { origin: 'reversal' })];
    expect(rankCategories(cats, txs, 'expense').map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(rankCategories(cats, txs, 'income').map((c) => c.id)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('does not mutate its inputs', () => {
    const copy = [...cats];
    rankCategories(cats, use('d', 2), 'expense');
    expect(cats).toEqual(copy);
  });
});

describe('splitCategories', () => {
  const ranked = ['1', '2', '3', '4', '5'].map((id) => ({ id }));

  it('shows the first N and keeps the rest', () => {
    const { shown, rest } = splitCategories(ranked, 3);
    expect(shown.map((c) => c.id)).toEqual(['1', '2', '3']);
    expect(rest.map((c) => c.id)).toEqual(['4', '5']);
  });

  it('few categories: all shown, nothing behind More', () => {
    expect(splitCategories(ranked, 8)).toEqual({ shown: ranked, rest: [] });
    expect(splitCategories([], 8)).toEqual({ shown: [], rest: [] });
  });

  it('a category picked from the rest takes the first place and the last shown one moves to the rest; nothing is lost or repeated', () => {
    const { shown, rest } = splitCategories(ranked, 3, '5');
    expect(shown.map((c) => c.id)).toEqual(['5', '1', '2']);
    expect(rest.map((c) => c.id)).toEqual(['3', '4']);
    expect([...shown, ...rest].map((c) => c.id).sort()).toEqual(['1', '2', '3', '4', '5']);
  });

  it('a selected category already shown, or an unknown one, changes nothing', () => {
    expect(splitCategories(ranked, 3, '2').shown.map((c) => c.id)).toEqual(['1', '2', '3']);
    expect(splitCategories(ranked, 3, 'zzz').shown.map((c) => c.id)).toEqual(['1', '2', '3']);
  });
});
