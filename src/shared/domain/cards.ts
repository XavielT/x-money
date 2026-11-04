// Credit cards: periods, statements, payments, utilization and alerts. Pure. A card's debt is
// never stored: it is minus the card's balance from domain/ledger (purchases and fees lower
// it, payments raise it), so integrity rules 2 and 3 hold by construction: the purchase is
// ONE expense on its day, and paying the card is a transfer that lowers the debt and the
// paying account without being a second expense. RD$ and US$ are never mixed.
import { AccountModel, CardConfig } from '../models/account.model';
import { CardStatementModel, StatementStatus } from '../models/card-statement.model';
import { TransactionCurrency, TransactionModel } from '../models/transaction.model';
import { addMoney, round2, subMoney } from '../utils/money';
import { addDays, daysBetween } from './dates';
import { LedgerAccount, accountBalance, ownerId, txCurrency } from './ledger';
import { isCounted } from './stats';

export const CARD_INTEREST_CATEGORY = 'cat-card-interest';

// Usual references, shown as such and editable per card; not a rule for everyone
export const DEFAULT_WARN_AT = 30;
export const DEFAULT_DANGER_AT = 90;
export const DEFAULT_MIN_PERCENT = 5;

export const isCreditCard = (a: Pick<AccountModel, 'type' | 'cardKind'>): boolean => a.type === 'card' && a.cardKind === 'credit';

export const cardCurrencies = (a: Pick<AccountModel, 'currency'>): TransactionCurrency[] =>
  a.currency === 'dual' ? ['DOP', 'USD'] : [a.currency === 'USD' ? 'USD' : 'DOP'];

export const limitOf = (card: CardConfig | undefined, currency: TransactionCurrency): number | undefined => {
  const v = currency === 'USD' ? card?.creditLimitUsd : card?.creditLimit;
  return v !== undefined && Number.isFinite(v) && v > 0 ? round2(v) : undefined;
};

const validDay = (d: unknown): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 1 && d <= 31;

// What the card still lacks for statements, alerts and utilization (empty = complete)
export type CardMissing = 'limit' | 'cut' | 'due';
export function missingCardData(account: Pick<AccountModel, 'currency' | 'card'>): CardMissing[] {
  const c = account.card;
  const missing: CardMissing[] = [];
  if (!cardCurrencies(account).every((cur) => limitOf(c, cur) !== undefined)) missing.push('limit');
  if (!validDay(c?.cutDay)) missing.push('cut');
  const dueOk =
    c?.dueMode === 'days-after'
      ? Number.isInteger(c.dueDays) && c.dueDays! >= 0 && c.dueDays! <= 60
      : c?.dueMode === 'fixed-day'
        ? validDay(c.dueDay)
        : false;
  if (!dueOk) missing.push('due');
  return missing;
}

// ---- calendar of cuts

const lastDayOf = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12

