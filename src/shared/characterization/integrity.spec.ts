// Characterization tests (prompt 00 / v2.5.2): they pin what the code does
// TODAY for each integrity case in docs/AUDITORIA-2026-11.md §2 (C1-C9).
// Tests named "KNOWN GAP:" document a violation of docs/INTEGRIDAD.md on
// purpose; prompts 01/02 flip them into tests of the correct behavior.
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, vi } from 'vitest';
import { BudgetsComponent } from '../../app/pages/budgets/budgets';
import { MemoryStorage, boot } from '../testing/memory-storage';
import { account, recurring, transaction } from '../testing/builders';

const NOW = '2026-11-03T12:00:00';

const bank = account({ id: 'bank', name: 'Bank', type: 'bank', initialBalance: 10000 });
const card = account({ id: 'card', name: 'Visa', type: 'card', cardKind: 'credit', initialBalance: 0 });
const cash = account({ id: 'cash', name: 'Cash', type: 'cash', initialBalance: 0 });

function session(extra: Record<string, unknown> = {}, accounts = [bank, card, cash]) {
  return boot(new MemoryStorage().seed({ accounts, ...extra }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => vi.useRealTimers());

describe('C1 credit card purchase and card payment (R2, R3)', () => {
  it('a card purchase is one expense and the card balance goes negative', () => {
    const s = session();
    s.transactions.add(transaction({ accountId: 'card', amount: 3000 }));
    expect(s.transactions.monthSummary(2026, 11)).toEqual({ income: 0, expense: 3000 });
    expect(s.transactions.accountBalance('card')).toBe(-3000);
    expect(s.transactions.totalBalance()).toBe(7000);
  });

  it('paying the card as a transfer does not count the purchases again', () => {
    const s = session();
    s.transactions.add(transaction({ accountId: 'card', amount: 3000 }));
    s.transactions.add(
      transaction({ type: 'transfer', accountId: 'bank', toAccountId: 'card', amount: 3000, categoryId: undefined })
    );
    expect(s.transactions.monthSummary(2026, 11)).toEqual({ income: 0, expense: 3000 });
    expect(s.transactions.accountBalance('bank')).toBe(7000);
    expect(s.transactions.accountBalance('card')).toBe(0);
    expect(s.transactions.totalBalance()).toBe(7000);
  });

  it('KNOWN GAP: paying the card as an expense counts the purchases twice (AUDITORIA §2/C1)', () => {
    // There is no "card payment" kind: nothing stops the user (or a recurring
    // rule) from registering the payment as a plain expense.
    const s = session();
    s.transactions.add(transaction({ accountId: 'card', amount: 3000 }));
    s.transactions.add(transaction({ accountId: 'bank', amount: 3000, categoryId: 'cat-bills' }));
    expect(s.transactions.monthSummary(2026, 11).expense).toBe(6000);
    expect(s.transactions.totalBalance()).toBe(4000); // real money out is 3000
  });
});

describe('C2 transfers between own accounts (R1, R9)', () => {
  it('a bank to card transfer is neither income nor expense and nets out in the total', () => {
    const s = session();
    s.transactions.add(
      transaction({ type: 'transfer', accountId: 'bank', toAccountId: 'card', amount: 500, categoryId: undefined })
    );
    expect(s.transactions.monthSummary(2026, 11)).toEqual({ income: 0, expense: 0 });
    expect(s.transactions.categoryTotals(2026, 11, 'expense')).toEqual([]);
    expect(s.transactions.accountBalance('bank')).toBe(9500);
    expect(s.transactions.accountBalance('card')).toBe(500);
    expect(s.transactions.totalBalance()).toBe(10000);
  });

  it('a transfer from the bank to its own linked debit card moves nothing', () => {
    const debit = account({ id: 'debit', type: 'card', cardKind: 'debit', linkedAccountId: 'bank' });
    const s = session({}, [bank, debit]);
    s.transactions.add(
      transaction({ type: 'transfer', accountId: 'bank', toAccountId: 'debit', amount: 500, categoryId: undefined })
    );
    expect(s.transactions.accountBalance('bank')).toBe(10000);
    expect(s.transactions.accountBalance('debit')).toBe(0);
  });
});

describe('C3 bank fee / DGII tax on a movement (R1, R9)', () => {
  it('the fee of a transfer is an expense under Bank fees, the transfer itself is not', () => {
    const s = session();
    s.transactions.add(
      transaction({ type: 'transfer', accountId: 'bank', toAccountId: 'cash', amount: 5000, fee: 10, categoryId: undefined })
    );
    expect(s.transactions.monthSummary(2026, 11)).toEqual({ income: 0, expense: 10 });
    expect(s.transactions.categoryTotals(2026, 11, 'expense')).toEqual([{ categoryId: 'cat-bank-fees', total: 10 }]);
    expect(s.transactions.accountBalance('bank')).toBe(4990);
    expect(s.transactions.accountBalance('cash')).toBe(5000);
    expect(s.transactions.totalBalance()).toBe(9990);
  });

  it('KNOWN GAP: a budget on Bank fees never sees the fees, only stats do (AUDITORIA §2/C3)', () => {
    const s = session({ budgets: [{ id: 'b1', categoryId: 'cat-bank-fees', monthlyLimit: 100 }] });
    s.transactions.add(
      transaction({ type: 'transfer', accountId: 'bank', toAccountId: 'cash', amount: 5000, fee: 90, categoryId: undefined })
    );
    const row = TestBed.createComponent(BudgetsComponent).componentInstance.rows()[0];
    expect(s.transactions.categoryTotals(2026, 11, 'expense')[0].total).toBe(90);
    expect(row.spent).toBe(0);
  });

  it('KNOWN GAP: a USD fee leaves the USD balance but is invisible in stats (AUDITORIA §2/C3, C8)', () => {
    const usd = account({ id: 'usd', type: 'bank', currency: 'USD', initialBalance: 100 });
    const s = session({}, [usd]);
    s.transactions.add(
      transaction({ type: 'income', accountId: 'usd', currency: 'USD', amount: 50, fee: 2, categoryId: 'cat-salary' })
    );
    expect(s.transactions.accountBalance('usd', 'USD')).toBe(148);
    expect(s.transactions.monthSummary(2026, 11)).toEqual({ income: 0, expense: 0 });
  });
});

describe('C4 recurring catch-up (R9)', () => {
  const rule = recurring({ accountId: 'bank', amount: 100, startDate: '2026-10-01', nextDate: '2026-10-01' });

  it('posts every due occurrence once and advances nextDate', () => {
    const s = session({ recurring: [rule] });
    expect(s.transactions.transactions().map((t) => t.date).sort()).toEqual(['2026-10-01', '2026-11-01']);
    expect(s.recurring.recurring()[0].nextDate).toBe('2026-12-01');
  });

  it('opening the app again (or calling processDue twice) does not duplicate', () => {
    const first = session({ recurring: [rule] });
    first.recurring.processDue();
    const second = boot(first.storage);
    second.recurring.processDue();
    expect(second.transactions.transactions()).toHaveLength(2);
  });

  it('keeps month end anchoring: every 31st clamps to Feb 28 and returns to 31', () => {
    vi.setSystemTime(new Date('2026-04-02T12:00:00'));
    const s = session({
      recurring: [recurring({ accountId: 'bank', startDate: '2026-01-31', nextDate: '2026-01-31' })],
    });
    expect(s.transactions.transactions().map((t) => t.date).sort()).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ]);
  });

  it('KNOWN GAP: moving the phone clock forward posts future months for good (AUDITORIA §2/C4)', () => {
    const first = session({ recurring: [rule] });
    vi.setSystemTime(new Date('2027-03-03T12:00:00'));
    const future = boot(first.storage);
    expect(future.transactions.transactions()).toHaveLength(6); // up to 2027-03-01
    vi.setSystemTime(new Date(NOW)); // clock back to the real date
    const back = boot(first.storage);
    expect(back.transactions.transactions()).toHaveLength(6); // nothing reversed or flagged
    expect(back.transactions.transactions().some((t) => t.date > '2026-11-03')).toBe(true);
  });

  it('KNOWN GAP: transactions and rule are saved separately, a failed save duplicates on next start (AUDITORIA §2/C4)', () => {
    const storage = new MemoryStorage().seed({ accounts: [bank], recurring: [rule] });
    storage.failOnSet.add('recurring'); // e.g. localStorage quota exceeded
    expect(() => boot(storage)).toThrow();
    expect(storage.get<unknown[]>('transactions', [])).toHaveLength(2); // already persisted
    storage.failOnSet.clear();
    const next = boot(storage);
    expect(next.transactions.transactions()).toHaveLength(4); // 2 duplicated
  });

  it('KNOWN GAP: a rule keeps posting to an account that no longer exists (AUDITORIA §2/C5)', () => {
    const s = session({ recurring: [] }, [bank]);
    s.recurring.add({
      type: 'expense',
      amount: 50,
      categoryId: 'cat-bills',
      accountId: 'ghost',
      frequency: 'monthly',
      startDate: '2026-11-01',
    });
    expect(s.transactions.transactions()).toHaveLength(1);
    expect(s.accounts.byId('ghost')).toBeUndefined();
  });
});

