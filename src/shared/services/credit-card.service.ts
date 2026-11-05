import { Injectable, computed, signal } from '@angular/core';
import { AccountModel, CardConfig } from '../models/account.model';
import { CardStatementModel, StatementStatus } from '../models/card-statement.model';
import { TransactionCurrency } from '../models/transaction.model';
import {
  CARD_INTEREST_CATEGORY,
  CardAlert,
  CardDebt,
  Period,
  Utilization,
  AlertInput,
  breakdown,
  buildStatement,
  cardAlerts,
  cardCurrencies,
  cardDebt,
  consolidatedUtilization,
  consumptionOf,
  cutForDate,
  cutsToClose,
  interestGap,
  isCreditCard,
  isEmptyStatement,
  limitOf,
  missingCardData,
  paymentsAfter,
  periodOfCut,
  plannedNotices,
  remainingOf,
  statementStatus,
  utilizationOf,
  Breakdown,
  Consumption,
  CardMissing,
  PlannedNotice,
} from '../domain/cards';
import { localIso } from '../domain/dates';
import { TxResult } from '../domain/validation';
import { addMoney, round2 } from '../utils/money';
import { AccountService } from './account.service';
import { AuditLogService } from './audit-log.service';
import { StorageService } from './storage.service';
import { TransactionService } from './transaction.service';

export interface CardPeriodView {
  period: Period;
  statement?: CardStatementModel; // absent for the open ("not yet billed") period
  breakdown: Breakdown;
  consumption: Consumption;
}

// Credit cards on top of the ledger: debt, available credit, utilization, statements, payments
// and alerts. Debt is never stored (it is the card's balance); the statements are stored only
// so the history is stable and the user's bank figures are kept. Paying a statement is a
// transfer from another account to the card: it lowers the debt and the paying account and is
// never an expense (integrity rules 2 and 3).
@Injectable({ providedIn: 'root' })
export class CreditCardService {
  private _statements = signal<CardStatementModel[]>([]);
  statements = this._statements.asReadonly();

  // Bumped when statements are (re)generated or the day changes, so alerts follow the clock
  private tick = signal(0);

  cards = computed(() => this.accounts.activeAccounts().filter(isCreditCard));

  // Cards that still lack limit, cut or due data ("Complete your card data")
  incompleteCards = computed(() => this.cards().filter((c) => missingCardData(c).length > 0));

  constructor(
    private storage: StorageService,
    private accounts: AccountService,
    private transactions: TransactionService,
    private audit: AuditLogService
  ) {
    this._statements.set(this.storage.get<CardStatementModel[]>('statements', []));
    this.storage.watch('statements', (v) => this._statements.set((v as CardStatementModel[] | undefined) ?? []));
  }

  today(): string {
    return localIso(this.transactions.clock());
  }

  missing(card: AccountModel): CardMissing[] {
    return missingCardData(card);
  }

  // ----- debt and utilization

  debts(card: AccountModel): CardDebt[] {
    return cardCurrencies(card).map((c) => cardDebt(this.accounts.accounts(), this.transactions.transactions(), card, c));
  }

  debtOf(card: AccountModel, currency: TransactionCurrency): CardDebt {
    return cardDebt(this.accounts.accounts(), this.transactions.transactions(), card, currency);
  }

  // Utilization of one card in one currency, with that card's own thresholds
  utilization(card: AccountModel, currency: TransactionCurrency = 'DOP'): Utilization {
    return utilizationOf(this.debtOf(card, currency).owed, limitOf(card.card, currency), card.card?.warnAt, card.card?.dangerAt);
  }

  // All cards together, per currency (RD$ and US$ are never added up)
  consolidated(currency: TransactionCurrency = 'DOP') {
    const debts = this.cards()
      .filter((c) => cardCurrencies(c).includes(currency))
      .map((c) => this.debtOf(c, currency));
    return consolidatedUtilization(debts);
  }

  // What is owed on all credit cards, per currency (the "pending debts" figure)
  totalOwed(): Record<TransactionCurrency, number> {
    const total: Record<TransactionCurrency, number> = { DOP: 0, USD: 0 };
    for (const card of this.cards()) {
      for (const cur of cardCurrencies(card)) total[cur] = addMoney(total[cur], this.debtOf(card, cur).owed);
    }
    return total;
  }

  // ----- statements

  statementsOf(cardId: string): CardStatementModel[] {
    return this._statements()
      .filter((s) => s.accountId === cardId)
      .sort((a, b) => b.cutDate.localeCompare(a.cutDate) || a.currency.localeCompare(b.currency));
  }

  byId(id: string): CardStatementModel | undefined {
    return this._statements().find((s) => s.id === id);
  }

  paidAfterCut(s: CardStatementModel): number {
    return paymentsAfter(this.accounts.accounts(), this.transactions.transactions(), s.accountId, s.currency, s.cutDate);
  }

  statusOf(s: CardStatementModel): StatementStatus {
    return statementStatus(s, this.paidAfterCut(s), this.today());
  }

