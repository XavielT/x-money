import { Injectable } from '@angular/core';
import { bankById } from '../data/banks';
import { BUCKET_LABELS } from '../data/bucket-labels';
import { baseIncome } from '../domain/budget';
import { addMonthsKeepingDay } from '../domain/dates';
import { LoanInput, compareGrid, quoteLoan } from '../domain/loans';
import { AccountService } from '../services/account.service';
import { BorrowingService } from '../services/borrowing.service';
import { BudgetService } from '../services/budget.service';
import { BusinessService } from '../services/business.service';
import { CategoryService } from '../services/category.service';
import { CreditCardService } from '../services/credit-card.service';
import { DashboardService } from '../services/dashboard.service';
import { GoalService } from '../services/goal.service';
import { IncomeService } from '../services/income.service';
import { LoanService } from '../services/loan.service';
import { SmartInsightService } from '../services/smart-insight.service';
import { SuggestionsService } from '../services/suggestions.service';
import { TextRuleService } from '../services/text-rule.service';
import { TransactionService } from '../services/transaction.service';
import { TranslateService } from '../services/translate.service';
import { AiService } from './ai.service';
import { AiFailure } from './ai.types';
import { Group, NarrationRow, Pick, Prepared, Verdict, buildNarration, groupByText, parseChoice, parseClassification, parseGroups, parseNames, parseOrder, parseVerdicts, rankByGroups, slug, unusualIncome } from './inputs';
import { MinimizerContext, scrubNote } from './minimizer';
import { finalizeText } from './output';
import { findDuplicateCandidates } from '../domain/insights/detectors';

export interface NarrateOutcome {
  prepared: Prepared | null; // null: nothing to talk about yet (no data)
  text: string;
  source: 'ai' | 'fallback' | 'none';
  failure?: AiFailure;
}

export type Suggestion = { source: 'rule' | 'ai'; target: string; label: string; confidence: number };
const NONE: NarrateOutcome = { prepared: null, text: '', source: 'none' };

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Glue between the AI functions and the app: it gathers numbers the services already calculated,
// asks the minimizer for what may leave, and always keeps the deterministic text ready. Nothing
// here changes data on its own; the methods that write are called by a user action.
@Injectable({ providedIn: 'root' })
export class AiAssistService {
  constructor(
    private ai: AiService,
    private accounts: AccountService,
    private categories: CategoryService,
    private transactions: TransactionService,
    private income: IncomeService,
    private suggestions: SuggestionsService,
    private dashboard: DashboardService,
    private budget: BudgetService,
    private business: BusinessService,
    private goals: GoalService,
    private loans: LoanService,
    private borrowing: BorrowingService,
    private cards: CreditCardService,
    private smart: SmartInsightService,
    private rules: TextRuleService,
    private translate: TranslateService
  ) {}

  // ----- helpers

  private today(): string {
    return this.transactions.clock().toISOString().slice(0, 10);
  }

  // What must never leave: the names of the accounts, their banks and last digits, the ids, the contacts
  ctx(): MinimizerContext {
    const accounts = this.accounts.accounts();
    return {
      accountNames: accounts.map((a) => a.name),
      bankNames: [...new Set(accounts.map((a) => (a.bankId ? bankById(a.bankId)?.name : undefined)).filter((n): n is string => !!n))],
      knownIds: [...accounts.map((a) => a.id), ...accounts.map((a) => a.last4).filter((n): n is string => !!n), ...this.categories.categories().map((c) => c.id)],
      personNames: this.business.contacts().map((c) => c.name),
    };
  }

  private t(text: string): string {
    return this.translate.instant(text);
  }

  private P(featureId: string, rows: NarrationRow[], template: string, options: Parameters<typeof buildNarration>[4] = {}): Prepared {
    return buildNarration(featureId, rows, template ? this.t(template) : '', this.ctx(), options);
  }

  private catName(id: string | undefined): string {
    return id ? this.categories.byId(id)?.name ?? '' : '';
  }

  private ym() {
    const t = this.today();
    return { year: Number(t.slice(0, 4)), month: Number(t.slice(5, 7)), key: t.slice(0, 7) };
  }

  // ----- narrations: one builder per function (null = no data to talk about)

