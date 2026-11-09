import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LoanSimulationModel } from '../../../shared/models/loan.model';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { AccountService } from '../../../shared/services/account.service';
import { BorrowingService } from '../../../shared/services/borrowing.service';
import { LoanService } from '../../../shared/services/loan.service';
import { SmartInsightService } from '../../../shared/services/smart-insight.service';
import { AiCardComponent } from '../../../shared/components/ai-card/ai-card';
import { ExplainSheetComponent } from '../../../shared/components/explain-sheet/explain-sheet';
import { SettingsService } from '../../../shared/services/settings.service';
import { TranslateService } from '../../../shared/services/translate.service';
import { addMonthsKeepingDay } from '../../../shared/domain/dates';
import { LoanCosts, LoanError, LoanInput, PERIODS_PER_YEAR, PayFrequency, RateType, Offer, cancelEarly, compareGrid, compareOffers, quoteLoan, savingsOf } from '../../../shared/domain/loans';

interface Form {
  amount: number;
  rateValue: number;
  rateType: RateType;
  compounding: number;
  method: 'french' | 'german' | 'flat';
  termMonths: number;
  frequency: PayFrequency;
  firstDate: string;
  insuranceMode: 'fixed' | 'percent';
  insuranceValue: number;
  commissionMode: 'fixed' | 'percent';
  commissionValue: number;
  commissionFinanced: boolean;
  otherOnce: number;
  otherEvery: number;
}

interface OfferForm {
  name: string;
  rateValue: number;
  rateType: RateType;
  termMonths: number;
  commissionPct: number;
  insuranceFixed: number;
}

const TERMS = [12, 24, 36, 48, 60];
const ERRORS: Record<string, string> = {
  amount: 'The amount must be greater than zero.',
  rate: 'The rate must be between 0 and 1000.',
  term: 'The term must be a whole number of months.',
  date: 'Enter a valid first payment date.',
  costs: 'Check the insurance, commission and charges.',
  'method-rate': 'A flat rate goes with the flat method only.',
  'no-amortization': 'The installment does not cover the interest.',
};

import { ModuleOffComponent } from '../../../shared/components/module-off/module-off';

@Component({
  selector: 'app-loan-simulator',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe, ExplainSheetComponent, AiCardComponent, ModuleOffComponent],
  templateUrl: './loan-simulator.html',
  styleUrl: './loan-simulator.scss',
})
export class LoanSimulatorComponent {
  terms = TERMS;
  freqs: PayFrequency[] = ['monthly', 'biweekly', 'weekly'];
  message = signal('');

  f = signal<Form>({
    amount: 500000,
    rateValue: 18,
    rateType: 'nominal',
    compounding: 12,
    method: 'french',
    termMonths: 36,
    frequency: 'monthly',
    firstDate: '', // set in the constructor: parameter properties do not exist yet in a field initializer
    insuranceMode: 'percent',
    insuranceValue: 0,
    commissionMode: 'percent',
    commissionValue: 0,
    commissionFinanced: false,
    otherOnce: 0,
    otherEvery: 0,
  });

  upd(patch: Partial<Form>): void {
    const next = { ...this.f(), ...patch };
    // a flat rate goes with the flat method and the other way around
    if (patch.method === 'flat') next.rateType = 'flat';
    else if (patch.method && next.rateType === 'flat') next.rateType = 'nominal';
    if (patch.rateType === 'flat') next.method = 'flat';
    else if (patch.rateType && next.method === 'flat') next.method = 'french';
    this.f.set(next);
  }

  input = computed<LoanInput>(() => {
    const f = this.f();
    const costs: LoanCosts = {
      ...(f.insuranceValue > 0 ? { insurance: { mode: f.insuranceMode, value: Number(f.insuranceValue) } } : {}),
      ...(f.commissionValue > 0 ? { commission: { mode: f.commissionMode, value: Number(f.commissionValue), financed: f.commissionFinanced } } : {}),
      others: [
        ...(f.otherOnce > 0 ? [{ amount: Number(f.otherOnce), recurring: false }] : []),
        ...(f.otherEvery > 0 ? [{ amount: Number(f.otherEvery), recurring: true }] : []),
      ],
    };
    return {
      amount: Number(f.amount),
      rate: { value: Number(f.rateValue), type: f.rateType, compounding: f.rateType === 'nominal' ? Number(f.compounding) : undefined },
      method: f.method,
      termMonths: Number(f.termMonths),
      frequency: f.frequency,
      firstDate: f.firstDate,
      costs,
    };
  });

  quote = computed(() => quoteLoan(this.input()));
  error = computed(() => (this.quote().error ? this.translate.instant(ERRORS[this.quote().error as LoanError] ?? 'Check the data.') : ''));