  remainingOf(s: CardStatementModel): number {
    return remainingOf(s, this.paidAfterCut(s));
  }

  // The oldest statement that still has something to pay (payments go to it first)
  oldestOpen(cardId: string, currency: TransactionCurrency): CardStatementModel | undefined {
    return this.statementsOf(cardId)
      .filter((s) => s.currency === currency && this.remainingOf(s) > 0)
      .pop();
  }

  // Interest already registered for this statement (and still standing)
  interestRegistered(s: CardStatementModel): boolean {
    const tx = s.interestTxId ? this.transactions.byId(s.interestTxId) : undefined;
    return !!tx && tx.status !== 'reversed';
  }

  gapOf(s: CardStatementModel): number {
    return interestGap(s);
  }

  // Closes the periods whose cut has arrived (also the ones that passed while the app was
  // closed). Idempotent and deterministic: the id depends only on card, currency and cut, so
  // two devices produce the same record. On the cut day itself the figures follow late entries.
  ensureStatements(): void {
    if (this.storage.readOnly()) return;
    const accounts = this.accounts.accounts();
    const txs = this.transactions.transactions();
    const today = this.today();
    const now = this.transactions.clock().toISOString();
    let list = this._statements();
    let changed = false;
    for (const card of this.cards()) {
      if (!card.card || missingCardData(card).some((m) => m !== 'limit')) continue;
      for (const currency of cardCurrencies(card)) {
        const mine = list.filter((s) => s.accountId === card.id && s.currency === currency);
        for (const cut of cutsToClose(card.card, mine, today)) {
          const built = buildStatement(accounts, txs, card, currency, cut, now);
          const existing = list.find((s) => s.id === built.id);
          if (!existing) {
            if (isEmptyStatement(built)) continue;
            list = [...list, built];
            changed = true;
          }
        }
        // cut day: refresh the calculated figures of a statement nobody has touched yet
        for (const s of mine) {
          if (s.cutDate !== today || s.bankBalance !== undefined || s.interestTxId) continue;
          const fresh = buildStatement(accounts, txs, card, currency, s.cutDate, s.generatedAt);
          if (fresh.calculatedBalance !== s.calculatedBalance || fresh.purchases !== s.purchases) {
            list = list.map((x) => (x.id === s.id ? fresh : x));
            changed = true;
          }
        }
      }
    }
    if (changed) this.save(list);
    this.tick.update((n) => n + 1);
  }

  // Recalculates a closed statement from the movements (for late entries). The figures the
  // bank gave are kept; the audit keeps the previous calculation.
  recalculate(statementId: string): void {
    const s = this.byId(statementId);
    const card = s && this.accounts.byId(s.accountId);
    if (!s || !card?.card || missingCardData(card).some((m) => m !== 'limit') || this.storage.readOnly()) return;
    const fresh = buildStatement(this.accounts.accounts(), this.transactions.transactions(), card, s.currency, s.cutDate, this.transactions.clock().toISOString());
    const next: CardStatementModel = { ...fresh, bankBalance: s.bankBalance, bankMinimum: s.bankMinimum, interestTxId: s.interestTxId };
    this.save(this._statements().map((x) => (x.id === s.id ? next : x)));
    this.audit.log({ type: 'statement-bank-figures', entity: 'statement', entityId: s.id, accountId: s.accountId, before: { calculatedBalance: s.calculatedBalance }, after: { calculatedBalance: next.calculatedBalance }, origin: 'recalculate' });
  }

  // The bank is the source of truth: its balance and minimum replace the calculated ones.
  // Nothing is adjusted: the difference is shown and the user decides (see registerInterest).
  setBankFigures(statementId: string, figures: { balance?: number | null; minimum?: number | null }): boolean {
    const s = this.byId(statementId);
    if (!s || this.storage.readOnly()) return false;
    const ok = (n: number | null | undefined) => n === undefined || n === null || (Number.isFinite(n) && n >= 0);
    if (!ok(figures.balance) || !ok(figures.minimum)) return false;
    const next: CardStatementModel = {
      ...s,
      bankBalance: figures.balance === undefined ? s.bankBalance : figures.balance === null ? undefined : round2(figures.balance),
      bankMinimum: figures.minimum === undefined ? s.bankMinimum : figures.minimum === null ? undefined : round2(figures.minimum),
    };
    this.save(this._statements().map((x) => (x.id === s.id ? next : x)));
    this.audit.log({
      type: 'statement-bank-figures',
      entity: 'statement',
      entityId: s.id,
      accountId: s.accountId,
      before: { bankBalance: s.bankBalance, bankMinimum: s.bankMinimum },
      after: { bankBalance: next.bankBalance, bankMinimum: next.bankMinimum },
    });
    return true;
  }

