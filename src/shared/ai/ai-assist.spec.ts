// Prompt 11 (v2.17.0): the AI functions of the modules on the real services, with a simulated
// gateway (no provider is ever called). Registry-wide: no function leaks an account name, a bank,
// the last 4 digits or an id; every function has its calculated alternative and with AI off nothing
// is sent; no AI text reaches the screen with figures that did not come from the device.
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { afterEach, beforeEach, vi } from 'vitest';
import { MemoryStorage } from '../testing/memory-storage';
import { account, transaction } from '../testing/builders';
import { AuthService } from '../services/auth.service';
import { BusinessService } from '../services/business.service';
import { CategoryService } from '../services/category.service';
import { GoalService } from '../services/goal.service';
import { LoanService } from '../services/loan.service';
import { RecurringService } from '../services/recurring.service';
import { StorageService } from '../services/storage.service';
import { TextRuleService } from '../services/text-rule.service';
import { TransactionService } from '../services/transaction.service';
import { AiAssistService } from './ai-assist.service';
import { AiGateway, GatewayResult, GatewayUsage } from './ai-gateway';
import { AI_GATEWAY, AiService } from './ai.service';
import { AI_CATALOG } from './catalog';
import { AI_MODULES, AiWireRequest } from './ai.types';
import { LoanInput } from '../domain/loans';

// Things that must NEVER appear in anything that leaves the device
const BANK = 'Banco Popular';
const NAMES = ['Zorvex Nomina', 'Quilmar Visa', BANK, '4242', '7788', 'Mauricio Brelzan', 'Popular'];

const bank = account({ id: 'acc-bank-1', name: 'Zorvex Nomina', type: 'bank', bankId: 'popular', initialBalance: 200000, last4: '7788' });
const card = account({ id: 'acc-card-1', name: 'Quilmar Visa', type: 'card', cardKind: 'credit', bankId: 'popular', last4: '4242', initialBalance: 0, card: { creditLimit: 100000, cutDay: 25, dueMode: 'days-after', dueDays: 20, minPercent: 5, minFloor: 500 } });
const payroll = { id: 'pay', name: 'Constructora Pay', kind: 'payroll', icon: 'x', color: '#000', active: true, stability: 'recurring', schedule: { mode: 'month-days', days: [15, 30] }, method: 'transfer', verifiability: 'documented', expectedNet: 30000, createdAt: '2026-01-01' };

const MONTHS = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
function seed() {
  const txs = [];
  MONTHS.forEach((m, i) => {
    txs.push(transaction({ type: 'income', amount: 30000 + i * 200, accountId: 'acc-bank-1', date: `${m}-15`, categoryId: 'cat-salary', incomeSourceId: 'pay', note: 'quincena' }));
    txs.push(transaction({ type: 'expense', amount: 8000 + i * 100, accountId: 'acc-bank-1', date: `${m}-05`, categoryId: 'cat-rent', note: 'renta Zorvex Nomina' }));
    txs.push(transaction({ type: 'expense', amount: 5000 + (i === 6 ? 9000 : i * 50), accountId: 'acc-card-1', date: `${m}-12`, categoryId: 'cat-food', note: 'super' }));
    for (let k = 0; k < 4; k++) txs.push(transaction({ type: 'expense', amount: 300 + k, accountId: 'acc-card-1', date: `${m}-${String(16 + k).padStart(2, '0')}`, categoryId: 'cat-transport', note: `uber tarjeta 4242 ${k}` }));
    txs.push(transaction({ type: 'expense', amount: 799, accountId: 'acc-card-1', date: `${m}-08`, categoryId: 'cat-subscriptions', note: 'NETFLIX.COM 805 CA' }));
  });
  txs.push(transaction({ type: 'income', amount: 90000, accountId: 'acc-bank-1', date: '2026-11-10', categoryId: 'cat-salary', incomeSourceId: 'pay', note: 'bono' }));
  txs.push(transaction({ type: 'income', amount: 6000, accountId: 'acc-bank-1', date: '2026-10-20', categoryId: 'cat-other-income', note: 'venta pantalla Civic' }));
  txs.push(transaction({ type: 'expense', amount: 21000, accountId: 'acc-card-1', date: '2026-11-12', categoryId: 'cat-food', note: 'super' })); // an unusual expense this month
  txs.push(transaction({ type: 'expense', amount: 450, accountId: 'acc-bank-1', date: '2026-11-03', categoryId: 'cat-other-expense', note: 'ubereats cena' }));
  txs.push(transaction({ type: 'expense', amount: 450, accountId: 'acc-bank-1', date: '2026-11-03', categoryId: 'cat-other-expense', note: 'ubereats cena' })); // a possible duplicate
  return txs;
}