export function cutDateIn(year: number, month: number, cutDay: number): string {
  const d = Math.min(cutDay, lastDayOf(year, month));
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const ymOf = (iso: string): [number, number] => [Number(iso.slice(0, 4)), Number(iso.slice(5, 7))];
const shiftMonth = (y: number, m: number, by: number): [number, number] => {
  const idx = y * 12 + (m - 1) + by;
  return [Math.floor(idx / 12), (idx % 12) + 1];
};

// First cut on or after `date`
export function nextCutOnOrAfter(date: string, cutDay: number): string {
  const [y, m] = ymOf(date);
  const here = cutDateIn(y, m, cutDay);
  if (here >= date) return here;
  const [ny, nm] = shiftMonth(y, m, 1);
  return cutDateIn(ny, nm, cutDay);
}

// Last cut on or before `date`
export function prevCutOnOrBefore(date: string, cutDay: number): string {
  const [y, m] = ymOf(date);
  const here = cutDateIn(y, m, cutDay);
  if (here <= date) return here;
  const [py, pm] = shiftMonth(y, m, -1);
  return cutDateIn(py, pm, cutDay);
}

export const nextCutAfter = (cut: string, cutDay: number): string => nextCutOnOrAfter(addDays(cut, 1), cutDay);
export const prevCutBefore = (cut: string, cutDay: number): string => prevCutOnOrBefore(addDays(cut, -1), cutDay);

const rule = (c: CardConfig): 'closing' | 'next' => (c.cutDayPurchases === 'next' ? 'next' : 'closing');

export interface Period {
  start: string;
  end: string;
  cut: string;
}

// The period a cut closes. With the default rule the cut day belongs to the period that
// closes; with 'next' it opens the following one (and the closing one ends the day before).
export function periodOfCut(cut: string, config: CardConfig): Period {
  const prev = prevCutBefore(cut, config.cutDay!);
  return rule(config) === 'next' ? { start: prev, end: addDays(cut, -1), cut } : { start: addDays(prev, 1), end: cut, cut };
}

// The cut whose statement a movement of `date` falls into
export function cutForDate(date: string, config: CardConfig): string {
  return nextCutOnOrAfter(rule(config) === 'next' ? addDays(date, 1) : date, config.cutDay!);
}

export function dueDateOf(cut: string, config: CardConfig): string {
  if (config.dueMode === 'fixed-day') {
    // the first such day after the cut
    const [y, m] = ymOf(cut);
    const here = cutDateIn(y, m, config.dueDay!);
    if (here > cut) return here;
    const [ny, nm] = shiftMonth(y, m, 1);
    return cutDateIn(ny, nm, config.dueDay!);
  }
  return addDays(cut, config.dueDays ?? 0);
}

// ---- debt, available credit, utilization

export interface CardDebt {
  currency: TransactionCurrency;
  owed: number; // what is owed now (>= 0)
  inFavor: number; // balance in the user's favor after paying more than owed (>= 0)
  limit?: number;
  available?: number; // limit - owed (negative if the limit is exceeded)
}

export function cardDebt(
  accounts: readonly LedgerAccount[],
  txs: readonly TransactionModel[],
  account: AccountModel,
  currency: TransactionCurrency,
  asOf?: string
): CardDebt {
  const balance = accountBalance(accounts, txs, account.id, currency, asOf);
  const limit = limitOf(account.card, currency);
  const owed = balance < 0 ? round2(-balance) : 0;
  return {
    currency,
    owed,
    inFavor: balance > 0 ? round2(balance) : 0,
    limit,
    available: limit === undefined ? undefined : subMoney(limit, owed),
  };
}

export type UtilizationLevel = 'ok' | 'warn' | 'danger';

export interface Utilization {
  percent: number | null; // null without a limit
  level: UtilizationLevel | null;
}

export function utilizationOf(owed: number, limit: number | undefined, warnAt = DEFAULT_WARN_AT, dangerAt = DEFAULT_DANGER_AT): Utilization {
  if (limit === undefined || !(limit > 0)) return { percent: null, level: null };
  const p = round2((owed / limit) * 100);
  return { percent: p, level: p >= dangerAt ? 'danger' : p >= warnAt ? 'warn' : 'ok' };
}

// All cards of one currency together (only the cards that have a limit for it)
export function consolidatedUtilization(
  debts: readonly CardDebt[],
  warnAt = DEFAULT_WARN_AT,
  dangerAt = DEFAULT_DANGER_AT
): { owed: number; limit: number | undefined } & Utilization {
  let owed = 0;
  let limit = 0;
  for (const d of debts) {
    if (d.limit === undefined) continue;
    owed = addMoney(owed, d.owed);
    limit = addMoney(limit, d.limit);
  }
  const total = limit > 0 ? limit : undefined;
  return { owed, limit: total, ...utilizationOf(owed, total, warnAt, dangerAt) };
}

// ---- statements

// Estimate from the card's rule (percentage with a floor, never above the balance). The bank's
// real figure, when typed, replaces it.
export function minimumPayment(balance: number, config: CardConfig | undefined, currency: TransactionCurrency): number {
  if (balance <= 0) return 0;
  const floor = (currency === 'USD' ? config?.minFloorUsd : config?.minFloor) ?? 0;
  const byPercent = round2((balance * (config?.minPercent ?? DEFAULT_MIN_PERCENT)) / 100);
  return Math.min(round2(balance), Math.max(byPercent, round2(floor)));
}

export interface Breakdown {
  previous: number; // owed at the start (negative = in the user's favor)
  purchases: number;
  charges: number;
  advances: number; // money taken out of the card with a transfer
  payments: number;
  credits: number;
  closing: number; // previous + purchases + charges + advances - payments - credits
}

// Everything that moved the card's debt between two days, inclusive. Reversed pairs are
// included on both sides (they cancel), so the identity with the ledger is exact.
export function breakdown(
  accounts: readonly LedgerAccount[],
  txs: readonly TransactionModel[],
  cardId: string,
  currency: TransactionCurrency,
  start: string,
  end: string
): Breakdown {
  const previous = round2(-accountBalance(accounts, txs, cardId, currency, addDays(start, -1)));
  let purchases = 0;
  let charges = 0;
  let advances = 0;
  let payments = 0;
  let credits = 0;
  for (const t of txs) {
    if (txCurrency(t) !== currency || t.date < start || t.date > end) continue;
    const fromCard = ownerId(accounts, t.accountId) === cardId;
    const toCard = !!t.toAccountId && ownerId(accounts, t.toAccountId) === cardId;
    if (fromCard && t.fee) charges = addMoney(charges, t.fee);
    if (t.type === 'expense' && fromCard) {
      if (t.categoryId === CARD_INTEREST_CATEGORY) charges = addMoney(charges, t.amount);
      else purchases = addMoney(purchases, t.amount);
    } else if (t.type === 'income' && fromCard) {
      credits = addMoney(credits, t.amount);
    } else if (t.type === 'transfer') {
      if (toCard) payments = addMoney(payments, t.amount);
      if (fromCard) advances = addMoney(advances, t.amount);
    }
  }
  const closing = round2(previous + purchases + charges + advances - payments - credits);
  return { previous, purchases, charges, advances, payments, credits, closing };
}

export const statementId = (accountId: string, currency: TransactionCurrency, cut: string): string => `stmt-${accountId}-${currency}-${cut}`;

export const effectiveBalance = (s: Pick<CardStatementModel, 'calculatedBalance' | 'bankBalance'>): number => s.bankBalance ?? s.calculatedBalance;
export const effectiveMinimum = (s: Pick<CardStatementModel, 'calculatedMinimum' | 'bankMinimum'>): number => s.bankMinimum ?? s.calculatedMinimum;

// Statement for one cut, from the movements. Pure: the caller stores it.
export function buildStatement(
  accounts: readonly LedgerAccount[],
  txs: readonly TransactionModel[],
  card: AccountModel,
  currency: TransactionCurrency,
  cut: string,
  now: string
): CardStatementModel {
  const config = card.card!;
  const period = periodOfCut(cut, config);
  const b = breakdown(accounts, txs, card.id, currency, period.start, period.end);
  return {
    id: statementId(card.id, currency, cut),
    accountId: card.id,
    currency,
    periodStart: period.start,
    periodEnd: period.end,
    cutDate: cut,
    dueDate: dueDateOf(cut, config),
    previousBalance: b.previous,
    purchases: b.purchases,
    charges: b.charges,
    payments: b.payments,
    credits: b.credits,
    calculatedBalance: b.closing,
    calculatedMinimum: minimumPayment(b.closing, config, currency),
    generatedAt: now,
  };
}

const MAX_CUTS = 12;

// Cuts that are due to be closed and have no statement yet: the first time only the most
// recent one (history is not invented), afterwards every cut since the last statement.
// A cut closes on its own day.
export function cutsToClose(config: CardConfig, existing: readonly CardStatementModel[], today: string): string[] {
  if (missingCardData({ currency: 'DOP', card: { ...config, creditLimit: 1 } }).some((m) => m !== 'limit')) return [];
  const latest = existing
    .map((s) => s.cutDate)
    .sort()
    .pop();
  const cuts: string[] = [];
  let cut = latest ? nextCutAfter(latest, config.cutDay!) : prevCutOnOrBefore(today, config.cutDay!);
  while (cut <= today && cuts.length < MAX_CUTS) {
    cuts.push(cut);
    cut = nextCutAfter(cut, config.cutDay!);
  }
  return cuts;
}

// A period with no movement and no debt on either side is not worth a statement
export const isEmptyStatement = (s: CardStatementModel): boolean =>
  s.previousBalance === 0 && s.calculatedBalance === 0 && s.purchases === 0 && s.charges === 0 && s.payments === 0 && s.credits === 0;

// Payments made to the card (not reversed) after a date, in the card's currency
export function paymentsAfter(
  accounts: readonly LedgerAccount[],
  txs: readonly TransactionModel[],
  cardId: string,
  currency: TransactionCurrency,
  after: string
): number {
  let sum = 0;
  for (const t of txs) {
    if (t.type !== 'transfer' || t.status === 'reversed' || txCurrency(t) !== currency || t.date <= after) continue;
    if (t.toAccountId && ownerId(accounts, t.toAccountId) === cardId) sum = addMoney(sum, t.amount);
  }
  return sum;
}

// Balances are cumulative (the bank asks for everything owed at the cut), so what was paid
// AFTER the cut is applied to the oldest statement first without any extra bookkeeping.
export function amountPaid(statement: CardStatementModel, paidAfterCut: number): number {
  return Math.min(round2(Math.max(effectiveBalance(statement), 0)), round2(paidAfterCut));
}

export function statementStatus(statement: CardStatementModel, paidAfterCut: number, today: string): StatementStatus {
  const balance = effectiveBalance(statement);
  const paid = amountPaid(statement, paidAfterCut);
  if (balance <= 0 || paid >= balance) return 'paid';
  if (statement.dueDate < today) return 'overdue';
  return paid > 0 ? 'partial' : 'closed';
}

export const remainingOf = (statement: CardStatementModel, paidAfterCut: number): number =>
  Math.max(0, subMoney(Math.max(effectiveBalance(statement), 0), amountPaid(statement, paidAfterCut)));

// The bank charged more than the movements say: the difference is the real cost of credit
export function interestGap(statement: CardStatementModel): number {
  return statement.bankBalance === undefined ? 0 : Math.max(0, subMoney(statement.bankBalance, statement.calculatedBalance));
}

// ---- consumption (what was bought) vs paid (what was settled)

export interface Consumption {
  consumption: number; // counted purchases and charges, on the day they were made
  paid: number; // settlements received
}

export function consumptionOf(
  accounts: readonly LedgerAccount[],
  txs: readonly TransactionModel[],
  cardId: string,
  currency: TransactionCurrency,
  start: string,
  end: string
): Consumption {
  let consumption = 0;
  let paid = 0;
  for (const t of txs) {
    if (txCurrency(t) !== currency || t.date < start || t.date > end) continue;
    if (t.type === 'expense' && ownerId(accounts, t.accountId) === cardId && isCounted(t)) consumption = addMoney(consumption, t.amount);
    if (t.type === 'transfer' && t.status !== 'reversed' && t.toAccountId && ownerId(accounts, t.toAccountId) === cardId) paid = addMoney(paid, t.amount);
  }
  return { consumption, paid };
}

// ---- alerts

export type CardAlertStage = 'cut-3' | 'cut-today' | 'due-7' | 'due-3' | 'due-1' | 'overdue';

export interface CardAlert {
  key: string; // stable per card, statement and stage
  stage: CardAlertStage;
  accountId: string;
  currency: TransactionCurrency;
  date: string; // the cut or the due date
  daysLeft: number; // negative once overdue
  balance?: number; // due alerts: what is still owed on the statement
  minimum?: number;
}

export interface AlertInput {
  card: AccountModel;
  statements: readonly CardStatementModel[];
  paidAfter: (statement: CardStatementModel) => number;
}

export function cardAlerts(inputs: readonly AlertInput[], today: string): CardAlert[] {
  const out: CardAlert[] = [];
  for (const { card, statements, paidAfter } of inputs) {
    const c = card.card;
    if (!c) continue;
    if (!missingCardData(card).includes('cut')) {
      const nextCut = nextCutOnOrAfter(today, c.cutDay!);
      const toCut = daysBetween(today, nextCut);
      const currency = cardCurrencies(card)[0];
      if (toCut === 0) out.push({ key: `${card.id}:cut:${nextCut}:0`, stage: 'cut-today', accountId: card.id, currency, date: nextCut, daysLeft: 0 });
      else if (toCut <= 3) out.push({ key: `${card.id}:cut:${nextCut}:3`, stage: 'cut-3', accountId: card.id, currency, date: nextCut, daysLeft: toCut });
    }
    // due: unpaid statements only
    for (const s of statements) {
      if (s.accountId !== card.id) continue;
      const paid = paidAfter(s);
      if (statementStatus(s, paid, today) === 'paid') continue;
      const left = daysBetween(today, s.dueDate);
      const stage: CardAlertStage | null = left < 0 ? 'overdue' : left <= 1 ? 'due-1' : left <= 3 ? 'due-3' : left <= 7 ? 'due-7' : null;
      if (!stage) continue;
      const remaining = remainingOf(s, paid);
      out.push({
        key: `${s.id}:${stage}`,
        stage,
        accountId: card.id,
        currency: s.currency,
        date: s.dueDate,
        daysLeft: left,
        balance: remaining,
        minimum: Math.min(remaining, effectiveMinimum(s)),
      });
    }
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

// Notifications to schedule on the device: the same moments as the alerts, in the future.
// The text never names an amount (it would show on a locked screen).
export interface PlannedNotice {
  key: string;
  at: string; // ISO date; the device shows it in the morning
  kind: 'cut' | 'due';
  accountId: string;
}

export function plannedNotices(inputs: readonly AlertInput[], today: string, horizonDays = 45): PlannedNotice[] {
  const out: PlannedNotice[] = [];
  const horizon = addDays(today, horizonDays);
  const push = (n: PlannedNotice) => {
    if (n.at >= today && n.at <= horizon) out.push(n);
  };
  for (const { card, statements, paidAfter } of inputs) {
    const c = card.card;
    if (!c) continue;
    if (!missingCardData(card).includes('cut')) {
      let cut = nextCutOnOrAfter(today, c.cutDay!);
      while (cut <= horizon) {
        push({ key: `${card.id}:cut:${cut}:3`, at: addDays(cut, -3), kind: 'cut', accountId: card.id });
        push({ key: `${card.id}:cut:${cut}:0`, at: cut, kind: 'cut', accountId: card.id });
        cut = nextCutAfter(cut, c.cutDay!);
      }
    }
    for (const s of statements) {
      if (s.accountId !== card.id || statementStatus(s, paidAfter(s), today) === 'paid') continue;
      for (const before of [7, 3, 1]) push({ key: `${s.id}:due:${before}`, at: addDays(s.dueDate, -before), kind: 'due', accountId: card.id });
    }
  }
  return out;
}