  private builders: Record<string, (arg?: unknown) => Prepared | null> = {
    'income-pattern-explain': () => {
      const list = this.suggestions.incomes().slice(0, 3);
      if (!list.length) return null;
      const rows = list.flatMap<NarrationRow>((s, i) => [{ key: `p${i + 1}`, amount: s.amount, count: s.count, text: s.cadence, date: s.lastDate }]);
      return this.P('income-pattern-explain', rows, 'A repeating income of about {p1_amount} arrives {p1_text}; it was seen {p1_n} times, the last on {p1_date}.');
    },
    'income-unusual-question': () => {
      const u = unusualIncome(this.transactions.transactions(), this.today())[0];
      if (!u) return null;
      return this.P('income-unusual-question', [{ key: 'unusual', amount: u.amount, date: u.date }, { key: 'usual', amount: u.median }], 'An income of {unusual_amount} on {unusual_date} is larger than usual (about {usual_amount}). Was it a sale, a bonus or something else?');
    },
    'income-sources-summary': () => {
      const top = this.dashboard.topSources().slice(0, 5);
      if (!top.length) return null;
      const cap = this.income.capacity();
      const total = cap.guaranteedMonthly + cap.variableAverage;
      const rows: NarrationRow[] = top.map((s, i) => ({ key: `src${i + 1}`, label: s.source.kind, percent: s.percent, text: s.source.kind }));
      if (total > 0) rows.push({ key: 'variable', percent: (cap.variableAverage / total) * 100 });
      const template = this.t('Your main source of income ({src1_text}) weighs {src1_pct} of the last 12 months.') + (total > 0 ? this.t(' {variable_pct} of your income comes from variable sources.') : '');
      return buildNarration('income-sources-summary', rows, template, this.ctx());
    },
    'expense-atypical-explain': () => {
      const flags = this.dashboard.unusual().flags.slice(0, 3);
      if (!flags.length) return null;
      const rows = flags.flatMap<NarrationRow>((f, i) => [
        { key: `f${i + 1}`, label: this.catName(f.categoryId), amount: f.amount, date: f.date, text: this.catName(f.categoryId) },
        { key: `u${i + 1}`, amount: f.reference },
      ]);
      return this.P('expense-atypical-explain', rows, 'An expense of {f1_amount} in {f1_text} on {f1_date} is above its usual level of {u1_amount}.');
    },
    'expense-savings-tips': () => {
      const { year, month } = this.ym();
      const prevMonth = month === 1 ? 12 : month - 1;
      const prev = new Map(this.transactions.categoryTotals(month === 1 ? year - 1 : year, prevMonth, 'expense').map((c) => [c.categoryId, c.total]));
      const top = this.transactions.categoryTotals(year, month, 'expense').slice(0, 5);
      if (!top.length) return null;
      const rows: NarrationRow[] = top.map((c, i) => ({ key: `c${i + 1}`, label: this.catName(c.categoryId), text: this.catName(c.categoryId), amount: c.total, ...(prev.get(c.categoryId) ? { percent: ((c.total - prev.get(c.categoryId)!) / prev.get(c.categoryId)!) * 100 } : {}) }));
      return this.P('expense-savings-tips', rows, 'Your biggest expense this month is {c1_text} at {c1_amount}. Start by reviewing it.');
    },
    'budget-behavior': () => {
      const { year, month } = this.ym();
      const list = this.budget.categoryRows(year, month).slice(0, 8);
      if (!list.length) return null;
      const rows: NarrationRow[] = list.flatMap((r, i) => [{ key: `b${i + 1}`, label: this.catName(r.budget.categoryId), text: this.catName(r.budget.categoryId), amount: r.spent, percent: r.limit > 0 ? (r.spent / r.limit) * 100 : 0 }, { key: `l${i + 1}`, amount: r.limit }]);
      return this.P('budget-behavior', rows, '{b1_text}: {b1_amount} spent, {b1_pct} of its limit of {l1_amount}.');
    },
    'budget-risk-alert': () => {
      const risks = this.budget.risks().slice(0, 4);
      if (!risks.length) return null;
      const name = (kind: string, id: string) => (kind === 'bucket' ? this.t(BUCKET_LABELS[id as keyof typeof BUCKET_LABELS] ?? id) : this.catName(id));
      const rows: NarrationRow[] = risks.flatMap((r, i) => [
        { key: `r${i + 1}`, label: name(r.kind, r.id), text: name(r.kind, r.id), amount: r.risk.projected, ...(r.risk.hitDate ? { date: r.risk.hitDate } : {}) },
        { key: `m${i + 1}`, amount: r.risk.limit },
      ]);
      return this.P('budget-risk-alert', rows, '{r1_text} may end the month at {r1_amount} against a limit of {m1_amount} (an estimate).');
    },
    'business-profitability': () => {
      if (!this.business.hasOperations()) return null;
      const { year, month } = this.ym();
      const p = this.business.monthProfit(year, month);
      const ret = this.business.monthReturn(year, month);
      const rows: NarrationRow[] = [{ key: 'rev', amount: p.revenue }, { key: 'net', amount: p.netProfit }, { key: 'sales', count: p.sales }];
      if (ret.percent !== null) rows.push({ key: 'ret', percent: ret.percent });
      return this.P('business-profitability', rows, 'This month you sold {rev_amount} in {sales_n} sales with a net profit of {net_amount}.');
    },
    'business-margin-explain': () => {
      const facts = this.business.operations().flatMap((op) => this.business.factsOf(op).map((f) => ({ name: op.name, f })));
      const withMargin = facts.filter((x) => x.f.margin !== null).sort((a, b) => a.f.margin! - b.f.margin!).slice(0, 4);
      if (!withMargin.length) return null;
      const rows: NarrationRow[] = withMargin.map((x, i) => ({ key: `o${i + 1}`, label: x.name, text: x.name, percent: x.f.margin!, amount: x.f.expenses, count: x.f.days }));
      return this.P('business-margin-explain', rows, 'The operation with the lowest margin is {o1_text}: {o1_pct}, with {o1_amount} of expenses and {o1_n} days to sell.');
    },
    'business-capital-eval': () => {
      const inv = this.business.inventory();
      if (!inv.units) return null;
      const slow = this.business.slow();
      const slowCost = slow.reduce((s, x) => s + x.item.cost, 0);
      const biggest = Math.max(...inv.items.map((i) => i.cost), 0);
      return this.P('business-capital-eval', [{ key: 'invested', amount: inv.cost }, { key: 'slow', amount: slowCost, count: slow.length }, { key: 'oldest', count: inv.oldestDays }, ...(inv.cost > 0 ? [{ key: 'top', percent: (biggest / inv.cost) * 100 }] : [])], 'You have {invested_amount} tied up in inventory; {slow_amount} of it ({slow_n} items) is slow stock. The oldest item has been held for {oldest_n} days.');
    },
    'account-movements': () => {
      const { year, month } = this.ym();
      const prefix = `${year}-${String(month).padStart(2, '0')}`;
      const byType = new Map<string, { out: number; inn: number }>();
      const typeOf = new Map(this.accounts.accounts().map((a) => [a.id, a.type as string]));
      for (const t of this.transactions.transactions()) {
        if (!t.date.startsWith(prefix) || t.type === 'transfer' || t.status === 'reversed') continue;
        const type = typeOf.get(t.accountId) ?? 'other';
        const g = byType.get(type) ?? { out: 0, inn: 0 };
        if (t.type === 'expense') g.out += t.amount;
        else g.inn += t.amount;
        byType.set(type, g);
      }
      if (!byType.size) return null;
      const rows: NarrationRow[] = [...byType.entries()].flatMap(([type, g]) => [{ key: `${slug(type)}_out`, label: type, amount: g.out }, { key: `${slug(type)}_in`, amount: g.inn }]);
      return this.P('account-movements', rows, '');
    },
    'card-habits': () => {
      const cardIds = new Set(this.accounts.accounts().filter((a) => a.type === 'card').map((a) => a.id));
      const from = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
      const byDay = new Array<number>(7).fill(0);
      const byCat = new Map<string, number>();
      for (const t of this.transactions.transactions()) {
        if (t.type !== 'expense' || t.status === 'reversed' || !cardIds.has(t.accountId) || t.date < from) continue;
        byDay[new Date(`${t.date}T12:00:00`).getDay()] += t.amount;
        byCat.set(t.categoryId ?? '', (byCat.get(t.categoryId ?? '') ?? 0) + t.amount);
      }
      const total = byDay.reduce((s, v) => s + v, 0);
      if (!total) return null;
      const top = byDay.indexOf(Math.max(...byDay));
      const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      const rows: NarrationRow[] = [{ key: 'topday', amount: byDay[top], text: this.t(WEEKDAYS[top]), percent: (byDay[top] / total) * 100, label: WEEKDAYS[top] }, ...cats.map(([id, v], i) => ({ key: `cat${i + 1}`, amount: v, label: this.catName(id), text: this.catName(id) }))];
      return this.P('card-habits', rows, 'Most of your card spending happens on {topday_text}: {topday_amount} ({topday_pct} of the last 60 days).');
    },
    'commitments-priority': () => {
      const list = [...this.smart.commitments()].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
      if (!list.length) return null;
      const rows: NarrationRow[] = list.map((c, i) => ({ key: `c${i + 1}`, amount: c.amount, date: c.date, text: this.t(c.kind === 'card' ? 'card statement' : c.kind === 'loan' ? 'loan installment' : 'fixed expense'), label: c.kind }));
      return this.P('commitments-priority', rows, 'Pay first: the {c1_text} of {c1_amount}, due on {c1_date}.');
    },
    'loan-scenarios': (arg) => {
      const input = this.loanInput(arg);
      if (!input) return null;
      const grid = compareGrid(input, [input.amount], [12, 24, 36, 48, 60])[0];
      const rows: NarrationRow[] = grid.flatMap((c, i) => [{ key: `t${i + 1}`, amount: c.installment, count: c.termMonths }, { key: `x${i + 1}`, amount: c.totalCost }]);
      return this.P('loan-scenarios', rows, 'At {t1_n} months the installment is {t1_amount} and the loan costs {x1_amount} over what you borrow; at {t5_n} months it is {t5_amount} and {x5_amount}. This is a simulation.');
    },
    'loan-capacity': (arg) => {
      const input = this.loanInput(arg);
      const q = input ? quoteLoan(input) : null;
      const cap = this.borrowing.evaluate(q && !q.error ? q.totals.installment : 0, input?.frequency ?? 'monthly');
      const names = ['cons', 'comm', 'all'];
      const rows: NarrationRow[] = cap.rows.flatMap((r, i) => [{ key: `${names[i]}_inc`, amount: r.income, text: r.status }, { key: `${names[i]}_left`, amount: r.availableAfter }, ...(r.committed !== null ? [{ key: `${names[i]}_pct`, percent: r.committed }] : [])]);
      return this.P('loan-capacity', rows, 'In the conservative reading the installment commits {cons_pct} of your income and leaves {cons_left} each month (a simulation).');
    },
    'loan-installments': (arg) => {
      const input = this.loanInput(arg);
      const q = input ? quoteLoan(input) : null;
      if (!q || q.error) return null;
      const share = q.totals.totalPayable > 0 ? (q.totals.interest / q.totals.totalPayable) * 100 : 0;
      return this.P('loan-installments', [{ key: 'princ', amount: q.totals.principal }, { key: 'int', amount: q.totals.interest, percent: share }, { key: 'chg', amount: q.totals.fees + q.totals.upfront + q.totals.financedCommission }, { key: 'tot', amount: q.totals.totalPayable }], 'Of {tot_amount} you will pay, {princ_amount} is the debt, {int_amount} is interest ({int_pct} of the total) and {chg_amount} is charges. This is a simulation.');
    },
    'loan-advice': (arg) => {
      const input = this.loanInput(arg);
      if (!input || input.termMonths <= 12) return null;
      const base = quoteLoan(input);
      const shorter = quoteLoan({ ...input, termMonths: input.termMonths - 12 });
      if (base.error || shorter.error) return null;
      return this.P('loan-advice', [{ key: 'inst', amount: base.totals.installment }, { key: 'inst2', amount: shorter.totals.installment }, { key: 'save', amount: base.totals.interest - shorter.totals.interest }], 'Shortening the term by 12 months would save about {save_amount} in interest, with an installment of {inst2_amount} instead of {inst_amount}. This is a simulation, not a guarantee.');
    },
    'goal-projection': () => {
      const list = this.goals.goals().filter((g) => g.status === 'active').slice(0, 4);
      if (!list.length) return null;
      const rows: NarrationRow[] = list.map((g, i) => {
        const p = this.goals.projection(g);
        const s = (p.insufficient ? p.plan : p.actual ?? p.plan) ?? null;
        return { key: `g${i + 1}`, label: g.name, text: g.name, amount: this.goals.progress(g).reserved, percent: this.goals.progress(g).percent, ...(s?.date ? { date: s.date } : {}) };
      });
      return this.P('goal-projection', rows, '{g1_text} has {g1_amount} set aside ({g1_pct}); at the current pace it could be reached on {g1_date} (an estimate).');
    },
    'savings-split': () => {
      const r = this.smart.all().find((i) => i.id === 'reservable:month');
      const reserve = r?.evidence.find((e) => e.label === 'Conservative figure')?.value;
      const goals = this.goals.goals().filter((g) => g.status === 'active').slice(0, 4);
      if (typeof reserve !== 'number' || !goals.length) return null;
      const rows: NarrationRow[] = [{ key: 'reserve', amount: reserve }, ...goals.map((g, i) => ({ key: `g${i + 1}`, label: g.name, text: g.name, amount: Math.max(0, g.target - this.goals.progress(g).reserved), ...(g.targetDate ? { date: g.targetDate } : {}) }))];
      return this.P('savings-split', rows, 'You could set aside about {reserve_amount} a month. {g1_text} still needs {g1_amount} (an estimate).');
    },
    'goal-viability': () => {
      const list = this.goals.goals().filter((g) => g.status === 'active' && g.targetDate).slice(0, 4);
      if (!list.length) return null;
      const rows: NarrationRow[] = list.flatMap((g, i) => {
        const v = this.goals.viabilityOf(g);
        return [{ key: `v${i + 1}`, label: g.name, text: this.t(v.status === 'reachable' ? 'reachable' : v.status === 'tight' ? 'tight' : v.status === 'unreachable' ? 'not reachable' : v.status), amount: v.required }, { key: `m${i + 1}`, amount: v.margin }];
      });
      return this.P('goal-viability', rows, '{v1_text}: you need {v1_amount} a month and your margin is {m1_amount} (an estimate).');
    },
    'dashboard-summary': (arg) => {
      const list = this.dashboard.visible();
      if (!list.length) return null;
      const rows: NarrationRow[] = list.slice(0, 10).map((i) => ({ key: slug(i.id), label: i.label, text: this.t(i.label), ...(i.value === null ? {} : i.display === 'percent' ? { percent: i.value } : { amount: i.value }) }));
      return this.P('dashboard-summary', rows, this.has(rows, 'available') ? 'Your available money is {available_amount} this period.' : '', { context: { period: arg === 'week' ? 'week' : 'month' } });
    },
    'dashboard-alerts': () => {
      const list = this.smart.visible().slice(0, 5);
      if (!list.length) return null;
      const rows: NarrationRow[] = list.map((a, i) => ({ key: `a${i + 1}`, label: a.titleKey, text: this.t(a.titleKey) }));
      return this.P('dashboard-alerts', rows, '{a1_text}');
    },
    'dashboard-explain': (arg) => {
      const ind = this.dashboard.byId(typeof arg === 'string' ? (arg as never) : ('available' as never));
      if (!ind || ind.value === null) return null;
      const rows: NarrationRow[] = [{ key: 'ind', label: ind.label, text: this.t(ind.label), ...(ind.display === 'percent' ? { percent: ind.value } : { amount: ind.value }) }];
      ind.components.filter((c) => c.amount !== null && c.kind !== 'excluded').slice(0, 8).forEach((c, i) => rows.push({ key: `part${i + 1}`, label: c.label, text: this.t(c.label), ...(c.display === 'percent' ? { percent: c.amount! } : { amount: c.amount! }) }));
      return this.P('dashboard-explain', rows, '{ind_text} is {ind_amount}.');
    },
  };