describe('C5 deleting accounts (R9)', () => {
  function withActivity() {
    return session(
      {
        transactions: [
          transaction({ id: 'e', accountId: 'bank', amount: 100 }),
          transaction({ id: 't', type: 'transfer', accountId: 'bank', toAccountId: 'cash', amount: 200, categoryId: undefined }),
        ],
      },
      [
        { ...bank, initialBalance: 1000 },
        { ...cash, initialBalance: 500 },
      ]
    );
  }

  it('baseline: total is initial balances plus income minus expenses', () => {
    expect(withActivity().transactions.totalBalance()).toBe(1400);
  });

  it('KNOWN GAP: deleting an account with movements changes the total balance and orphans its history (AUDITORIA §2/C5)', () => {
    const s = withActivity();
    s.accounts.remove('bank');
    expect(s.transactions.totalBalance()).toBe(400); // lost the 1000 initial, still subtracts the 100
    expect(s.transactions.transactions()).toHaveLength(2); // orphans kept, pointing to a missing account
    expect(s.accounts.byId('bank')).toBeUndefined();
  });

  it('KNOWN GAP: deleting a transfer destination leaves the total and the account list disagreeing (AUDITORIA §2/C5)', () => {
    const s = withActivity();
    s.accounts.remove('cash');
    expect(s.transactions.totalBalance()).toBe(900);
    expect(s.transactions.accountBalance('bank')).toBe(700); // the 200 left the bank and arrived nowhere
  });

  it('KNOWN GAP: deleting the bank of a linked debit card silently moves its history onto the card (AUDITORIA §2/C5)', () => {
    const debit = account({ id: 'debit', type: 'card', cardKind: 'debit', linkedAccountId: 'bank' });
    const s = session({ transactions: [transaction({ accountId: 'debit', amount: 50 })] }, [bank, debit]);
    expect(s.transactions.accountBalance('debit')).toBe(0); // counted on the bank
    s.accounts.remove('bank');
    expect(s.transactions.accountBalance('debit')).toBe(-50);
    expect(s.accounts.byId('debit')?.linkedAccountId).toBe('bank'); // dangling link
  });
});

