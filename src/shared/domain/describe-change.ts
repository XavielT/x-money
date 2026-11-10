import { round2 } from '../utils/money';

// Turns one change-history event into a short sentence. Pure: names, symbols and translation come in through the context,
// so this file knows nothing about Angular or storage. The technical payload is returned apart, for a folded "Show details".

export interface ChangeEvent {
  type: string;
  entity: string;
  accountId?: string;
  before?: unknown;
  after?: unknown;
}

export interface DescribeContext {
  t: (key: string, params?: Record<string, string>) => string;
  accountName: (id: string | undefined) => string;
  categoryName: (id: string | undefined) => string;
  // symbol for a currency code: 'USD' is always US$, anything else is the user's peso symbol
  symbol: (currency: string | undefined) => string;
}

export interface ChangeDescription {
  text: string;
  details: string | null; // JSON of before/after, only meant for the folded details
}

type Bag = Record<string, unknown>;

const bag = (v: unknown): Bag => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Bag) : {});
const str = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const has = (v: unknown): boolean => v !== undefined && v !== null && !(typeof v === 'object' && Object.keys(v as object).length === 0);

// 1250 -> "1,250.00"; the sign is kept
export function formatAmount(amount: number, symbol: string): string {
  const value = round2(amount);
  const text = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${value < 0 ? '-' : ''}${symbol}${text}`;
}

export function describeChange(e: ChangeEvent, ctx: DescribeContext): ChangeDescription {
  return { text: sentence(e, ctx), details: details(e) };
}

function details(e: ChangeEvent): string | null {
  if (!has(e.before) && !has(e.after)) return null;
  try {
    return JSON.stringify({ before: e.before, after: e.after }, null, 2);
  } catch {
    return null;
  }
}

function sentence(e: ChangeEvent, ctx: DescribeContext): string {
  const { t } = ctx;
  const before = bag(e.before);
  const after = bag(e.after);
  const money = (n: unknown, currency?: unknown): string => {
    const v = num(n);
    return v === null ? '' : formatAmount(v, ctx.symbol(typeof currency === 'string' ? currency : undefined));
  };
  // the entity a before/after pair talks about: added (only after), deleted (only before) or changed
  const lifecycle = (added: string, changed: string, deleted: string, name: string): string => {
    const key = has(e.before) && !has(e.after) ? deleted : !has(e.before) ? added : changed;
    return t(key, { name });
  };
  const kindWord = (type: unknown): string => t(type === 'income' ? 'Income' : type === 'transfer' ? 'Transfer' : 'Expense');
  const txPhrase = (key: string, tx: Bag): string => {
    const kind = tx['type'] === 'income' ? 'Income' : tx['type'] === 'transfer' ? 'Transfer' : 'Expense';
    const base = t(`${kind} of {amount} ${key}`, { amount: money(tx['amount'], tx['currency']) });
    if (tx['type'] === 'transfer') {
      const from = ctx.accountName(str(tx['accountId']) || e.accountId);
      const to = ctx.accountName(str(tx['toAccountId']));
      return from && to ? t('{sentence} from {from} to {to}', { sentence: base, from, to }) : base;
    }
    const category = ctx.categoryName(str(tx['categoryId']));
    return category ? t('{sentence} in {category}', { sentence: base, category }) : base;
  };

  switch (e.type) {
    case 'create':
      // a capture draft that became a record carries no amount
      return num(after['amount']) !== null ? txPhrase('added', after) : t('Record added from a capture');
    case 'delete':
      return txPhrase('deleted', before);
    case 'reverse':
      return has(before['amount']) ? txPhrase('reversed', before) : t('Movement reversed');
    case 'edit': {
      const was = num(before['amount']);
      const now = num(after['amount']);
      if (was !== null && now !== null && was !== now) {
        return t('{kind} changed from {from} to {to}', { kind: kindWord(after['type'] ?? before['type']), from: money(was, before['currency']), to: money(now, after['currency'] ?? before['currency']) });
      }
      if (now !== null) return txPhrase('edited', after);
      return t('Movement edited');
    }
    case 'convert-transfer': {
      const from = ctx.accountName(str(after['accountId']) || e.accountId);
      const to = ctx.accountName(str(after['toAccountId']));
      const amount = money(after['amount'], after['currency']);
      return from && to && amount ? t('An expense and an income became a transfer of {amount} from {from} to {to}', { amount, from, to }) : t('An expense and an income became a transfer');
    }
    case 'undo-convert':
      return t('A conversion to transfer was undone');
    case 'card-payment-convert':
      return t('An expense became a card payment of {amount}', { amount: money(after['amount'], after['currency']) });
    case 'balance-adjustment': {
      const amount = money(after['amount']);
      return amount ? t('Balance adjusted by {amount}', { amount }) : t('Balance adjusted');
    }
    case 'reconcile': {
      const bank = money(after['bankBalance']);
      const account = ctx.accountName(e.accountId);
      if (account && bank) return t('Account {account} matched with the bank balance of {bank}', { account, bank });
      return account ? t('Account {account} matched with the bank', { account }) : t('Matched with the bank');
    }
    case 'import': {
      const accounts = num(after['accounts']);
      const transactions = num(after['transactions']);
      return accounts !== null && transactions !== null
        ? t('Backup imported: {accounts} accounts and {transactions} movements', { accounts: String(accounts), transactions: String(transactions) })
        : t('Backup imported');
    }
    case 'migration':
      return has(after['version']) ? t('Data updated to version {v}', { v: str(after['version']) }) : t('Data updated');
    case 'account-archive':
      return t('Account {name} archived', { name: str(after['name']) || ctx.accountName(e.accountId) });
    case 'account-unarchive':
      return t('Account {name} restored', { name: str(after['name']) || ctx.accountName(e.accountId) });
    case 'recurring-post': {
      const posted = after['posted'];
      const n = Array.isArray(posted) ? posted.length : num(posted);
      return n !== null ? t('{n} recurring movements posted', { n: String(n) }) : t('Recurring movements posted');
    }
    case 'income-pattern': {
      const amount = money(after['amount']);
      return amount ? t('Income pattern of {amount} confirmed', { amount }) : t('Income pattern confirmed');
    }
    case 'audit-trim': {
      const n = num(after['removed']);
      return n !== null ? t('{n} older events were removed from this list', { n: String(n) }) : t('Older events were removed from this list');
    }
    case 'card-config': {
      const account = ctx.accountName(e.accountId);
      return account ? t('Card {name} settings changed', { name: account }) : t('Card settings changed');
    }
    case 'statement-bank-figures': {
      const account = ctx.accountName(e.accountId);
      return account ? t("Bank figures of a statement saved for {name}", { name: account }) : t('Bank figures of a statement saved');
    }
    case 'statement-interest': {
      const amount = money(after['amount']);
      return amount ? t('Card interest of {amount} registered', { amount }) : t('Card interest registered');
    }
    case 'income-source':
      return lifecycle('Income source {name} added', 'Income source {name} changed', 'Income source {name} deleted', str(after['name']) || str(before['name']));
    case 'income-received': {
      const amount = money(after['amount']);
      return amount ? t('Expected income of {amount} confirmed', { amount }) : t('Expected income confirmed');
    }
    case 'income-classify': {
      const n = num(after['count']);
      return n !== null ? t('{n} movements classified by income source', { n: String(n) }) : t('Movements classified by income source');
    }
    case 'benefit':
      return lifecycle('Benefit {name} added', 'Benefit {name} changed', 'Benefit {name} deleted', str(after['name']) || str(before['name']));
    case 'category':
      return lifecycle('Category {name} added', 'Category {name} changed', 'Category {name} deleted', str(after['name']) || str(before['name']));
    case 'budget-move': {
      const amount = money(after['amount']);
      return amount ? t('{amount} moved between budgets', { amount }) : t('Money moved between budgets');
    }
    case 'budget-move-undo': {
      const amount = money(before['amount']);
      return amount ? t('A move of {amount} between budgets was undone', { amount }) : t('A move between budgets was undone');
    }
    case 'bucket':
      return t('Budget block changed');
    case 'business-operation':
      return t('Business operation changed');
    case 'business-sale':
      return t('Business sale registered');
    case 'business-withdrawal': {
      const amount = money(after['amount'] ?? before['amount']);
      return amount ? t('Profit withdrawal of {amount}', { amount }) : t('Profit withdrawn');
    }
    case 'loan': {
      const name = str(after['name']) || str(before['name']);
      if (after['status'] === 'voided') return t('Loan {name} cancelled', { name });
      return lifecycle('Loan {name} added', 'Loan {name} changed', 'Loan {name} deleted', name);
    }
    case 'loan-payment': {
      if (after['reversed']) return t('A loan payment was reversed');
      const amount = money(after['amount']);
      return amount ? t('Loan payment of {amount}', { amount }) : t('Loan payment');
    }
    case 'goal': {
      const name = str(after['name']) || str(before['name']);
      if (has(before['status']) && has(after['status'])) return t('Goal status changed to {status}', { status: str(after['status']) });
      return lifecycle('Goal {name} added', 'Goal {name} changed', 'Goal {name} deleted', name);
    }
    case 'goal-entry': {
      if (after['reversed']) return t('A goal entry was reversed');
      const amount = money(after['amount']);
      const withdrawal = after['type'] === 'withdrawal';
      if (!amount) return t(withdrawal ? 'Goal withdrawal' : 'Goal contribution');
      return t(withdrawal ? 'Goal withdrawal of {amount}' : 'Goal contribution of {amount}', { amount });
    }
    default:
      // a type this version does not know: say what it touched and keep the technical part folded
      return t('Change in {entity}', { entity: e.entity || '—' });
  }
}