class FakeGateway implements AiGateway {
  calls: AiWireRequest[] = [];
  next: (req: AiWireRequest) => Promise<GatewayResult> = async () => ({ ok: true, output: 'ok', usage: { inputTokens: 10, outputTokens: 5 }, model: 'm', requestId: 'x' });
  usageReply: GatewayUsage = { ok: true, usage: { requests: 0, tokens: 0, requestCap: 300, tokenCap: 400000, month: '2026-11' } };
  run(request: AiWireRequest) {
    this.calls.push(request);
    return this.next(request);
  }
  async usage() {
    return this.usageReply;
  }
}

let gateway: FakeGateway;
let mode: ReturnType<typeof signal<string>>;
let storage: MemoryStorage;

function session() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: StorageService, useValue: storage as unknown as StorageService }, { provide: AuthService, useValue: { mode } }, { provide: AI_GATEWAY, useValue: gateway }],
  });
  TestBed.inject(CategoryService);
  const tx = TestBed.inject(TransactionService);
  TestBed.inject(RecurringService);
  const loans = TestBed.inject(LoanService);
  const goals = TestBed.inject(GoalService);
  const business = TestBed.inject(BusinessService);
  const loan = loans.register({ input: { amount: 120000, rate: { value: 18, type: 'nominal' }, method: 'french', termMonths: 12, frequency: 'monthly', firstDate: '2026-12-15' }, name: 'Quilmar Prestamo', lender: 'Popular', disbursementAccountId: 'acc-bank-1', payAccountId: 'acc-bank-1', disbursementDate: '2026-11-18' });
  if (!loan.ok) throw new Error('loan ' + loan.error);
  loans.saveSimulation('Offer Popular', { amount: 300000, rate: { value: 20, type: 'nominal' }, method: 'french', termMonths: 36, frequency: 'monthly', firstDate: '2026-12-15' });
  goals.add({ name: 'Car', kind: 'vehicle', target: 100000, targetDate: '2027-11-01', plan: { amount: 5000, cadence: 'monthly', startDate: '2026-09-01' } });
  goals.add({ name: 'Trip', kind: 'travel', target: 30000, targetDate: '2027-03-01' });
  const op = business.addOperation({ name: 'pantalla civic 2016', category: 'part', totalCost: 10000, acquiredAt: '2026-10-01', accountId: 'acc-bank-1', quantity: 1 });
  const op2 = business.addOperation({ name: 'display Civic 16', category: 'part', totalCost: 9000, acquiredAt: '2026-10-05', accountId: 'acc-bank-1', quantity: 1 });
  business.addOperation({ name: 'Bumper', category: 'accessory', totalCost: 2000, acquiredAt: '2026-10-07', accountId: 'acc-bank-1', quantity: 1 });
  for (const [r, price] of [[op, 15000], [op2, 13000]] as const) if (r.ok) business.registerSale(r.id, { date: '2026-11-08', quantity: 1, price, method: 'transfer', accountId: 'acc-bank-1' });
  business.addContact({ name: 'Mauricio Brelzan', kind: 'buyer' });
  return { tx, assist: TestBed.inject(AiAssistService), ai: TestBed.inject(AiService), rules: TestBed.inject(TextRuleService), loans, goals, business };
}

const ready = (ai: AiService) => {
  ai.setEnabled(true);
  for (const m of AI_MODULES) ai.setModule(m, true);
  for (const f of AI_CATALOG) ai.acknowledge(f.id);
};

const NARRATE = AI_CATALOG.filter((f) => f.kind === 'narrate').map((f) => f.id);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-20T12:00:00'));
  gateway = new FakeGateway();
  mode = signal('signed-in');
  storage = new MemoryStorage().seed({ accounts: [bank, card], incomeSources: [payroll], transactions: seed(), budgets: [{ id: 'b1', categoryId: 'cat-food', monthlyLimit: 9000 }, { id: 'b2', categoryId: 'cat-transport', monthlyLimit: 1500 }], recurring: [{ id: 'rent', type: 'expense', amount: 9000, categoryId: 'cat-rent', accountId: 'acc-bank-1', frequency: 'monthly', startDate: '2026-11-28', nextDate: '2026-11-28', active: true }] });
});
afterEach(() => vi.useRealTimers());

