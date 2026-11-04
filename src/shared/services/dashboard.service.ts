import { Injectable, computed, signal } from '@angular/core';
import {
  Cashflow,
  ComparisonRow,
  ExternalFigures,
  Indicator,
  IndicatorComponent,
  MonthFlow,
  MonthSnapshot,
  SavingsPoint,
  UnusualResult,
  availableMoney,
  cashflowProjection,
  compareMonths,
  expenseBreakdown,
  monthlyFlow,
  savingsHistory,
  unusualExpenses,
} from '../domain/dashboard';
import { variableRates } from '../domain/budget';
import { natureOfTransaction } from '../domain/categories';
import { addDays, lastDayOfMonth, localIso } from '../domain/dates';
import { occurrencesUntil } from '../domain/fixed';
import { totalBalance, txCurrency } from '../domain/ledger';
import { isCounted, summarize } from '../domain/stats';
import { addMoney, round2, sumMoney } from '../utils/money';
import { AccountService } from './account.service';
import { BudgetService } from './budget.service';
import { BusinessService } from './business.service';
import { GoalService } from './goal.service';
import { LoanService } from './loan.service';
import { CategoryService } from './category.service';
import { CreditCardService } from './credit-card.service';
import { FixedExpenseService } from './fixed-expense.service';
import { IncomeSourceService } from './income-source.service';
import { IncomeService } from './income.service';
import { NetWorthService } from './net-worth.service';
import { SettingsService } from './settings.service';
import { TransactionService } from './transaction.service';

const money = (label: string, amount: number | null, kind: IndicatorComponent['kind'] = 'data', note?: string): IndicatorComponent => ({ label, amount, kind, note });

// The dashboard composes what the earlier modules already calculate (ledger, net worth, cards,
// income, budgets, fixed obligations); it has no money logic of its own beyond adding up their
// answers. Indicators of modules that do not exist yet (business, savings goals, loans) are
// hidden until those modules call provide(): a made-up zero would mislead. Every figure that
// looks ahead is flagged as an estimate with its assumptions (rule 10).
@Injectable({ providedIn: 'root' })
export class DashboardService {
  private _external = signal<ExternalFigures>({});
  external = this._external.asReadonly();

  // what the modules hand over (provide) plus what the business module knows by itself
  private figures = computed<ExternalFigures>(() => ({ ...this._external(), ...this.business.dashboardFigures(), ...this.goals.dashboardFigures(), ...this.loans.dashboardFigures() }));

  constructor(
    private transactions: TransactionService,
    private accounts: AccountService,
    private categories: CategoryService,
    private netWorth: NetWorthService,
    private cards: CreditCardService,
    private income: IncomeService,
    private incomeSources: IncomeSourceService,
    private budget: BudgetService,
    private fixed: FixedExpenseService,
    private settings: SettingsService,
    private business: BusinessService,
    private goals: GoalService,
    private loans: LoanService
  ) {}

  // The contract for prompts 06 (business), 07 (savings goals) and 08 (loans): they hand over
  // their figures here and the matching indicators appear.
  provide(figures: ExternalFigures): void {
    this._external.set({ ...this._external(), ...figures });
  }

  today(): string {
    return localIso(this.transactions.clock());
  }

