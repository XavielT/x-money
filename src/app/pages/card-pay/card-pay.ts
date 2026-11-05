import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AccountModel } from '../../../shared/models/account.model';
import { TransactionCurrency } from '../../../shared/models/transaction.model';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { TX_ERROR_TEXT } from '../../../shared/ui/tx-error-text';
import { AccountService } from '../../../shared/services/account.service';
import { CreditCardService } from '../../../shared/services/credit-card.service';
import { SettingsService } from '../../../shared/services/settings.service';
import { TranslateService } from '../../../shared/services/translate.service';
import { cardCurrencies, effectiveMinimum, isCreditCard } from '../../../shared/domain/cards';
import { localIso } from '../../../shared/domain/dates';
import { round2 } from '../../../shared/utils/money';

type Choice = 'balance' | 'minimum' | 'other';

// Pay a credit card. The payment is a TRANSFER from the paying account to the card: it lowers
// the debt and the paying account and is never an expense (rule 3). It is applied to the oldest
// open statement first; paying part of it is fine and paying more leaves a balance in your favor.
@Component({
  selector: 'app-card-pay',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './card-pay.html',
  styleUrl: './card-pay.scss',
})
export class CardPayComponent {
  card: AccountModel | undefined;
  currency = signal<TransactionCurrency>('DOP');
  fromId = signal('');
  choice = signal<Choice>('balance');
  other = signal<number | null>(null);
  date = signal(localIso(new Date()));
  note = signal('');
  fee = signal<number | null>(null);
  error = signal('');
  saved = signal(false);
  private statementId = '';

  // The statement the payment is for: the one asked for, else the oldest open one
  statement = computed(() => {
    if (!this.card) return undefined;
    const asked = this.statementId ? this.cards.byId(this.statementId) : undefined;
    if (asked && asked.currency === this.currency() && this.cards.remainingOf(asked) > 0) return asked;
    return this.cards.oldestOpen(this.card.id, this.currency());
  });

  owed = computed(() => (this.card ? this.cards.debtOf(this.accountService.byId(this.card.id)!, this.currency()).owed : 0));

  // Amounts behind the shortcuts (undefined = not available for this card right now)
  balanceAmount = computed(() => {
    const s = this.statement();
    return s ? this.cards.remainingOf(s) : this.owed() > 0 ? this.owed() : undefined;
  });

  minimumAmount = computed(() => {
    const s = this.statement();
    return s ? Math.min(effectiveMinimum(s), this.cards.remainingOf(s)) : undefined;
  });

  amount = computed(() => {
    const c = this.choice();
    const v = c === 'balance' ? this.balanceAmount() : c === 'minimum' ? this.minimumAmount() : this.other();
    return v === undefined || v === null || !Number.isFinite(Number(v)) ? 0 : round2(Number(v));
  });

  // Accounts that can pay: any active account that is not a credit card
  payers = computed(() =>
    this.accountService
      .activeAccounts()
      .filter((a) => !isCreditCard(a) && (a.currency === 'dual' || (a.currency ?? 'DOP') === this.currency()))
  );

  constructor(
    route: ActivatedRoute,
    private router: Router,
    private translate: TranslateService,
    public cards: CreditCardService,
    public accountService: AccountService,
    public settings: SettingsService
  ) {
    const found = this.accountService.byId(route.snapshot.paramMap.get('id') ?? '');
    this.card = found && isCreditCard(found) ? found : undefined;
    if (!this.card) return;
    const query = route.snapshot.queryParamMap;
    const currencies = cardCurrencies(this.card);
    this.currency.set(query.get('currency') === 'USD' && currencies.includes('USD') ? 'USD' : currencies[0]);
    this.statementId = query.get('statement') ?? '';
    this.cards.ensureStatements();
    this.fromId.set(this.payers()[0]?.id ?? '');
    if (this.balanceAmount() === undefined) this.choice.set('other');
  }

  currencies(): TransactionCurrency[] {
    return this.card ? cardCurrencies(this.card) : [];
  }

  symbol(): string {
    return this.currency() === 'USD' ? 'US$' : this.settings.currency();
  }

  setCurrency(c: TransactionCurrency): void {
    this.currency.set(c);
    this.statementId = '';
    this.fromId.set(this.payers()[0]?.id ?? '');
    this.choice.set(this.balanceAmount() === undefined ? 'other' : 'balance');
  }

  canPay(): boolean {
    return !!this.card && !!this.fromId() && this.amount() > 0 && !this.saved();
  }

  // After this payment: what the card would owe, or what is left in the user's favor
  afterOwed(): number {
    return Math.max(0, round2(this.owed() - this.amount()));
  }

  inFavorAfter(): number {
    return Math.max(0, round2(this.amount() - this.owed()));
  }

  private submit(amount: number): void {
    if (!this.card) return;
    this.error.set('');
    const result = this.cards.pay({
      cardId: this.card.id,
      fromAccountId: this.fromId(),
      amount,
      date: this.date(),
      currency: this.currency(),
      note: this.note().trim() || undefined,
      fee: this.fee() && Number(this.fee()) > 0 ? round2(Number(this.fee())) : undefined,
    });
    if (!result.ok) {
      this.error.set(this.translate.instant(TX_ERROR_TEXT[result.error]));
      return;
    }
    this.saved.set(true);
    this.router.navigate(['/card', this.card.id], { replaceUrl: true });
  }

  pay(): void {
    if (this.canPay()) this.submit(this.amount());
  }

  // "I already paid the whole statement": one action with the statement balance
  payFull(): void {
    const full = this.balanceAmount();
    if (!this.fromId() || full === undefined || full <= 0 || this.saved()) return;
    this.choice.set('balance');
    this.submit(full);
  }

  back(): void {
    history.back();
  }

  dueDate(): string {
    return this.statement()?.dueDate ?? '';
  }
}
