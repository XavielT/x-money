import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AccountModel, CardConfig } from '../../../shared/models/account.model';
import { CardStatementModel, StatementStatus } from '../../../shared/models/card-statement.model';
import { TransactionCurrency, TransactionModel } from '../../../shared/models/transaction.model';
import { TransactionItem } from '../../../shared/components/transaction-item/transaction-item';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { BankBadge } from '../../../shared/ui/bank-badge/bank-badge';
import { TX_ERROR_TEXT } from '../../../shared/ui/tx-error-text';
import { AccountService } from '../../../shared/services/account.service';
import { CreditCardService } from '../../../shared/services/credit-card.service';
import { InsightsService } from '../../../shared/services/insights.service';
import { SettingsService } from '../../../shared/services/settings.service';
import { TranslateService } from '../../../shared/services/translate.service';
import { DEFAULT_DANGER_AT, DEFAULT_MIN_PERCENT, DEFAULT_WARN_AT, cardCurrencies, effectiveBalance, effectiveMinimum, isCreditCard, limitOf } from '../../../shared/domain/cards';
import { bankById } from '../../../shared/data/banks';

const num = (v: number | null | undefined): number | undefined => (v === null || v === undefined || !Number.isFinite(Number(v)) ? undefined : Number(v));

// One credit card: limit, debt, available credit, utilization, the card data form, the period
// that is not billed yet, the statements and their payments. Debt and consumption come from the
// movements; what the bank says (balance, minimum) can be typed in and wins over the estimate.
@Component({
  selector: 'app-card',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, BankBadge, TransactionItem],
  templateUrl: './card.html',
  styleUrl: './card.scss',
})
export class CardComponent {
  card: AccountModel | undefined;
  currency = signal<TransactionCurrency>('DOP');
  message = signal('');
  editing = signal(false);
  openStatement = signal<string | null>(null);
  showUnbilled = signal(false);

  // card data form
  fLimit: number | null = null;
  fLimitUsd: number | null = null;
  fCutDay: number | null = null;
  fDueMode: 'days-after' | 'fixed-day' = 'days-after';
  fDueDays: number | null = null;
  fDueDay: number | null = null;
  fMinPercent: number | null = null;
  fMinFloor: number | null = null;
  fMinFloorUsd: number | null = null;
  fCutRule: 'closing' | 'next' = 'closing';
  fWarn: number | null = null;
  fDanger: number | null = null;
  fSmallMax: number | null = null;

  // what the user types from the real statement, per statement id
  bankInputs: Record<string, { balance: number | null; minimum: number | null }> = {};

  readonly defaults = { warn: DEFAULT_WARN_AT, danger: DEFAULT_DANGER_AT, minPercent: DEFAULT_MIN_PERCENT };

  debt = computed(() => (this.card ? this.cards.debtOf(this.accountService.byId(this.card.id)!, this.currency()) : null));
  utilization = computed(() => (this.card ? this.cards.utilization(this.accountService.byId(this.card.id)!, this.currency()) : null));
  missing = computed(() => (this.card ? this.cards.missing(this.accountService.byId(this.card.id)!) : []));
  unbilled = computed(() => (this.card ? this.cards.unbilled(this.accountService.byId(this.card.id)!, this.currency()) : null));
  statements = computed(() => (this.card ? this.cards.statementsOf(this.card.id).filter((s) => s.currency === this.currency()) : []));

  // Small purchases of the open period, with the card's own ceiling
  small = computed(() => {
    const view = this.unbilled();
    if (!this.card || !view) return null;
    return this.insights.antExpensesFor({
      accountId: this.card.id,
      from: view.period.start,
      to: view.period.end,
      currency: this.currency(),
      ceiling: this.accountService.byId(this.card.id)?.card?.smallPurchaseMax,
    });
  });

  unbilledMovements = computed(() => {
    const view = this.unbilled();
    return this.card && view ? this.cards.movementsIn(this.card.id, this.currency(), view.period.start, view.period.end) : [];
  });

  // Payments made to this card (not reversed), newest first
  payments = computed(() =>
    this.card
      ? this.cards.movementsIn(this.card.id, this.currency(), '0000-01-01', '9999-12-31').filter((t) => t.type === 'transfer' && t.toAccountId === this.card!.id && t.status !== 'reversed')
      : []
  );

  constructor(
    route: ActivatedRoute,
    private router: Router,
    private translate: TranslateService,
    public cards: CreditCardService,
    public accountService: AccountService,
    public settings: SettingsService,
    private insights: InsightsService
  ) {
    const found = this.accountService.byId(route.snapshot.paramMap.get('id') ?? '');
    this.card = found && isCreditCard(found) ? found : undefined;
    if (!this.card) return;
    if (this.card.currency === 'USD') this.currency.set('USD');
    this.cards.ensureStatements();
    this.loadForm();
    this.editing.set(this.cards.missing(this.card).length > 0);
  }

  get current(): AccountModel {
    return this.accountService.byId(this.card!.id) ?? this.card!;
  }

  bankName(): string {
    return (this.card?.bankId && bankById(this.card.bankId)?.name) || '';
  }

  currencies(): TransactionCurrency[] {
    return this.card ? cardCurrencies(this.current) : [];
  }

  symbol(): string {
    return this.currency() === 'USD' ? 'US$' : this.settings.currency();
  }

  hasUsd(): boolean {
    return this.currencies().includes('USD');
  }

  hasDop(): boolean {
    return this.currencies().includes('DOP');
  }

  limit(): number | undefined {
    return limitOf(this.current.card, this.currency());
  }