  private has(rows: NarrationRow[], key: string): boolean {
    return rows.some((r) => r.key === key && r.amount !== undefined);
  }

  // The loan a function talks about: the one being simulated, else a saved simulation, else a registered loan
  private loanInput(arg?: unknown): LoanInput | null {
    if (arg && typeof arg === 'object' && 'amount' in arg) return arg as LoanInput;
    const firstDate = addMonthsKeepingDay(this.today(), 1);
    const sim = this.loans.simulations()[0];
    if (sim) return { amount: sim.amount, rate: sim.rate, method: sim.method, termMonths: sim.termMonths, frequency: sim.frequency, firstDate, costs: sim.costs };
    const l = this.loans.active()[0];
    return l ? { amount: l.amount, rate: l.rate, method: l.method, termMonths: l.termMonths, frequency: l.frequency, firstDate: l.firstDate, costs: l.costs } : null;
  }

  featureIds(): string[] {
    return Object.keys(this.builders);
  }

  // What would be sent and shown without calling anything (also used to preview the consent)
  prepare(featureId: string, arg?: unknown): Prepared | null {
    return this.builders[featureId]?.(arg) ?? null;
  }

  // The text of a narration: AI when it is ready and its text passes the validator, otherwise the
  // calculated text. Never throws and never blocks the screen.
  async narrate(featureId: string, arg?: unknown): Promise<NarrateOutcome> {
    const prepared = this.prepare(featureId, arg);
    if (!prepared) return NONE;
    const r = await this.ai.run(featureId, prepared.wire, { values: prepared.values });
    return r.ok ? { prepared, text: r.text, source: 'ai' } : { prepared, text: prepared.fallback, source: 'fallback', failure: r.code };
  }