describe('C6 editing and deleting a transfer (R1, R9)', () => {
  const transfer = transaction({
    id: 'tr',
    type: 'transfer',
    accountId: 'bank',
    toAccountId: 'cash',
    amount: 300,
    categoryId: undefined,
  });

  it('a transfer is one record: deleting it restores both accounts', () => {
    const s = session({ transactions: [transfer] });
    expect(s.transactions.accountBalance('cash')).toBe(300);
    s.transactions.remove('tr');
    expect(s.transactions.accountBalance('bank')).toBe(10000);
    expect(s.transactions.accountBalance('cash')).toBe(0);
  });

  it('editing the amount changes both sides at once', () => {
    const s = session({ transactions: [transfer] });
    s.transactions.update({ ...transfer, amount: 450 });
    expect(s.transactions.accountBalance('bank')).toBe(9550);
    expect(s.transactions.accountBalance('cash')).toBe(450);
  });

  it('converting a transfer into an expense stops crediting the destination', () => {
    const s = session({ transactions: [transfer] });
    s.transactions.update({ ...transfer, type: 'expense', toAccountId: undefined, categoryId: 'cat-food' });
    expect(s.transactions.accountBalance('cash')).toBe(0);
    expect(s.transactions.monthSummary(2026, 11).expense).toBe(300);
  });

  it('KNOWN GAP: the service accepts invalid movements, only the form validates (AUDITORIA §2/C6)', () => {
    const s = session();
    s.transactions.add(
      transaction({ type: 'transfer', accountId: 'bank', toAccountId: 'bank', amount: 10, categoryId: undefined })
    );
    s.transactions.add(transaction({ accountId: 'bank', amount: -50 })); // negative expense = hidden income
    s.transactions.add(transaction({ accountId: 'bank', currency: 'USD', amount: 5 })); // USD on a DOP-only account
    expect(s.transactions.monthSummary(2026, 11).expense).toBe(-50);
    expect(s.transactions.accountBalance('bank', 'USD')).toBe(-5);
  });

  it('KNOWN GAP: one NaN amount poisons every total (AUDITORIA §2/C6)', () => {
    const s = session();
    s.transactions.add(transaction({ accountId: 'bank', amount: NaN }));
    expect(Number.isNaN(s.transactions.totalBalance())).toBe(true);
    expect(Number.isNaN(s.transactions.accountBalance('bank'))).toBe(true);
    expect(Number.isNaN(s.transactions.monthSummary(2026, 11).expense)).toBe(true);
  });
});