  private ym() {
    const today = this.today();
    return { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)), today };
  }

  // ----- month parts, computed once per change of data

  private monthTxs = computed(() => {
    const { year, month } = this.ym();
    return this.transactions.forMonth(year, month);
  });

  private incomeBreakdown = computed(() => {
    const { year, month } = this.ym();
    return this.income.monthBreakdown(year, month);
  });

  private expenseParts = computed(() => expenseBreakdown(this.monthTxs(), (t) => natureOfTransaction(t, (id) => this.categories.byId(id))));

  // ----- the ten indicators

  indicators = computed<Indicator[]>(() => {
    const list = [this.availableIndicator(), this.incomeIndicator(), this.expensesIndicator(), this.commercialProfitIndicator(), this.businessCapitalIndicator(), this.savingsIndicator(), this.debtsIndicator(), this.utilizationIndicator(), this.budgetIndicator(), this.netWorthIndicator()];
    return list;
  });

  // The ones with a module behind them; hidden ones are `available: false`
  visible = computed(() => this.indicators().filter((i) => i.available));
  byId(id: Indicator['id']): Indicator | undefined {
    return this.indicators().find((i) => i.id === id);
  }

  private incomeIndicator(): Indicator {
    const b = this.incomeBreakdown();
    const cap = this.income.capacity();
    // income that has no source yet is not personal income until classified: showing 0 would be a lie
    const onlyUnclassified = b.unclassified > 0 && b.personalNet + b.commercialGross === 0 && this.incomeSources.sources().length === 0;
    const hasData = !onlyUnclassified && (b.personalNet + b.commercialGross + b.unclassified > 0 || this.incomeSources.sources().length > 0);
    return {
      id: 'income',
      label: 'Income this month',
      value: hasData ? b.personalNet : null,
      display: 'money',
      currency: 'DOP',
      components: [
        money('Personal income received (net)', b.personalNet),
        money('Commercial sales (gross revenue), shown apart', b.commercialGross, 'excluded', 'Revenue, not profit.'),
        money('Unclassified income', b.unclassified, 'excluded', 'Classify it in Income to count it.'),
        money('Guaranteed per month', cap.guaranteedMonthly, 'estimate', 'Recurring and documented sources only.'),
      ],
      formula: 'Personal net income received this month. Transfers, loans disbursed and non-monetary benefits are never income; commercial sales are shown apart as gross revenue.',
      sources: ['IncomeService.monthBreakdown', 'IncomeService.capacity'],
      estimate: false,
      available: true,
      missing: hasData ? undefined : onlyUnclassified ? 'Your income has no source yet. Classify it in Income to see this figure.' : 'No income recorded yet. Add an income source or record an income.',
    };
  }

  private expensesIndicator(): Indicator {
    const e = this.expenseParts();
    const txs = this.monthTxs();
    let transfers = 0;
    let cardPayments = 0;
    for (const t of txs) {
      if (t.type !== 'transfer' || t.status === 'reversed' || txCurrency(t) !== 'DOP') continue;
      if (t.origin === 'card-payment') cardPayments = addMoney(cardPayments, t.amount);
      else transfers = addMoney(transfers, t.amount);
    }
    const hasData = txs.some((t) => t.type === 'expense' && isCounted(t));
    return {
      id: 'expenses',
      label: 'Expenses this month',
      value: hasData ? e.total : null,
      display: 'money',
      currency: 'DOP',
      components: [
        money('Fixed', e.fixed),
        money('Variable (includes bank fees)', e.variable),
        money('Transfers between your accounts', transfers, 'excluded', 'Not an expense (rule 1).'),
        money('Credit card payments', cardPayments, 'excluded', 'Settles purchases already counted (rule 3).'),
      ],
      formula: 'Real expenses of the month, split fixed / variable. Transfers, credit card payments and reversed movements are not expenses.',
      sources: ['TransactionService', 'domain/stats'],
      estimate: false,
      available: true,
      missing: hasData ? undefined : 'No expenses recorded this month yet.',
    };
  }

  private commercialProfitIndicator(): Indicator {
    const b = this.incomeBreakdown();
    const ext = this.figures().commercialProfit;
    const hasCommercial = this.business.hasOperations() || b.commercialGross > 0 || b.commercialWithoutCost > 0 || this.incomeSources.sources().some((s) => ['commercial-sales', 'vehicle-trade', 'parts-accessories'].includes(s.kind));
    const base = { id: 'commercial-profit' as const, label: 'Commercial profit', display: 'money' as const, currency: 'DOP' as const, sources: ['IncomeService.monthBreakdown'], estimate: false };
    if (ext) {
      return { ...base, value: ext.value, components: ext.components ?? [money('Net benefit of the month (business module)', ext.value)], formula: 'Net benefit of the month: sale price − cost − expenses of each operation.', available: true };
    }
    return {
      ...base,
      value: hasCommercial ? b.commercialNetBenefit : null,
      components: [
        money('Commercial sales (gross revenue)', b.commercialGross, 'excluded', 'Revenue, not profit (rule 5).'),
        money('Net benefit (only sales with a cost)', b.commercialNetBenefit),
        money('Sales without a cost yet', b.commercialWithoutCost, 'excluded', 'Their benefit is unknown, not zero.'),
      ],
      formula: 'Net benefit of commercial sales = price − cost − sale expenses. A sale without a cost has no benefit yet.',
      available: hasCommercial,
    };
  }

  private businessCapitalIndicator(): Indicator {
    const ext = this.figures().businessCapital;
    return {
      id: 'business-capital',
      label: 'Capital invested in business',
      value: ext?.value ?? null,
      display: 'money',
      currency: 'DOP',
      components: ext?.components ?? [],
      formula: 'Unsold inventory at cost. It is never mixed with your personal assets (rule 6).',
      sources: ['Business module'],
      estimate: false,
      available: !!ext,
    };
  }

  private availableIndicator(): Indicator {
    const liquid = this.netWorth.summary().liquid.DOP;
    const today = this.today();
    const horizon = addDays(today, 30);
    let cardDue = 0;
    for (const s of this.cards.statements()) {
      if (s.currency !== 'DOP' || s.dueDate > horizon) continue;
      cardDue = addMoney(cardDue, this.cards.remainingOf(s));
    }
    const loanDue = sumMoney(this.loans.dueBetween(today, horizon).map((d) => d.amount));
    const fixedPending = this.fixed.summary().pendingThisMonth;
    const reserved = this.figures().goalsReserved?.value ?? 0;
    const value = availableMoney(liquid, [cardDue, loanDue, fixedPending], reserved);
    return {
      id: 'available',
      label: 'Available money',
      value,
      display: 'money',
      currency: 'DOP',
      components: [
        money('Liquid net worth', liquid, 'data', 'Cash, bank and savings accounts.'),
        money('Card payments due in 30 days', -cardDue, 'data'),
        ...(loanDue > 0 ? [money('Loan installments due in 30 days', -loanDue, 'data')] : []),
        money('Fixed obligations still to pay this month', -fixedPending, 'data', 'From your recurring expenses.'),
        this.figures().goalsReserved ? money('Set aside in goals', -reserved, 'data') : money('Set aside in goals', null, 'excluded', 'Not part of the formula until the savings goals exist.'),
        money('Non-monetary benefits', null, 'excluded', 'Never cash (rule 4).'),
      ],
      formula: 'Liquid net worth − card payments and loan installments due in the next 30 days − fixed obligations still to pay this month − money set aside in goals.',
      sources: ['NetWorthService', 'CreditCardService', 'FixedExpenseService'],
      estimate: false,
      available: true,
    };
  }

  private savingsIndicator(): Indicator {
    const accounts = this.accounts.activeAccounts().filter((a) => a.type === 'savings');
    const ext = this.figures().goalsSaved;
    const inAccounts = sumMoney(accounts.map((a) => this.transactions.accountBalance(a.id, 'DOP')));
    return {
      id: 'savings',
      label: 'Accumulated savings',
      value: round2(inAccounts + (ext?.value ?? 0)),
      display: 'money',
      currency: 'DOP',
      components: [
        ...accounts.map((a) => money(a.name, this.transactions.accountBalance(a.id, 'DOP'))),
        ...(ext ? ext.components ?? [money('Goal contributions outside savings accounts', ext.value)] : []),
      ],
      formula: 'Balance of your savings accounts + goal contributions that are not already inside a savings account (never counted twice).',
      sources: ['TransactionService', 'Savings goals module'],
      estimate: false,
      available: accounts.length > 0 || !!ext,
    };
  }

  private debtsIndicator(): Indicator {
    const cards = this.cards.cards();
    const loans = this.figures().loanBalance;
    const owed = this.cards.totalOwed();
    const parts = cards.filter((c) => this.cards.debtOf(c, 'DOP').owed > 0).map((c) => money(c.name, this.cards.debtOf(c, 'DOP').owed));
    return {
      id: 'debts',
      label: 'Pending debts',
      value: round2(owed.DOP + (loans?.value ?? 0)),
      display: 'money',
      currency: 'DOP',
      components: [...parts, ...(loans ? [money('Loans', loans.value)] : []), ...(owed.USD > 0 ? [money('Owed in US$ (not added)', owed.USD, 'excluded', 'RD$ and US$ are never added.')] : [])],
      formula: 'Used balance of credit cards + balance of loans.',
      sources: ['CreditCardService.totalOwed', 'LoanService.totalOwed'],
      estimate: false,
      available: cards.length > 0 || !!loans,
    };
  }

  private utilizationIndicator(): Indicator {
    const cards = this.cards.cards().filter((c) => c.currency !== 'USD');
    const all = this.cards.consolidated('DOP');
    const withLimit = cards.filter((c) => this.cards.utilization(c, 'DOP').percent !== null);
    return {
      id: 'card-utilization',
      label: 'Card utilization',
      value: all.percent,
      display: 'percent',
      currency: 'DOP',
      components: withLimit.map((c) => ({ label: c.name, amount: this.cards.utilization(c, 'DOP').percent, display: 'percent' as const, kind: 'data' as const })),
      formula: 'Used balance ÷ credit limit, all your cards together and each one (RD$ only). 30% and 90% are a usual reference you can change.',
      sources: ['CreditCardService.utilization'],
      estimate: false,
      available: cards.length > 0,
      missing: all.percent === null ? 'Set the credit limit of your cards to see the utilization.' : undefined,
    };
  }

  private budgetIndicator(): Indicator {
    const r = this.budget.remainingThisMonth();
    const has = this.budget.budgets().length > 0;
    return {
      id: 'budget-left',
      label: 'Budget left',
      value: has ? r.remaining : null,
      display: 'money',
      currency: 'DOP',
      components: [money('Budget limits this month', r.limit), money('Spent in those categories', r.spent)],
      formula: 'Sum of the budget limits of the month (with moved money) − what was spent in those categories; reversed movements are excluded.',
      sources: ['BudgetService.remainingThisMonth'],
      estimate: false,
      available: true,
      missing: has ? undefined : 'No budgets yet. Set a monthly limit in Budgets.',
    };
  }

  private netWorthIndicator(): Indicator {
    const nw = this.netWorth.summary();
    const capital = this.figures().commercialWorkingCapital;
    return {
      id: 'net-worth',
      label: 'Financial net worth',
      value: nw.net.DOP,
      display: 'money',
      currency: 'DOP',
      components: [
        money('Liquid net worth', nw.liquid.DOP),
        money('Credit card debt', -nw.cardDebt.DOP),
        ...(nw.loanDebt.DOP > 0 ? [money('Loans', -nw.loanDebt.DOP)] : []),
        ...(capital ? [money('Commercial capital (apart, not added)', capital.value, 'excluded', 'Business inventory is never mixed with personal assets (rule 6).')] : []),
      ],
      formula: 'Liquid net worth − credit card debt − what is owed on loans. Commercial capital is shown apart.',
      sources: ['NetWorthService'],
      estimate: false,
      available: true,
    };
  }

  // ----- analyses

  flow12 = computed<MonthFlow[]>(() => monthlyFlow(this.transactions.transactions(), this.today(), 12));

  savings12 = computed<SavingsPoint[]>(() => savingsHistory(this.accounts.accounts(), this.transactions.transactions(), this.today(), 12, this.goals.activeCount() ? (date) => this.goals.reservedOutsideAt(date) : undefined));

  // Income sources ranked by weight in the last 12 months, with their stability
  topSources = computed(() =>
    this.income
      .weights()
      .filter((w) => w.sourceId !== null)
      .map((w) => {
        const source = this.incomeSources.byId(w.sourceId!);
        return source ? { source, total: w.total, percent: w.percent, stability: this.income.stabilityOf(source) } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
  );

  // Expense totals per category of a month ('YYYY-MM'), biggest first
  categoryShare(monthKey: string) {
    const totals = this.transactions.categoryTotals(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)), 'expense');
    const sum = sumMoney(totals.map((t) => t.total));
    return totals.map((t) => ({ category: this.categories.byId(t.categoryId), categoryId: t.categoryId, total: t.total, percent: sum > 0 ? Math.round((t.total / sum) * 1000) / 10 : 0 }));
  }

  // What a month looked like, to compare two of them
  snapshot(monthKey: string): MonthSnapshot {
    const year = Number(monthKey.slice(0, 4));
    const month = Number(monthKey.slice(5, 7));
    const txs = this.transactions.forMonth(year, month);
    const b = this.income.monthBreakdown(year, month);
    const e = expenseBreakdown(txs, (t) => natureOfTransaction(t, (id) => this.categories.byId(id)));
    const s = summarize(txs);
    const end = `${monthKey}-${String(lastDayOfMonth(year, month)).padStart(2, '0')}`;
    const asOf = end > this.today() ? this.today() : end;
    return {
      personalNet: b.personalNet,
      commercialGross: b.commercialGross,
      commercialBenefit: b.commercialNetBenefit,
      expense: e.total,
      fixedExpense: e.fixed,
      variableExpense: e.variable,
      netFlow: round2(s.income - s.expense),
      liquidEnd: totalBalance(this.accounts.accounts(), this.transactions.transactions(), 'DOP', { liquidOnly: true, asOf }),
    };
  }

  compare(a: string, b: string): ComparisonRow[] {
    return compareMonths(this.snapshot(a), this.snapshot(b));
  }

  // Cash flow for 30, 60 and 90 days (an estimate)
  cashflow = computed<Cashflow>(() => this.buildCashflow(this.settings.dashboard().includeVariableIncome));

  // The same projection with variable income on or off (the insights show both: "what if it does not arrive")
  buildCashflow(includeVariableIncome: boolean): Cashflow {
    const today = this.today();
    const end = addDays(today, 90);
    const d = this.settings.dashboard();
    const fixed = [
      ...this.fixed.rules().flatMap((r) => occurrencesUntil(r, end).map((date) => ({ date, amount: r.amount }))),
      ...this.loans.dueBetween(today, end).map((d) => ({ date: d.date, amount: d.amount })), // loan installments (an estimate: the schedule)
    ];
    const cards = this.cards
      .statements()
      .filter((s) => s.currency === 'DOP' && s.dueDate <= end)
      .map((s) => ({ date: s.dueDate, amount: this.cards.remainingOf(s) }))
      .filter((e) => e.amount > 0);
    const rates = variableRates(this.transactions.transactions(), this.categories.categories(), today);
    return cashflowProjection({
      startLiquid: this.netWorth.summary().liquid.DOP,
      today,
      income: this.income.guaranteedExpectedEvents(today, end),
      variableIncomeMonthly: this.income.capacity().variableAverage,
      includeVariableIncome,
      fixed,
      cards,
      rates,
      cushion: d.cushion,
    });
  }

  unusual = computed<UnusualResult>(() => unusualExpenses(this.transactions.transactions(), this.today(), this.settings.dashboard().unusualMin));

  // Months to pick in the comparison: this one and the previous 11
  months(): string[] {
    const flow = this.flow12();
    return flow.map((m) => m.month).reverse();
  }

  // A real, counted expense movement by id (to explain why it was flagged)
  expenseOf(id: string) {
    const t = this.transactions.byId(id);
    return t && t.type === 'expense' && isCounted(t) ? t : undefined;
  }
}