  // ----- classification of notes (the only text that leaves is the cleaned note)

  private cleaned(notes: readonly string[]): string[] {
    const ctx = this.ctx();
    return notes.map((n) => scrubNote(n, ctx).slice(0, 120));
  }

  private optionNames(kind: 'expense' | 'income'): { names: string[]; byName: Map<string, string> } {
    const byName = new Map<string, string>();
    if (kind === 'expense') for (const c of this.categories.expenseCategories()) for (const x of [c, ...this.categories.children(c.id)]) if (x.name.length <= 40 && !byName.has(x.name)) byName.set(x.name, x.id);
    return { names: [...byName.keys()].slice(0, 60), byName };
  }

  // 2a: for each distinct note, the rule learned (no call) or up to 3 categories from AI
  async suggestCategories(notes: readonly string[]): Promise<{ results: Suggestion[][]; failure?: AiFailure }> {
    const { names, byName } = this.optionNames('expense');
    const results: Suggestion[][] = notes.map((n) => {
      const rule = this.rules.match(n, 'expense');
      return rule ? [{ source: 'rule', target: rule.target, label: this.catName(rule.target), confidence: 1 }] : [];
    });
    const pending = notes.map((_, i) => i).filter((i) => !results[i].length && names.length);
    if (!pending.length) return { results };
    const cleaned = this.cleaned(pending.map((i) => notes[i]));
    const r = await this.ai.run('expense-categorize', { items: cleaned, options: names });
    if (!r.ok) return { results, failure: r.code };
    const parsed = parseClassification(r.text, pending.length, names);
    if (!parsed) return { results, failure: 'invalid-output' };
    pending.forEach((noteIndex, k) => (results[noteIndex] = parsed[k].map((p: Pick) => ({ source: 'ai' as const, target: byName.get(p.option)!, label: p.option, confidence: p.confidence }))));
    return { results };
  }