  // "Your bank charged X more than you recorded": registers ONCE the difference as the cost of
  // credit (an expense on the card on the cut date, linked to the statement)
  registerInterest(statementId: string): TxResult {
    const s = this.byId(statementId);
    if (!s) return { ok: false, error: 'not-found' };
    const gap = interestGap(s);
    if (gap <= 0) return { ok: false, error: 'amount' };
    const previous = s.interestTxId ? this.transactions.byId(s.interestTxId) : undefined;
    if (previous && previous.status !== 'reversed') return { ok: false, error: 'changed' }; // already registered
    const result = this.transactions.add({
      type: 'expense',
      amount: gap,
      accountId: s.accountId,
      categoryId: CARD_INTEREST_CATEGORY,
      currency: s.currency,
      date: s.cutDate,
      note: 'Card interest and charges',
      origin: 'manual',
    });
    if (!result.ok) return result;
    this.save(this._statements().map((x) => (x.id === s.id ? { ...x, interestTxId: result.id } : x)));
    this.audit.log({ type: 'statement-interest', entity: 'statement', entityId: s.id, accountId: s.accountId, after: { amount: gap, txId: result.id } });
    return result;
  }

  // ----- views of a card

  // The period that has not been billed yet
  unbilled(card: AccountModel, currency: TransactionCurrency): CardPeriodView | null {
    if (!card.card || missingCardData(card).some((m) => m !== 'limit')) return null;
    const today = this.today();
    const cut = cutForDate(today, card.card);
    const period = periodOfCut(cut, card.card);
    return this.viewOf(card, currency, period);
  }

  viewOfStatement(s: CardStatementModel): CardPeriodView {
    const card = this.accounts.byId(s.accountId)!;
    return this.viewOf(card, s.currency, { start: s.periodStart, end: s.periodEnd, cut: s.cutDate }, s);
  }

  private viewOf(card: AccountModel, currency: TransactionCurrency, period: Period, statement?: CardStatementModel): CardPeriodView {
    const accounts = this.accounts.accounts();
    const txs = this.transactions.transactions();
    return {
      period,
      statement,
      breakdown: breakdown(accounts, txs, card.id, currency, period.start, period.end),
      consumption: consumptionOf(accounts, txs, card.id, currency, period.start, period.end),
    };
  }

  // Movements of a card inside a period, newest first
  movementsIn(cardId: string, currency: TransactionCurrency, start: string, end: string) {
    return this.transactions
      .sorted()
      .filter(
        (t) =>
          this.transactions.currencyOf(t) === currency &&
          t.date >= start &&
          t.date <= end &&
          (this.accounts.effectiveOwnerId(t.accountId) === cardId || (!!t.toAccountId && this.accounts.effectiveOwnerId(t.toAccountId) === cardId))
      );
  }

  // ----- payments

  // Paying a card: a transfer from the paying account to the card (origin 'card-payment').
  // Partial payments are fine; paying more than owed leaves a balance in the user's favor.
  // fee: the bank's tax or commission on the payment; it leaves the paying account on top of the amount and is not paid to the card.
  pay(input: { cardId: string; fromAccountId: string; amount: number; date: string; currency: TransactionCurrency; note?: string; fee?: number }): TxResult {
    const card = this.accounts.byId(input.cardId);
    if (!card || !isCreditCard(card)) return { ok: false, error: 'to-account' };
    return this.transactions.add({
      type: 'transfer',
      amount: input.amount,
      accountId: input.fromAccountId,
      toAccountId: input.cardId,
      currency: input.currency,
      date: input.date,
      note: input.note,
      fee: input.fee && input.fee > 0 ? input.fee : undefined,
      origin: 'card-payment',
    });
  }

  // ----- card data

  setConfig(cardId: string, config: CardConfig): void {
    const card = this.accounts.byId(cardId);
    if (!card || !isCreditCard(card)) return;
    const clean: CardConfig = {};
    for (const [k, v] of Object.entries(config)) {
      if (v !== undefined && v !== null && !(typeof v === 'number' && !Number.isFinite(v))) (clean as Record<string, unknown>)[k] = v;
    }
    this.accounts.update({ ...card, card: clean });
    this.audit.log({ type: 'card-config', entity: 'account', entityId: cardId, accountId: cardId, before: card.card ?? {}, after: clean });
    this.ensureStatements();
  }

  // ----- alerts

  private alertInputs = computed<AlertInput[]>(() =>
    this.cards().map((card) => ({
      card,
      statements: this._statements().filter((s) => s.accountId === card.id),
      paidAfter: (s: CardStatementModel) => paymentsAfter(this.accounts.accounts(), this.transactions.transactions(), s.accountId, s.currency, s.cutDate),
    }))
  );

  alerts = computed<CardAlert[]>(() => {
    this.tick();
    return cardAlerts(this.alertInputs(), this.today());
  });

  // What the device should notify in the coming weeks (see CardNoticeService)
  notices = computed<PlannedNotice[]>(() => {
    this.tick();
    return plannedNotices(this.alertInputs(), this.today());
  });

  private save(list: CardStatementModel[]): void {
    this._statements.set(list);
    this.storage.set('statements', list);
  }
}
