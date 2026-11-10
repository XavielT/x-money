import { describe, expect, it } from 'vitest';
import { ChangeEvent, DescribeContext, describeChange, formatAmount } from './describe-change';

const accounts: Record<string, string> = { a1: 'Visa', a2: 'Ahorros', usd: 'Dólares' };
const categories: Record<string, string> = { c1: 'Food' };

const ctx: DescribeContext = {
  t: (key, params) => (params ? key.replace(/\{(\w+)\}/g, (_m, n: string) => params[n] ?? '') : key),
  accountName: (id) => (id && accounts[id]) || '',
  categoryName: (id) => (id && categories[id]) || '',
  symbol: (currency) => (currency === 'USD' ? 'US$' : 'RD$'),
};

const text = (e: ChangeEvent) => describeChange(e, ctx).text;

// every AuditType the app writes today (audit-log.service.ts); a new one must be added here and in describeChange
const ALL_TYPES = [
  'create', 'edit', 'reverse', 'delete', 'convert-transfer', 'undo-convert', 'balance-adjustment', 'reconcile', 'import', 'migration',
  'account-archive', 'account-unarchive', 'recurring-post', 'income-pattern', 'audit-trim', 'card-config', 'statement-bank-figures',
  'statement-interest', 'card-payment-convert', 'income-source', 'income-received', 'income-classify', 'benefit', 'category', 'budget-move',
  'budget-move-undo', 'bucket', 'business-operation', 'business-sale', 'business-withdrawal', 'loan', 'loan-payment', 'goal', 'goal-entry',
];