  // 1a: the same for income, choosing among the kinds of income source
  async suggestIncomeKinds(notes: readonly string[]): Promise<{ results: Suggestion[][]; failure?: AiFailure }> {
    const kinds = ['payroll', 'bonus-commission', 'freelance', 'commercial-sales', 'vehicle-trade', 'parts-accessories', 'extraordinary'];
    const results: Suggestion[][] = notes.map((n) => {
      const rule = this.rules.match(n, 'income');
      return rule ? [{ source: 'rule', target: rule.target, label: rule.target, confidence: 1 }] : [];
    });
    const pending = notes.map((_, i) => i).filter((i) => !results[i].length);
    if (!pending.length) return { results };
    const r = await this.ai.run('income-classify', { items: this.cleaned(pending.map((i) => notes[i])), options: kinds });
    if (!r.ok) return { results, failure: r.code };
    const parsed = parseClassification(r.text, pending.length, kinds);
    if (!parsed) return { results, failure: 'invalid-output' };
    pending.forEach((noteIndex, k) => (results[noteIndex] = parsed[k].map((p: Pick) => ({ source: 'ai' as const, target: p.option, label: p.option, confidence: p.confidence }))));
    return { results };
  }

  // 2b: bank-style notes to a short name
  async normalizeNames(notes: readonly string[]): Promise<{ names: (string | null)[]; failure?: AiFailure }> {
    const distinct = [...new Set(this.cleaned(notes).filter(Boolean))].slice(0, 30);
    if (!distinct.length) return { names: [] };
    const r = await this.ai.run('expense-recurring-normalize', { items: distinct });
    if (!r.ok) return { names: distinct.map(() => null), failure: r.code };
    const parsed = parseNames(r.text, distinct.length);
    return parsed ? { names: parsed } : { names: distinct.map(() => null), failure: 'invalid-output' };
  }