describe('C7 importing backups (R9)', () => {
  const oldBackup = {
    app: 'x-money',
    version: 1,
    accounts: [
      { id: 'a1', name: 'Wallet', icon: '💵', initialBalance: 50 },
      { id: 'a2', name: 'Visa', icon: '💳', initialBalance: 0 },
    ],
    transactions: [
      { id: 't1', type: 'expense', amount: 20, categoryId: 'cat-food', accountId: 'a1', date: '2026-11-01' },
    ],
  };

  it('rejects invalid JSON, other apps and null without touching the data', () => {
    const s = session();
    const before = [...s.storage.data.entries()];
    expect(s.settings.importData('{not json')).toBe(false);
    expect(s.settings.importData('null')).toBe(false);
    expect(s.settings.importData(JSON.stringify({ app: 'other' }))).toBe(false);
    expect([...s.storage.data.entries()]).toEqual(before);
  });

  it('an old backup (no account type/currency/cardKind, no recurring) is migrated on load', () => {
    const s = session();
    expect(s.settings.importData(JSON.stringify(oldBackup))).toBe(true);
    const next = boot(s.storage);
    expect(next.accounts.accounts().map((a) => [a.type, a.cardKind, a.currency])).toEqual([
      ['cash', undefined, 'DOP'],
      ['card', 'debit', 'DOP'],
    ]);
    expect(next.transactions.accountBalance('a1')).toBe(30);
    expect(next.recurring.recurring()).toEqual([]);
  });

  it('export then import on a wiped device restores the same data', () => {
    const s = session({ transactions: [transaction({ accountId: 'bank', amount: 75 })] });
    const backup = s.settings.exportData();
    s.settings.wipeData();
    expect(boot(s.storage).transactions.transactions()).toEqual([]);
    expect(boot(s.storage).settings.importData(backup)).toBe(true);
    const restored = boot(s.storage);
    expect(restored.transactions.transactions()).toHaveLength(1);
    expect(restored.transactions.accountBalance('bank')).toBe(9925);
  });

  it('the backup carries neither the PIN hash nor the language', () => {
    const s = session({ lock: 'hash', lang: 'es' });
    const exported = JSON.parse(s.settings.exportData());
    expect(exported).not.toHaveProperty('lock');
    expect(exported).not.toHaveProperty('lang');
  });

  it('KNOWN GAP: a backup with the wrong shape is accepted and breaks the app on the next load (AUDITORIA §2/C7)', () => {
    const s = session();
    expect(s.settings.importData(JSON.stringify({ app: 'x-money', transactions: [{ id: 'x' }] }))).toBe(true);
    const next = boot(s.storage);
    expect(() => next.transactions.forMonth(2026, 11)).toThrow(); // entries without date
  });

  it('KNOWN GAP: the version is ignored and the import is a per-key merge, not a replacement (AUDITORIA §2/C7)', () => {
    const s = session({ budgets: [{ id: 'b', categoryId: 'cat-food', monthlyLimit: 10 }] });
    expect(s.settings.importData(JSON.stringify({ app: 'x-money', version: 99, accounts: [bank] }))).toBe(true);
    expect(s.storage.get<unknown[]>('budgets', [])).toHaveLength(1); // old budgets survive next to restored accounts
  });
});

