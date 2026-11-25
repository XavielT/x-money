// 2.26.0: the one-tap fix of what was filed under "Other", on the real services.
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, vi } from 'vitest';
import { MemoryStorage, boot } from '../testing/memory-storage';
import { account, transaction } from '../testing/builders';
import { OTHER_EXPENSE_ID } from '../domain/other-review';
import { OtherReviewService } from './other-review.service';
import { TextRuleService } from './text-rule.service';
import { TransactionService } from './transaction.service';

const bank = account({ id: 'bank', name: 'Bank', type: 'bank', initialBalance: 10000 });
const t = (id: string, note: string, amount: number, over = {}) => transaction({ id, type: 'expense', accountId: 'bank', categoryId: OTHER_EXPENSE_ID, note, amount, date: '2026-11-18', ...over });

function session(list: ReturnType<typeof t>[]) {
  const s = boot(new MemoryStorage().seed({ accounts: [bank], transactions: list }));
  return { ...s, review: TestBed.inject(OtherReviewService), tx: TestBed.inject(TransactionService), rules: TestBed.inject(TextRuleService) };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-20T12:00:00'));
});
afterEach(() => vi.useRealTimers());

describe('filing what is under "Other" in one tap', () => {
  it('moves every movement of the place, changes no balance and learns the place', () => {
    const s = session([t('a', 'SHELL AV LUPERON · ref 1', 400), t('b', 'SHELL AV LUPERON · ref 2', 160), t('c', 'AURELIA NABO', 330)]);
    const before = s.tx.accountBalance('bank', 'DOP');
    expect(s.review.total()).toBe(3);
    const shell = s.review.groups().find((g) => g.label.startsWith('SHELL'))!;
    expect(shell.suggestion).toBe('cat-fuel');
    expect(s.review.apply(shell, 'cat-fuel')).toEqual({ changed: 2, skipped: 0 });
    expect(s.tx.byId('a')?.categoryId).toBe('cat-fuel');
    expect(s.tx.byId('b')?.categoryId).toBe('cat-fuel');
    expect(s.tx.byId('c')?.categoryId).toBe(OTHER_EXPENSE_ID); // another place: untouched
    expect(s.tx.accountBalance('bank', 'DOP')).toBe(before); // only the category changed
    expect(s.rules.match('SHELL AV LUPERON', 'expense')?.target).toBe('cat-fuel'); // the next ones file themselves
    expect(s.review.total()).toBe(1);
  });

  it('a reconciled movement is left alone and reported, the rest still moves', () => {
    const s = session([t('a', 'SHELL AV LUPERON', 400, { reconciled: true }), t('b', 'SHELL AV LUPERON', 160)]);
    const g = s.review.groups()[0];
    expect(s.review.apply(g, 'cat-fuel')).toEqual({ changed: 1, skipped: 1 });
    expect(s.tx.byId('a')?.categoryId).toBe(OTHER_EXPENSE_ID);
  });

  it('a category that does not exist moves nothing and learns nothing', () => {
    const s = session([t('a', 'SHELL AV LUPERON', 400)]);
    expect(s.review.apply(s.review.groups()[0], 'cat-nope')).toEqual({ changed: 0, skipped: 1 });
    expect(s.rules.rules()).toHaveLength(0);
  });
});