  abs(v: number): number {
    return Math.abs(v);
  }

  // ----- card data form

  private loadForm(): void {
    const c: CardConfig = this.current.card ?? {};
    this.fLimit = c.creditLimit ?? null;
    this.fLimitUsd = c.creditLimitUsd ?? null;
    this.fCutDay = c.cutDay ?? null;
    this.fDueMode = c.dueMode ?? 'days-after';
    this.fDueDays = c.dueDays ?? null;
    this.fDueDay = c.dueDay ?? null;
    this.fMinPercent = c.minPercent ?? null;
    this.fMinFloor = c.minFloor ?? null;
    this.fMinFloorUsd = c.minFloorUsd ?? null;
    this.fCutRule = c.cutDayPurchases ?? 'closing';
    this.fWarn = c.warnAt ?? null;
    this.fDanger = c.dangerAt ?? null;
    this.fSmallMax = c.smallPurchaseMax ?? null;
  }

  formError(): string {
    const day = (v: number | null) => v !== null && Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 31;
    if (this.hasDop() && !(Number(this.fLimit) > 0)) return 'Enter the credit limit.';
    if (this.hasUsd() && !(Number(this.fLimitUsd) > 0)) return 'Enter the credit limit in US$.';
    if (!day(this.fCutDay)) return 'The cut day must be between 1 and 31.';
    if (this.fDueMode === 'fixed-day' ? !day(this.fDueDay) : !(this.fDueDays !== null && Number.isInteger(Number(this.fDueDays)) && Number(this.fDueDays) >= 0 && Number(this.fDueDays) <= 60)) {
      return 'Enter the payment deadline.';
    }
    const warn = num(this.fWarn);
    const danger = num(this.fDanger);
    if ((warn !== undefined && (warn <= 0 || warn > 100)) || (danger !== undefined && (danger <= 0 || danger > 100))) return 'Utilization levels must be between 1 and 100.';
    if (warn !== undefined && danger !== undefined && warn >= danger) return 'The first utilization level must be lower than the second.';
    const pct = num(this.fMinPercent);
    if (pct !== undefined && (pct <= 0 || pct > 100)) return 'The minimum payment percentage must be between 1 and 100.';
    return '';
  }

  saveConfig(): void {
    if (!this.card || this.formError()) return;
    this.cards.setConfig(this.card.id, {
      creditLimit: this.hasDop() ? num(this.fLimit) : undefined,
      creditLimitUsd: this.hasUsd() ? num(this.fLimitUsd) : undefined,
      cutDay: num(this.fCutDay),
      dueMode: this.fDueMode,
      dueDays: this.fDueMode === 'days-after' ? num(this.fDueDays) : undefined,
      dueDay: this.fDueMode === 'fixed-day' ? num(this.fDueDay) : undefined,
      minPercent: num(this.fMinPercent),
      minFloor: num(this.fMinFloor),
      minFloorUsd: num(this.fMinFloorUsd),
      cutDayPurchases: this.fCutRule,
      warnAt: num(this.fWarn),
      dangerAt: num(this.fDanger),
      smallPurchaseMax: num(this.fSmallMax),
    });
    this.editing.set(false);
    this.message.set(this.translate.instant('Card data saved.'));
  }

  // ----- statements

  status(s: CardStatementModel): StatementStatus {
    return this.cards.statusOf(s);
  }

  // English phrases: they are the translation keys
  statusLabel(s: CardStatementModel): string {
    return { closed: 'Closed', partial: 'Partially paid', paid: 'Paid', overdue: 'Overdue' }[this.status(s)] ?? '';
  }

  balanceOf(s: CardStatementModel): number {
    return effectiveBalance(s);
  }

  minimumOf(s: CardStatementModel): number {
    return effectiveMinimum(s);
  }

  toggleStatement(s: CardStatementModel): void {
    const open = this.openStatement() === s.id;
    this.openStatement.set(open ? null : s.id);
    if (!open && !this.bankInputs[s.id]) this.bankInputs[s.id] = { balance: s.bankBalance ?? null, minimum: s.bankMinimum ?? null };
  }

  inputFor(s: CardStatementModel) {
    return (this.bankInputs[s.id] ??= { balance: s.bankBalance ?? null, minimum: s.bankMinimum ?? null });
  }

  saveBankFigures(s: CardStatementModel): void {
    const input = this.inputFor(s);
    const ok = this.cards.setBankFigures(s.id, { balance: num(input.balance) ?? null, minimum: num(input.minimum) ?? null });
    this.message.set(this.translate.instant(ok ? 'Bank figures saved.' : 'Check the amounts.'));
  }

  registerInterest(s: CardStatementModel): void {
    const result = this.cards.registerInterest(s.id);
    this.message.set(this.translate.instant(result.ok ? 'Interest and charges registered as an expense.' : TX_ERROR_TEXT[result.error]));
  }

  recalculate(s: CardStatementModel): void {
    this.cards.recalculate(s.id);
    this.message.set(this.translate.instant('Statement recalculated from your movements.'));
  }

  viewOf(s: CardStatementModel) {
    return this.cards.viewOfStatement(s);
  }

  movementsOf(s: CardStatementModel): TransactionModel[] {
    return this.cards.movementsIn(s.accountId, s.currency, s.periodStart, s.periodEnd);
  }

  pay(statement?: CardStatementModel): void {
    if (!this.card) return;
    this.router.navigate(['/card', this.card.id, 'pay'], { queryParams: { currency: this.currency(), ...(statement ? { statement: statement.id } : {}) } });
  }

  back(): void {
    history.back();
  }
}