describe('every function of the registry', () => {
  it('has a calculated text for every narrating function with this data, and the catalog is complete (30 functions, 8 modules)', () => {
    const { assist } = session();
    expect(AI_CATALOG).toHaveLength(30);
    expect(new Set(AI_CATALOG.map((f) => f.module))).toEqual(new Set(AI_MODULES));
    for (const id of NARRATE) {
      const p = assist.prepare(id, id === 'dashboard-explain' ? 'available' : undefined);
      expect(p, `${id} had nothing to say`).not.toBeNull();
      expect(p!.fallback.length, id).toBeGreaterThan(5);
      expect(p!.fallback, id).not.toMatch(/\{[a-z0-9_]+\}/); // no marker left unfilled
      expect(p!.fallback, id).not.toContain('{{');
      expect(Object.keys(p!.values).length, id).toBeGreaterThan(0);
    }
    expect(assist.strategies()).not.toBeNull();
  });

  it('PRIVACY: nothing that leaves carries an account name, a bank, the last 4 digits, an id or a contact (every function)', () => {
    const { assist, tx } = session();
    const ids = [...tx.transactions().map((t) => t.id), 'acc-bank-1', 'acc-card-1'];
    const leaks = (what: unknown, id: string) => {
      const text = JSON.stringify(what).toLowerCase();
      for (const n of [...NAMES, ...ids.slice(0, 20)]) expect(text, `${id} leaked "${n}"`).not.toContain(n.toLowerCase());
    };
    for (const f of AI_CATALOG) {
      if (f.kind === 'narrate') leaks(assist.prepare(f.id, f.id === 'dashboard-explain' ? 'available' : undefined)!.wire, f.id);
      else leaks(assist.previewWire(f.id), f.id);
    }
    // and the placeholders only name markers: nothing else rides along
    for (const id of NARRATE) for (const p of assist.prepare(id, id === 'dashboard-explain' ? 'available' : undefined)!.wire.placeholders) expect(p).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it('AI OFF (the default): not one call leaves, and every narration still has its calculated text', async () => {
    const { assist, ai } = session();
    expect(ai.prefs().enabled).toBe(false);
    for (const id of NARRATE) {
      const r = await assist.narrate(id, id === 'dashboard-explain' ? 'available' : undefined);
      expect(r.source, id).toBe('fallback');
      expect(r.failure, id).toBe('off');
      expect(r.text, id).toBe(r.prepared!.fallback);
    }
    expect((await assist.suggestCategories(['algo nuevo'])).failure).toBe('off');
    expect((await assist.suggestIncomeKinds(['algo nuevo'])).failure).toBe('off');
    expect((await assist.normalizeNames(['NETFLIX.COM 805 CA'])).failure).toBe('off');
    expect((await assist.groupItems()).failure).toBe('off');
    expect((await assist.judgeDuplicates()).failure).toBe('off');
    expect((await assist.rankIndicators()).source).toBe('fallback');
    expect((await assist.chooseStrategy()).source).toBe('fallback');
    expect(gateway.calls).toHaveLength(0);
  });

  it('NORMAL: with AI ready the text of the model reaches the screen with the figures put by the device, labelled by the caller', async () => {
    const { assist, ai } = session();
    ready(ai);
    for (const id of NARRATE) {
      const p = assist.prepare(id, id === 'dashboard-explain' ? 'available' : undefined)!;
      const marker = p.wire.placeholders.find((k) => k.endsWith('_amount')) ?? p.wire.placeholders[0];
      gateway.next = async () => ({ ok: true, output: `Resumen listo: {{${marker}}} es la cifra principal.`, usage: { inputTokens: 5, outputTokens: 5 }, model: 'm', requestId: 'x' });
      const r = await assist.narrate(id, id === 'dashboard-explain' ? 'available' : undefined);
      expect(r.source, id).toBe('ai');
      expect(r.text, id).toBe(`Resumen listo: ${p.values[marker]} es la cifra principal.`);
      expect(r.text, id).not.toContain('{{');
    }
    expect(gateway.calls.length).toBeGreaterThanOrEqual(NARRATE.length - 2); // some inputs repeat and are cached
  });

  it('INVALID OUTPUT: money out of nowhere, percentages, big numbers or unknown markers are never shown; the calculated text is', async () => {
    const { assist, ai } = session();
    ready(ai);
    let n = 0;
    for (const id of NARRATE) {
      const bad = ['Gastaste RD$5,000 este mes', 'Subió 15% este mes', 'Fueron 12345 movimientos', 'La cifra es {{inventado_x}}'][n++ % 4];
      gateway.next = async () => ({ ok: true, output: bad, usage: { inputTokens: 5, outputTokens: 5 }, model: 'm', requestId: 'x' });
      const r = await assist.narrate(id, id === 'dashboard-explain' ? 'available' : undefined);
      expect(r.source, id).toBe('fallback');
      expect(r.failure, id).toBe('invalid-output');
      expect(r.text, id).toBe(r.prepared!.fallback);
    }
  });

  it('OFFLINE, WITHOUT SESSION, DAILY LIMIT and MONTHLY LIMIT: each falls back to the calculated text without a call', async () => {
    const { assist, ai } = session();
    ready(ai);
    mode.set('signed-out');
    expect((await assist.narrate('dashboard-summary')).failure).toBe('no-session');
    mode.set('signed-in');
    window.dispatchEvent(new Event('offline'));
    expect((await assist.narrate('dashboard-summary')).failure).toBe('offline');
    window.dispatchEvent(new Event('online'));
    gateway.usageReply = { ok: true, usage: { requests: 300, tokens: 10, requestCap: 300, tokenCap: 400000, month: '2026-11' } };
    await ai.refreshUsage();
    for (const id of ['dashboard-summary', 'budget-behavior', 'goal-projection']) {
      const r = await assist.narrate(id);
      expect(r.failure, id).toBe('limit');
      expect(r.text, id).toBe(r.prepared!.fallback);
    }
    expect(gateway.calls).toHaveLength(0);
  });

  it('server failures (quota, timeout, provider error, rate limit) fall back to the calculated text', async () => {
    const { assist, ai } = session();
    ready(ai);
    for (const code of ['timeout', 'provider_error', 'rate_limited', 'quota'] as const) {
      gateway.next = async () => ({ ok: false, code });
      const r = await assist.narrate('card-habits');
      expect([r.source, r.failure]).toEqual(['fallback', code]);
      expect(r.text).toBe(r.prepared!.fallback);
      if (code === 'quota') break; // after a quota answer the layer blocks by itself
    }
  });

  it('without data there is nothing to narrate (no invented summary), and a feature that needs consent asks first', async () => {
    storage = new MemoryStorage().seed({ accounts: [bank] });
    const { assist, ai } = session();
    expect(await assist.narrate('income-pattern-explain')).toEqual({ prepared: null, text: '', source: 'none' });
    ai.setEnabled(true);
    ai.setModule('dashboard', true);
    const r = await assist.narrate('dashboard-summary');
    expect(r.failure === 'consent-needed' || r.source === 'none').toBe(true);
    expect(gateway.calls).toHaveLength(0);
  });
});

describe('what each module says (the calculated text on this data)', () => {
  it('income, expenses, budgets, business, cards, loans, savings and dashboard use real figures', () => {
    const { assist } = session();
    const text = (id: string, arg?: unknown) => assist.prepare(id, arg)!.fallback;
    expect(text('income-unusual-question')).toContain('RD$90,000.00');
    expect(text('income-sources-summary')).toMatch(/payroll/);
    expect(text('expense-savings-tips')).toContain('Your biggest expense');
    expect(text('budget-behavior')).toMatch(/Food|Comida|Groceries/i);
    expect(text('business-profitability')).toContain('net profit');
    expect(text('business-capital-eval')).toContain('tied up in inventory');
    expect(text('card-habits')).toContain('card spending');
    expect(text('commitments-priority')).toContain('Pay first');
    expect(text('loan-scenarios')).toContain('simulation');
    expect(text('loan-installments')).toContain('interest');
    expect(text('loan-advice')).toContain('not a guarantee');
    expect(text('goal-projection')).toContain('set aside');
    expect(text('goal-viability')).toContain('estimate');
    expect(text('dashboard-explain', 'available')).toContain('RD$');
    // loans: the simulation being edited wins over the saved one
    const input: LoanInput = { amount: 50000, rate: { value: 12, type: 'nominal' }, method: 'french', termMonths: 24, frequency: 'monthly', firstDate: '2026-12-15' };
    expect(assist.prepare('loan-installments', input)!.wire.figures['princ_amount']).toBe(50000);
  });

  it('RULE 4: the capacity narration never counts non-monetary benefits (they are not an input at all)', () => {
    const { assist } = session();
    const before = JSON.stringify(assist.prepare('loan-capacity'));
    expect(before).not.toMatch(/benefit/i);
    expect(assist.prepare('loan-capacity')!.wire.placeholders).toEqual(expect.arrayContaining(['cons_inc_amount', 'comm_inc_amount', 'all_inc_amount']));
  });
});

describe('classification, grouping, ranking: suggestions the user accepts', () => {
  it('a learned rule answers without a call; otherwise AI picks only among the user categories; accepting updates the movements and learns the word', async () => {
    const { assist, ai, tx, rules } = session();
    ready(ai);
    gateway.next = async (req) => ({ ok: true, output: JSON.stringify({ results: [{ i: 0, picks: [{ o: 'Food', c: 0.9 }, { o: 'Invented', c: 1 }] }] }), usage: { inputTokens: 5, outputTokens: 5 }, model: 'm', requestId: 'x' });
    const groups = assist.uncategorizedExpenses();
    expect(groups.map((g) => [g.text, g.count])).toEqual([['ubereats cena', 2]]); // equal notes are asked once
    const first = await assist.suggestCategories(groups.map((g) => g.text));
    expect(first.results[0].map((s) => s.label)).toEqual(['Food']);
    const sent = gateway.calls[0].input as { items: string[]; options: string[] };
    expect(sent.items).toEqual(['ubereats cena']);
    expect(sent.options).toContain('Food');
    expect(sent.options.some((o) => o.includes('Zorvex'))).toBe(false);
    const foodId = first.results[0][0].target;
    expect(assist.applyCategory(groups[0].ids, foodId, groups[0].text)).toBe(2);
    expect(groups[0].ids.every((id) => tx.byId(id)!.categoryId === foodId)).toBe(true);
    expect(rules.rules()).toHaveLength(1);
    const again = await assist.suggestCategories(['ubereats viernes']);
    expect(again.results[0]).toEqual([{ source: 'rule', target: foodId, label: 'Food', confidence: 1 }]);
    expect(gateway.calls).toHaveLength(1); // the rule answered, nothing was sent
    expect(assist.uncategorizedExpenses()).toEqual([]);
  });

  it('an answer that is not the JSON that was asked for is rejected, never applied', async () => {
    const { assist, ai } = session();
    ready(ai);
    gateway.next = async () => ({ ok: true, output: 'I think it is food', usage: { inputTokens: 1, outputTokens: 1 }, model: 'm', requestId: 'x' });
    expect((await assist.suggestCategories(['nota rara'])).failure).toBe('invalid-output');
    expect((await assist.suggestIncomeKinds(['nota rara'])).failure).toBe('invalid-output');
    expect((await assist.groupItems()).failure).toBe('invalid-output');
    expect((await assist.judgeDuplicates()).failure).toBe('invalid-output');
    expect((await assist.normalizeNames(['X'])).failure).toBe('invalid-output');
    expect((await assist.rankIndicators()).failure).toBe('invalid-output');
  });

  it('income: kinds to the existing source of that kind; with none the user is told, nothing is invented', async () => {
    const { assist, ai, tx } = session();
    ready(ai);
    gateway.next = async () => ({ ok: true, output: JSON.stringify({ results: [{ i: 0, picks: [{ o: 'extraordinary', c: 0.7 }] }] }), usage: { inputTokens: 1, outputTokens: 1 }, model: 'm', requestId: 'x' });
    const groups = assist.unclassifiedIncome();
    expect(groups.map((g) => g.text)).toEqual(['venta pantalla Civic']);
    const r = await assist.suggestIncomeKinds(groups.map((g) => g.text));
    expect(r.results[0][0]).toMatchObject({ source: 'ai', target: 'extraordinary' });
    expect(assist.applyIncomeKind(groups[0].ids, 'extraordinary', groups[0].text)).toBe('no-source');
    expect(tx.byId(groups[0].ids[0])!.incomeSourceId).toBeUndefined();
    expect(assist.applyIncomeKind(groups[0].ids, 'payroll', groups[0].text)).toBe('applied');
    expect(tx.byId(groups[0].ids[0])!.incomeSourceId).toBe('pay');
  });

  it('business: the model proposes families, the user confirms them, and the ranking is calculated on the confirmed groups', async () => {
    const { assist, ai } = session();
    ready(ai);
    expect(assist.bestSellers().map((s) => s.group).sort()).toEqual(['display Civic 16', 'pantalla civic 2016']); // nothing grouped yet
    gateway.next = async (req) => ({ ok: true, output: JSON.stringify({ groups: [{ name: 'Civic screen', members: (req.input as { items: string[] }).items.flatMap((x, i) => (/civic/i.test(x) ? [i] : [])) }] }), usage: { inputTokens: 1, outputTokens: 1 }, model: 'm', requestId: 'x' });
    const r = await assist.groupItems();
    expect(r.groups).toHaveLength(1);
    expect(assist.bestSellers().length).toBe(2); // still nothing until the user confirms
    expect(assist.confirmGroup(r.groups[0], r.names)).toBe(2);
    expect(assist.bestSellers()).toMatchObject([{ group: 'Civic screen', units: 2, members: 2 }]);
  });

  it('duplicates: the model judges the pair of notes, the user decides; nothing is merged or deleted', async () => {
    const { assist, ai, tx } = session();
    ready(ai);
    const before = tx.transactions().length;
    gateway.next = async () => ({ ok: true, output: JSON.stringify({ verdicts: [{ i: 0, verdict: 'duplicate', reason: 'Same note and the same day' }] }), usage: { inputTokens: 1, outputTokens: 1 }, model: 'm', requestId: 'x' });
    const r = await assist.judgeDuplicates();
    expect(r.verdicts).toEqual([{ index: 0, verdict: 'duplicate', reason: 'Same note and the same day' }]);
    const sent = gateway.calls[0].input as { pairs: { a: string; b: string; range: string }[] };
    expect(sent.pairs[0]).toEqual({ a: 'ubereats cena', b: 'ubereats cena', range: '400-500' }); // notes and a range: no exact amount, no ids
    expect(tx.transactions()).toHaveLength(before);
  });

  it('ranking indicators: the model only reorders; without it the order is the size of the change', async () => {
    const { assist, ai } = session();
    const changes = assist.indicatorChanges();
    expect(changes.length).toBeGreaterThan(0);
    const off = await assist.rankIndicators();
    expect(off.source).toBe('fallback');
    ready(ai);
    gateway.next = async () => ({ ok: true, output: JSON.stringify({ order: [...changes.map((c) => c.id)].reverse().concat(['invented']) }), usage: { inputTokens: 1, outputTokens: 1 }, model: 'm', requestId: 'x' });
    const on = await assist.rankIndicators();
    expect(on.source).toBe('ai');
    expect(on.order).toEqual([...changes.map((c) => c.id)].reverse());
  });

  it('strategy: the model picks one of the three calculated strategies and its text goes through the validator', async () => {
    const { assist, ai } = session();
    ready(ai);
    gateway.next = async () => ({ ok: true, output: JSON.stringify({ choice: 'conservative', text: 'It fits you because your base is {{conservative_amount}}.' }), usage: { inputTokens: 1, outputTokens: 1 }, model: 'm', requestId: 'x' });
    const r = await assist.chooseStrategy();
    expect(r).toMatchObject({ source: 'ai', choice: 'conservative' });
    expect(r.text).toMatch(/^It fits you because your base is RD\$[\d,]+\.\d\d\.$/);
    expect((gateway.calls[0].input as { options: string[] }).options).toEqual(['historical', 'conservative', 'adjusted']);
    gateway.next = async () => ({ ok: true, output: JSON.stringify({ choice: 'aggressive', text: 'x' }), usage: { inputTokens: 1, outputTokens: 1 }, model: 'm', requestId: 'x' });
    ai.clearCache();
    expect((await assist.chooseStrategy()).failure).toBe('invalid-output');
    gateway.next = async () => ({ ok: true, output: JSON.stringify({ choice: 'historical', text: 'It adds up to RD$5,000.' }), usage: { inputTokens: 1, outputTokens: 1 }, model: 'm', requestId: 'x' });
    ai.clearCache();
    expect((await assist.chooseStrategy()).failure).toBe('invalid-output'); // money of its own
  });

  it('recurring names: only the distinct, cleaned note texts travel', async () => {
    const { assist, ai } = session();
    ready(ai);
    gateway.next = async () => ({ ok: true, output: JSON.stringify({ names: [{ i: 0, name: 'Netflix' }] }), usage: { inputTokens: 1, outputTokens: 1 }, model: 'm', requestId: 'x' });
    const notes = assist.recurringNotes();
    expect(notes).toContain('NETFLIX.COM 805 CA');
    const r = await assist.normalizeNames(['NETFLIX.COM 805 CA', 'NETFLIX.COM 805 CA']);
    expect(r.names).toEqual(['Netflix']);
    expect((gateway.calls[0].input as { items: string[] }).items).toEqual(['NETFLIX.COM 805 CA']);
  });
});