  // 4b: families of items; the user confirms and the groups become local rules
  async groupItems(): Promise<{ names: string[]; groups: Group[]; failure?: AiFailure }> {
    const names = [...new Set(this.business.operations().map((o) => o.name))].slice(0, 60);
    if (names.length < 2) return { names, groups: [] };
    const r = await this.ai.run('business-grouping', { items: this.cleaned(names) });
    if (!r.ok) return { names, groups: [], failure: r.code };
    const parsed = parseGroups(r.text, names.length);
    return parsed ? { names, groups: parsed } : { names, groups: [], failure: 'invalid-output' };
  }

  confirmGroup(g: Group, names: readonly string[]): number {
    return g.members.filter((m) => this.rules.learn('item', names[m], g.name)).length;
  }

  // The ranking is calculated here, on the confirmed groups
  bestSellers() {
    const sellers = this.business.operations().map((op) => {
      const facts = this.business.factsOf(op);
      return { name: op.name, units: facts.reduce((s, f) => s + f.sale.quantity, 0), netProfit: facts.reduce((s, f) => s + f.netProfit, 0) };
    });
    return rankByGroups(sellers.filter((s) => s.units > 0), this.rules.rules());
  }

  // 5b: for the doubtful candidates (the score of the detector is the filter), the pair of notes and a range
  doubtfulPairs() {
    const byId = new Map(this.transactions.transactions().map((t) => [t.id, t]));
    return findDuplicateCandidates(this.transactions.transactions(), this.today(), 75)
      .slice(0, 5)
      .map((c) => ({ c, a: byId.get(c.aId)!, b: byId.get(c.bId)! }))
      .filter((x) => x.a && x.b);
  }