describe('C8 USD and DOP (no mixing)', () => {
  const dual = account({ id: 'dual', type: 'card', cardKind: 'credit', currency: 'dual', initialBalance: 5000 });

  it('keeps one balance per currency on a dual account and leaves USD out of DOP stats', () => {
    const s = session({}, [dual]);
    s.transactions.add(transaction({ accountId: 'dual', currency: 'USD', amount: 100 }));
    s.transactions.add(transaction({ accountId: 'dual', currency: 'DOP', amount: 400 }));
    expect(s.transactions.accountBalance('dual', 'DOP')).toBe(4600);
    expect(s.transactions.accountBalance('dual', 'USD')).toBe(-100);
    expect(s.transactions.totalBalanceUsd()).toBe(-100);
    expect(s.transactions.monthSummary(2026, 11)).toEqual({ income: 0, expense: 400 });
  });

  it('KNOWN GAP: a dual account can only start with a RD$ balance, never US$ (AUDITORIA §2/C8)', () => {
    const s = session({}, [dual]);
    expect(s.transactions.accountBalance('dual', 'USD')).toBe(0);
  });

  it('KNOWN GAP: a RD$ budget counts US$ expenses of the same category (AUDITORIA §2/C8)', () => {
    const s = session({ budgets: [{ id: 'b', categoryId: 'cat-food', monthlyLimit: 1000 }] }, [dual]);
    s.transactions.add(transaction({ accountId: 'dual', currency: 'USD', amount: 100, categoryId: 'cat-food' }));
    const row = TestBed.createComponent(BudgetsComponent).componentInstance.rows()[0];
    expect(s.transactions.monthSummary(2026, 11).expense).toBe(0);
    expect(row.spent).toBe(100);
  });
});

describe('C9 float arithmetic (R9)', () => {
  it('KNOWN GAP: sums leave ghost cents (AUDITORIA §2/C9)', () => {
    const s = session({}, [account({ id: 'a', initialBalance: 0 })]);
    s.transactions.add(transaction({ type: 'income', accountId: 'a', amount: 0.1, categoryId: 'cat-salary' }));
    s.transactions.add(transaction({ type: 'income', accountId: 'a', amount: 0.2, categoryId: 'cat-salary' }));
    expect(s.transactions.monthSummary(2026, 11).income).toBe(0.30000000000000004);
    expect(s.transactions.accountBalance('a')).toBe(0.30000000000000004);
    expect(s.transactions.totalBalance()).toBe(0.30000000000000004);
  });

  it('KNOWN GAP: a budget of exactly 0.30 is flagged over after spending 0.10 + 0.20 (AUDITORIA §2/C9)', () => {
    const s = session({ budgets: [{ id: 'b', categoryId: 'cat-food', monthlyLimit: 0.3 }] }, [account({ id: 'a' })]);
    s.transactions.add(transaction({ accountId: 'a', amount: 0.1, categoryId: 'cat-food' }));
    s.transactions.add(transaction({ accountId: 'a', amount: 0.2, categoryId: 'cat-food' }));
    expect(TestBed.createComponent(BudgetsComponent).componentInstance.rows()[0].status).toBe('over');
  });
});