  // ----- sustainability of this debt (stress test of the variable income, months of reserve)
  sustainability = computed(() => (this.quote().error ? null : this.smart.debtSustainability(this.input())));
  explainOpen = signal(false);
  insightText(i: Parameters<SmartInsightService['text']>[0]) {
    return this.smart.text(i);
  }

  // ----- capacity
  capacity = computed(() => (this.quote().error ? null : this.borrowing.evaluate(this.quote().totals.installment, this.f().frequency)));
  showSettings = signal(false);

  setSwitch(tier: 'salary' | 'bonuses' | 'commercial' | 'declared', on: boolean): void {
    this.loans.updateSettings({ switches: { [tier]: on } as never });
  }

  setSetting(patch: { commercialDiscount?: number; comfortable?: number; tight?: number; declaredVariable?: number }): void {
    if (!this.loans.updateSettings(patch)) this.message.set(this.translate.instant('Those values are not valid.'));
    else this.message.set('');
  }

  statusLabel(s: string): string {
    return ({ comfortable: 'Comfortable', tight: 'Tight', risky: 'Risky', 'no-income': 'No income' } as Record<string, string>)[s] ?? s;
  }

  readingLabel(k: string): string {
    return ({ conservative: 'Conservative', 'with-commercial': 'With business income', 'all-declared': 'Everything declared' } as Record<string, string>)[k] ?? k;
  }

  tierLabel(k: string): string {
    return ({ salary: 'Documented salary', bonuses: 'Recurring bonuses', commercial: 'Business income (6-month average)', declared: 'Other declared income' } as Record<string, string>)[k] ?? k;
  }

  // ----- terms and amounts grid
  termRows = computed(() => (this.quote().error ? [] : compareGrid(this.input(), [Number(this.f().amount)], TERMS)[0]));
  gridAmounts = signal<number[]>([300000, 400000, 500000]);
  newGridAmount: number | null = null;
  grid = computed(() => (this.quote().error ? [] : compareGrid(this.input(), this.gridAmounts(), TERMS)));

  addGridAmount(): void {
    const n = Number(this.newGridAmount);
    if (!(n > 0) || this.gridAmounts().includes(n)) return;
    this.gridAmounts.set([...this.gridAmounts(), n].sort((a, b) => a - b));
    this.newGridAmount = null;
  }

  removeGridAmount(n: number): void {
    this.gridAmounts.set(this.gridAmounts().filter((a) => a !== n));
  }

  // ----- offers (up to 4)
  offerForms = signal<OfferForm[]>([
    { name: '', rateValue: 18, rateType: 'nominal', termMonths: 36, commissionPct: 0, insuranceFixed: 0 },
    { name: '', rateValue: 16, rateType: 'nominal', termMonths: 36, commissionPct: 2, insuranceFixed: 0 },
  ]);