describe('describeChange', () => {
  it('a new expense says its amount and category', () => {
    const e = { type: 'create', entity: 'transaction', accountId: 'a1', after: { type: 'expense', amount: 350, categoryId: 'c1', accountId: 'a1' } };
    expect(text(e)).toBe('Expense of RD$350.00 added in Food');
  });

  it('income, transfer, delete and reverse each have their own sentence', () => {
    expect(text({ type: 'create', entity: 'transaction', after: { type: 'income', amount: 1250.5 } })).toBe('Income of RD$1,250.50 added');
    expect(text({ type: 'create', entity: 'transaction', after: { type: 'transfer', amount: 100, accountId: 'a1', toAccountId: 'a2' } })).toBe('Transfer of RD$100.00 added from Visa to Ahorros');
    expect(text({ type: 'delete', entity: 'transaction', before: { type: 'expense', amount: 20 } })).toBe('Expense of RD$20.00 deleted');
    expect(text({ type: 'reverse', entity: 'transaction', before: { type: 'income', amount: 5 }, after: { reversedBy: 'x' } })).toBe('Income of RD$5.00 reversed');
  });

  it('an edit that changes the amount says from and to; any other edit says it was edited', () => {
    expect(text({ type: 'edit', entity: 'transaction', before: { type: 'expense', amount: 1000 }, after: { type: 'expense', amount: 1250 } })).toBe('Expense changed from RD$1,000.00 to RD$1,250.00');
    expect(text({ type: 'edit', entity: 'transaction', before: { type: 'expense', amount: 10, note: 'a' }, after: { type: 'expense', amount: 10, note: 'b' } })).toBe('Expense of RD$10.00 edited');
    expect(text({ type: 'edit', entity: 'transaction' })).toBe('Movement edited');
  });

  it('dollars and pesos never share a symbol: each amount follows its own currency', () => {
    expect(text({ type: 'create', entity: 'transaction', after: { type: 'expense', amount: 12, currency: 'USD' } })).toBe('Expense of US$12.00 added');
    expect(text({ type: 'create', entity: 'transaction', after: { type: 'expense', amount: 12, currency: 'DOP' } })).toBe('Expense of RD$12.00 added');
    expect(text({ type: 'edit', entity: 'transaction', before: { type: 'income', amount: 1, currency: 'USD' }, after: { type: 'income', amount: 2, currency: 'USD' } })).toBe('Income changed from US$1.00 to US$2.00');
    expect(text({ type: 'create', entity: 'transaction', after: { type: 'expense', amount: 5 } })).not.toContain('US$');
  });

  it('one case per remaining event type', () => {
    const cases: Array<[ChangeEvent, string]> = [
      [{ type: 'convert-transfer', entity: 'transaction', accountId: 'a1', before: {}, after: { amount: 80, accountId: 'a1', toAccountId: 'a2' } }, 'An expense and an income became a transfer of RD$80.00 from Visa to Ahorros'],
      [{ type: 'undo-convert', entity: 'transaction' }, 'A conversion to transfer was undone'],
      [{ type: 'card-payment-convert', entity: 'transaction', after: { amount: 300 } }, 'An expense became a card payment of RD$300.00'],
      [{ type: 'balance-adjustment', entity: 'transaction', after: { difference: 5, amount: 5 } }, 'Balance adjusted by RD$5.00'],
      [{ type: 'reconcile', entity: 'account', accountId: 'a1', after: { bankBalance: 1000, difference: 0 } }, 'Account Visa matched with the bank balance of RD$1,000.00'],
      [{ type: 'import', entity: 'backup', after: { accounts: 3, transactions: 120 } }, 'Backup imported: 3 accounts and 120 movements'],
      [{ type: 'migration', entity: 'schema', before: { version: 3 }, after: { version: 4 } }, 'Data updated to version 4'],
      [{ type: 'account-archive', entity: 'account', accountId: 'a1', after: { name: 'Visa' } }, 'Account Visa archived'],
      [{ type: 'account-unarchive', entity: 'account', accountId: 'a1', after: { name: 'Visa' } }, 'Account Visa restored'],
      [{ type: 'recurring-post', entity: 'transaction', after: { posted: 2 } }, '2 recurring movements posted'],
      [{ type: 'income-pattern', entity: 'account', after: { amount: 500 } }, 'Income pattern of RD$500.00 confirmed'],
      [{ type: 'audit-trim', entity: 'audit', after: { removed: 40 } }, '40 older events were removed from this list'],
      [{ type: 'card-config', entity: 'account', accountId: 'a1', before: {}, after: {} }, 'Card Visa settings changed'],
      [{ type: 'statement-bank-figures', entity: 'statement', accountId: 'a1', after: {} }, 'Bank figures of a statement saved for Visa'],
      [{ type: 'statement-interest', entity: 'statement', after: { amount: 45 } }, 'Card interest of RD$45.00 registered'],
      [{ type: 'income-source', entity: 'income-source', after: { name: 'Salary' } }, 'Income source Salary added'],
      [{ type: 'income-source', entity: 'income-source', before: { name: 'Salary' }, after: { name: 'Salary 2' } }, 'Income source Salary 2 changed'],
      [{ type: 'income-source', entity: 'income-source', before: { name: 'Salary' } }, 'Income source Salary deleted'],
      [{ type: 'income-received', entity: 'income-source', after: { amount: 900 } }, 'Expected income of RD$900.00 confirmed'],
      [{ type: 'income-classify', entity: 'transaction', after: { count: 4 } }, '4 movements classified by income source'],
      [{ type: 'benefit', entity: 'benefit', after: { name: 'Gym' } }, 'Benefit Gym added'],
      [{ type: 'category', entity: 'category', before: { name: 'Food' }, after: { name: 'Meals' } }, 'Category Meals changed'],
      [{ type: 'budget-move', entity: 'budget', after: { amount: 60 } }, 'RD$60.00 moved between budgets'],
      [{ type: 'budget-move-undo', entity: 'budget', before: { amount: 60 } }, 'A move of RD$60.00 between budgets was undone'],
      [{ type: 'bucket', entity: 'budget', after: { kind: 'x' } }, 'Budget block changed'],
      [{ type: 'business-operation', entity: 'business' }, 'Business operation changed'],
      [{ type: 'business-sale', entity: 'business' }, 'Business sale registered'],
      [{ type: 'business-withdrawal', entity: 'business', after: { amount: 200 } }, 'Profit withdrawal of RD$200.00'],
      [{ type: 'loan', entity: 'loan', after: { name: 'Car', amount: 1 } }, 'Loan Car added'],
      [{ type: 'loan', entity: 'loan', before: { name: 'Car', status: 'active' }, after: { status: 'voided' } }, 'Loan Car cancelled'],
      [{ type: 'loan-payment', entity: 'loan', after: { amount: 700 } }, 'Loan payment of RD$700.00'],
      [{ type: 'loan-payment', entity: 'loan', before: { amount: 700 }, after: { reversed: true } }, 'A loan payment was reversed'],
      [{ type: 'goal', entity: 'goal', after: { name: 'Trip' } }, 'Goal Trip added'],
      [{ type: 'goal', entity: 'goal', before: { status: 'active' }, after: { status: 'achieved' } }, 'Goal status changed to achieved'],
      [{ type: 'goal-entry', entity: 'goal', after: { type: 'contribution', amount: 150 } }, 'Goal contribution of RD$150.00'],
      [{ type: 'goal-entry', entity: 'goal', after: { type: 'withdrawal', amount: 50 } }, 'Goal withdrawal of RD$50.00'],
      [{ type: 'goal-entry', entity: 'goal', before: { amount: 1 }, after: { reversed: true } }, 'A goal entry was reversed'],
    ];
    for (const [event, expected] of cases) expect(text(event), event.type).toBe(expected);
  });

  it('a type this version does not know says which entity it touched and keeps the payload for the folded details', () => {
    const d = describeChange({ type: 'future-thing', entity: 'widget', before: { a: 1 }, after: { a: 2 } }, ctx);
    expect(d.text).toBe('Change in widget');
    expect(d.details).toContain('"a": 2');
    expect(describeChange({ type: 'future-thing', entity: '' }, ctx).text).toBe('Change in —');
  });

  it('never puts "[object Object]" or JSON in the sentence, whatever the payload looks like', () => {
    const payloads: unknown[] = [undefined, null, {}, [], 'text', 5, { amount: { nested: true } }, { name: { nested: true } }, { amount: NaN }, { posted: { a: 1 } }];
    for (const type of ALL_TYPES) {
      for (const before of payloads) {
        for (const after of payloads) {
          const out = describeChange({ type, entity: 'transaction', before, after }, ctx).text;
          expect(out, `${type} ${JSON.stringify(before)} ${JSON.stringify(after)}`).not.toMatch(/\[object|undefined|NaN|[{}]\s*"/);
          expect(out.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('the technical payload is returned apart, and is null when there is none', () => {
    expect(describeChange({ type: 'create', entity: 'transaction', after: { type: 'expense', amount: 1 } }, ctx).details).toContain('"amount": 1');
    expect(describeChange({ type: 'bucket', entity: 'budget' }, ctx).details).toBeNull();
  });

  it('formatAmount rounds to cents, groups thousands and keeps the sign', () => {
    expect(formatAmount(1250, 'RD$')).toBe('RD$1,250.00');
    expect(formatAmount(0.1 + 0.2, 'US$')).toBe('US$0.30');
    expect(formatAmount(-5.005, 'RD$')).toBe('-RD$5.01');
    expect(formatAmount(0, 'RD$')).toBe('RD$0.00');
  });
});