  async judgeDuplicates(): Promise<{ pairs: ReturnType<AiAssistService['doubtfulPairs']>; verdicts: { index: number; verdict: Verdict; reason: string }[]; failure?: AiFailure }> {
    const pairs = this.doubtfulPairs();
    if (!pairs.length) return { pairs, verdicts: [] };
    const ctx = this.ctx();
    const range = (n: number) => `${Math.floor(n / 100) * 100}-${Math.floor(n / 100) * 100 + 100}`;
    const r = await this.ai.run('duplicate-judge', { pairs: pairs.map((p) => ({ a: scrubNote(p.a.note ?? '', ctx).slice(0, 120) || '-', b: scrubNote(p.b.note ?? '', ctx).slice(0, 120) || '-', range: range(p.c.amount) })) });
    if (!r.ok) return { pairs, verdicts: [], failure: r.code };
    const parsed = parseVerdicts(r.text, pairs.length);
    return parsed ? { pairs, verdicts: parsed } : { pairs, verdicts: [], failure: 'invalid-output' };
  }

  // 8b: the model only reorders; the deterministic order is by the size of the change
  indicatorChanges(): { id: string; change: number }[] {
    const { year, month } = this.ym();
    const prev = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
    const rows = this.dashboard.compare(prev, `${year}-${String(month).padStart(2, '0')}`);
    return rows.filter((r) => r.percent !== null).map((r) => ({ id: slug(String(r.id)), change: Math.round(r.percent! * 10) / 10 }));
  }