  setOffer(i: number, patch: Partial<OfferForm>): void {
    this.offerForms.set(this.offerForms().map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  }

  addOffer(): void {
    if (this.offerForms().length >= 4) return;
    this.offerForms.set([...this.offerForms(), { name: '', rateValue: 18, rateType: 'nominal', termMonths: 36, commissionPct: 0, insuranceFixed: 0 }]);
  }

  removeOffer(i: number): void {
    this.offerForms.set(this.offerForms().filter((_, idx) => idx !== i));
  }

  offers = computed(() => {
    const base = this.input();
    const list: Offer[] = this.offerForms().map((o, i) => ({
      name: o.name.trim() || `${this.translate.instant('Offer')} ${i + 1}`,
      input: {
        ...base,
        method: o.rateType === 'flat' ? 'flat' : base.method === 'flat' ? 'french' : base.method,
        rate: { value: Number(o.rateValue), type: o.rateType, compounding: o.rateType === 'nominal' ? 12 : undefined },
        termMonths: Number(o.termMonths),
        costs: {
          ...(o.commissionPct > 0 ? { commission: { mode: 'percent' as const, value: Number(o.commissionPct), financed: false } } : {}),
          ...(o.insuranceFixed > 0 ? { insurance: { mode: 'fixed' as const, value: Number(o.insuranceFixed) } } : {}),
        },
      },
    }));
    return compareOffers(list);
  });

  // ----- what-ifs
  extraAmount: number | null = null;
  extraPeriod = 12;
  extraEvery = 0; // 0 = once
  extraMode: 'reduce-term' | 'reduce-installment' = 'reduce-term';
  cancelPeriod = 12;
  cancelPenalty = 0;
  rateChangeAt = 13;
  rateChangeTo = 24;
  rateChangeMode: 'adjust-installment' | 'adjust-term' = 'adjust-installment';
  shorterTerm = 24;
  customDrop: number | null = null;
  drops = signal<number[]>([10, 20, 30]);
  whatIf = signal(0); // bumps to recompute the what-if panels after a field changes

  extraResult = computed(() => {
    this.whatIf();
    const amount = Number(this.extraAmount);
    if (this.quote().error || !(amount > 0)) return null;
    const periodic = Number(this.extraEvery) > 0;
    const adj = periodic ? { recurringExtra: { amount, every: Number(this.extraEvery), from: Number(this.extraPeriod) }, extraMode: this.extraMode } : { extras: [{ period: Number(this.extraPeriod), amount }], extraMode: this.extraMode };
    const q = quoteLoan(this.input(), adj);
    return q.error ? null : { quote: q, savings: savingsOf(this.quote(), q) };
  });

  cancelResult = computed(() => {
    this.whatIf();
    if (this.quote().error) return null;
    const r = cancelEarly(this.input(), Number(this.cancelPeriod), Number(this.cancelPenalty));
    return typeof r === 'string' ? null : r;
  });

  rateResult = computed(() => {
    this.whatIf();
    if (this.quote().error || this.f().method === 'flat') return null;
    const q = quoteLoan(this.input(), { rateChanges: [{ period: Number(this.rateChangeAt), rate: { value: Number(this.rateChangeTo), type: this.f().rateType === 'effective' ? 'effective' : 'nominal', compounding: 12 } }], rateChangeMode: this.rateChangeMode });
    return q.error ? null : { quote: q, savings: savingsOf(this.quote(), q) };
  });

  shorterResult = computed(() => {
    this.whatIf();
    if (this.quote().error) return null;
    return quoteLoan({ ...this.input(), termMonths: Number(this.shorterTerm) });
  });

  dropRows = computed(() => (this.quote().error ? [] : this.borrowing.dropImpact(this.quote().totals.installment, this.f().frequency, this.drops())));

  addDrop(): void {
    const n = Number(this.customDrop);
    if (!(n > 0 && n <= 100) || this.drops().includes(n)) return;
    this.drops.set([...this.drops(), n].sort((a, b) => a - b));
    this.customDrop = null;
  }

  // ----- save / reopen / register
  simName = '';
  saved = computed(() => this.loans.simulations());

  save(): void {
    const r = this.loans.saveSimulation(this.simName, this.input());
    if (r.ok) {
      this.simName = '';
      this.message.set('');
    } else this.message.set(this.translate.instant(r.error === 'name' ? 'Give it a name.' : 'Check the data.'));
  }

  open(s: LoanSimulationModel): void {
    const costs = s.costs;
    this.f.set({
      ...this.f(),
      amount: s.amount,
      rateValue: s.rate.value,
      rateType: s.rate.type,
      compounding: s.rate.compounding ?? 12,
      method: s.method,
      termMonths: s.termMonths,
      frequency: s.frequency,
      insuranceMode: costs?.insurance?.mode ?? 'percent',
      insuranceValue: costs?.insurance?.value ?? 0,
      commissionMode: costs?.commission?.mode ?? 'percent',
      commissionValue: costs?.commission?.value ?? 0,
      commissionFinanced: costs?.commission?.financed ?? false,
      otherOnce: (costs?.others ?? []).filter((o) => !o.recurring).reduce((a, o) => a + o.amount, 0),
      otherEvery: (costs?.others ?? []).filter((o) => o.recurring).reduce((a, o) => a + o.amount, 0),
    });
    this.simName = s.name;
  }

  registerOpen = signal(false);
  rName = '';
  rLender = '';
  rDisbursementAccount = '';
  rPayAccount = '';
  rDate = '';
  accountOptions = computed(() => this.accounts.activeAccounts().filter((a) => a.type !== 'card' && (a.currency ?? 'DOP') === 'DOP'));

  openRegister(): void {
    this.rName = this.simName;
    this.rDisbursementAccount = this.accountOptions()[0]?.id ?? '';
    this.rPayAccount = this.rDisbursementAccount;
    this.registerOpen.set(true);
  }

  register(): void {
    const r = this.loans.register({ input: this.input(), name: this.rName, lender: this.rLender, disbursementAccountId: this.rDisbursementAccount, payAccountId: this.rPayAccount, disbursementDate: this.rDate });
    if (r.ok) void this.router.navigate(['/loans']);
    else this.message.set(this.translate.instant(r.error === 'name' ? 'Give it a name.' : r.error === 'account' ? 'Choose an existing RD$ account.' : 'The loan could not be registered.'));
  }

  constructor(
    private translate: TranslateService,
    private router: Router,
    public loans: LoanService,
    public borrowing: BorrowingService,
    public accounts: AccountService,
    public settings: SettingsService,
    private smart: SmartInsightService
  ) {
    this.f.update((f) => ({ ...f, firstDate: addMonthsKeepingDay(this.loans.today(), 1) }));
    this.rDate = this.loans.today();
  }

  periodsPerYear(): number {
    return PERIODS_PER_YEAR[this.f().frequency];
  }

  money(n: number | null | undefined): string {
    return `${this.settings.currency()}${(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  refresh(): void {
    this.whatIf.update((n) => n + 1);
  }
}