  async rankIndicators(): Promise<{ order: string[]; source: 'ai' | 'fallback'; failure?: AiFailure }> {
    const changes = this.indicatorChanges();
    const ids = changes.map((c) => c.id);
    const fallback = [...changes].sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).map((c) => c.id);
    if (!ids.length) return { order: [], source: 'fallback' };
    const r = await this.ai.run('dashboard-indicators-rank', { indicators: changes });
    if (!r.ok) return { order: fallback, source: 'fallback', failure: r.code };
    const parsed = parseOrder(r.text, ids);
    return parsed ? { order: parsed, source: 'ai' } : { order: fallback, source: 'fallback', failure: 'invalid-output' };
  }

  // 3c: the three strategies are calculated; the model only picks one and explains why
  strategies(): Prepared | null {
    const now = this.ym();
    const input = { guaranteed: this.income.capacity().guaranteedMonthly, monthsAvailable: this.income.availableHistory(3), actual: this.income.monthBreakdown(now.year, now.month).available };
    const amounts = { historical: baseIncome('avg3', input).amount, conservative: baseIncome('guaranteed', input).amount, adjusted: baseIncome('actual', input).amount };
    if (!Object.values(amounts).some((a) => a > 0)) return null;
    const pick = amounts.conservative > 0 && amounts.conservative < amounts.historical * 0.8 ? 'conservative' : 'historical';
    const rows: NarrationRow[] = [
      { key: 'historical', amount: amounts.historical },
      { key: 'conservative', amount: amounts.conservative },
      { key: 'adjusted', amount: amounts.adjusted },
      { key: 'choice', amount: amounts[pick], text: this.t(pick) },
    ];
    return this.P('budget-strategy-pick', rows, 'The {choice_text} strategy fits you best, with a base of {choice_amount} (historical {historical_amount}, conservative {conservative_amount}, adjusted {adjusted_amount}).');
  }

  async chooseStrategy(): Promise<NarrateOutcome & { choice?: string }> {
    const prepared = this.strategies();
    if (!prepared) return NONE;
    const options = ['historical', 'conservative', 'adjusted'];
    const r = await this.ai.run('budget-strategy-pick', { ...prepared.wire, options });
    if (!r.ok) return { prepared, text: prepared.fallback, source: 'fallback', failure: r.code };
    const parsed = parseChoice(r.text, options);
    const final = parsed ? finalizeText(parsed.text, prepared.values) : null;
    if (!parsed || !final || !final.ok) return { prepared, text: prepared.fallback, source: 'fallback', failure: 'invalid-output' };
    return { prepared, text: final.text, source: 'ai', choice: parsed.choice };
  }


  // The exact body a non-narrating function would send now (for the first-use explanation)
  previewWire(featureId: string): unknown {
    const ctx = this.ctx();
    const clean = (list: readonly string[]) => list.map((n) => scrubNote(n, ctx).slice(0, 120));
    switch (featureId) {
      case 'expense-categorize':
        return this.ai.preview(featureId, { items: clean(this.uncategorizedExpenses().slice(0, 15).map((g) => g.text)), options: this.optionNames('expense').names });
      case 'income-classify':
        return this.ai.preview(featureId, { items: clean(this.unclassifiedIncome().slice(0, 15).map((g) => g.text)), options: ['payroll', 'bonus-commission', 'freelance', 'commercial-sales', 'vehicle-trade', 'parts-accessories', 'extraordinary'] });
      case 'expense-recurring-normalize':
        return this.ai.preview(featureId, { items: clean(this.recurringNotes()) });
      case 'business-grouping':
        return this.ai.preview(featureId, { items: clean([...new Set(this.business.operations().map((o) => o.name))].slice(0, 60)) });
      case 'duplicate-judge':
        return this.ai.preview(featureId, { pairs: this.doubtfulPairs().map((p) => ({ a: scrubNote(p.a.note ?? '', ctx).slice(0, 120) || '-', b: scrubNote(p.b.note ?? '', ctx).slice(0, 120) || '-', range: String(Math.floor(p.c.amount / 100) * 100) + '-' + String(Math.floor(p.c.amount / 100) * 100 + 100) })) });
      case 'dashboard-indicators-rank':
        return this.ai.preview(featureId, { indicators: this.indicatorChanges() });
      case 'budget-strategy-pick': {
        const p = this.strategies();
        return this.ai.preview(featureId, p ? { ...p.wire, options: ['historical', 'conservative', 'adjusted'] } : {});
      }
      default: {
        const p = this.prepare(featureId);
        return this.ai.preview(featureId, p ? p.wire : {});
      }
    }
  }

  // ----- applying an accepted suggestion (always a user action)

  applyCategory(txIds: readonly string[], categoryId: string, note: string): number {
    let done = 0;
    for (const id of txIds) {
      const tx = this.transactions.byId(id);
      if (tx && this.transactions.update({ ...tx, categoryId, subcategoryId: undefined }).ok) done++;
    }
    if (done) this.rules.learn('expense', note, categoryId);
    return done;
  }

  // Uses an existing source of that kind; with none (or several) the user decides in Income
  applyIncomeKind(txIds: readonly string[], kind: string, note: string): 'applied' | 'no-source' | 'several' {
    const sources = this.income.sources().filter((s) => s.active && s.kind === kind);
    if (sources.length !== 1) return sources.length ? 'several' : 'no-source';
    this.income.assign(txIds, sources[0].id);
    this.rules.learn('income', note, kind);
    return 'applied';
  }

  // ----- review lists

  uncategorizedExpenses() {
    const other = 'cat-other-expense';
    return groupByText(this.transactions.transactions().filter((t) => t.type === 'expense' && t.status !== 'reversed' && t.scope !== 'business' && (!t.categoryId || t.categoryId === other) && !!t.note).map((t) => ({ id: t.id, note: t.note! })));
  }

  unclassifiedIncome() {
    return groupByText(this.transactions.transactions().filter((t) => t.type === 'income' && t.status !== 'reversed' && t.scope !== 'business' && !t.incomeSourceId && t.origin !== 'loan-disbursement' && t.origin !== 'adjustment' && !!t.note).map((t) => ({ id: t.id, note: t.note! })));
  }

  // distinct notes of expenses that repeat (the deterministic detector decides which; here, the texts)
  recurringNotes(): string[] {
    const counts = new Map<string, number>();
    const from = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
    for (const t of this.transactions.transactions()) if (t.type === 'expense' && t.note && t.date >= from) counts.set(t.note.trim(), (counts.get(t.note.trim()) ?? 0) + 1);
    return [...counts.entries()].filter(([, n]) => n >= 3).map(([note]) => note).slice(0, 30);
  }

}
