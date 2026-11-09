import { Component, ElementRef, computed, signal } from '@angular/core';
import { CommonModule, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { BenefitKind, BenefitModel } from '../../../shared/models/benefit.model';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { BenefitError, BenefitService } from '../../../shared/services/benefit.service';
import { IncomeSourceService } from '../../../shared/services/income-source.service';
import { SettingsService } from '../../../shared/services/settings.service';
import { TranslateService } from '../../../shared/services/translate.service';
import { BENEFIT_ESTIMATE_LABEL } from '../../../shared/domain/benefits';
import { revealAndFocus } from '../../../shared/ui/reveal';

const KIND_LABELS: Record<BenefitKind, string> = {
  'fuel-card': 'Fuel card',
  'health-insurance': 'Health insurance',
  subscriptions: 'Subscriptions paid by the company',
  meals: 'Meals',
  transport: 'Transport',
  'in-kind-bonus': 'Bonus in kind',
  other: 'Other',
};

const ERROR_TEXT: Record<BenefitError, string> = {
  invalid: 'Check the name, the amounts and the dates.',
  'not-found': 'Benefit not found.',
  'read-only': 'Update X Money to save changes.',
  amount: 'Enter an amount greater than zero.',
  date: 'Enter a valid date.',
};

// Non-monetary work benefits. Everything here is an ESTIMATE of what the benefit saves you:
// it is not cash, never touches an account and never adds to income, net worth or payment
// capacity (integrity rule 4). A use is a note, not a movement.
@Component({
  selector: 'app-benefits',
  standalone: true,
  imports: [CommonModule, FormsModule, NgTemplateOutlet, TranslatePipe],
  templateUrl: './benefits.html',
  styleUrl: './benefits.scss',
})
export class BenefitsComponent {
  readonly kinds = Object.keys(KIND_LABELS) as BenefitKind[];
  readonly estimateLabel = BENEFIT_ESTIMATE_LABEL;
  private now = new Date();
  year = this.now.getFullYear();
  month = this.now.getMonth() + 1;

  // where the form is open: under "Add benefit" ('new'), under a benefit (its id) or nowhere
  formFor = signal<string | null>(null);
  message = signal('');
  error = signal('');
  openUse = signal<string | null>(null);

  monthSaving = computed(() => this.benefits.monthlySaving(this.year, this.month));
  yearSaving = computed(() => this.benefits.yearSaving(this.year, this.month));

  // form
  get editingId(): string | null {
    const f = this.formFor();
    return f && f !== 'new' ? f : null;
  }
  fName = '';
  fKind: BenefitKind = 'fuel-card';
  fProvider = '';
  fSource = '';
  fValue: number | null = null;
  fLimit: number | null = null;
  fFrom = '';
  fTo = '';
  fActive = true;
  fNotes = '';
  fMonetary = false;

  // quick use
  uAmount: number | null = null;
  uDate = '';
  uNote = '';

  constructor(
    public benefits: BenefitService,
    public sources: IncomeSourceService,
    public settings: SettingsService,
    private router: Router,
    private translate: TranslateService,
    private host: ElementRef<HTMLElement>
  ) {
    this.uDate = this.benefits.today(); // not in the initializer: parameter properties are not assigned yet there
  }

  kindLabel(k: BenefitKind): string {
    return KIND_LABELS[k];
  }

  usage(b: BenefitModel) {
    return this.benefits.usageOf(b, this.year, this.month);
  }

  saving(b: BenefitModel): number {
    return this.benefits.savingOf(b, this.year, this.month);
  }

  back(): void {
    history.back();
  }

  closeForm(): void {
    const was = this.editingId;
    this.formFor.set(null);
    if (was) setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>('[data-benefit-id="' + was + '"]')?.scrollIntoView?.({ block: 'nearest' }));
  }

  openForm(b?: BenefitModel): void {
    const target = b?.id ?? 'new';
    if (this.formFor() === target) {
      this.closeForm(); // the same button again closes the form
      return;
    }
    this.error.set('');
    this.fName = b?.name ?? '';
    this.fKind = b?.kind ?? 'fuel-card';
    this.fProvider = b?.provider ?? '';
    this.fSource = b?.incomeSourceId ?? '';
    this.fValue = b?.monthlyValue ?? null;
    this.fLimit = b?.monthlyLimit ?? null;
    this.fFrom = b?.validFrom ?? '';
    this.fTo = b?.validTo ?? '';
    this.fActive = b?.active ?? true;
    this.fNotes = b?.notes ?? '';
    this.fMonetary = false;
    this.formFor.set(target);
    setTimeout(() => revealAndFocus(this.host.nativeElement.querySelector<HTMLElement>('.benefits-form'), 'input[name="fName"]'));
  }

  // "This is money you receive": it is not a benefit, it is an income source
  goToIncome(): void {
    this.router.navigate(['/income']);
  }

  save(): void {
    const data = {
      name: this.fName,
      kind: this.fKind,
      provider: this.fProvider,
      incomeSourceId: this.fSource || undefined,
      monthlyValue: Number(this.fValue ?? 0),
      monthlyLimit: this.fLimit ? Number(this.fLimit) : undefined,
      validFrom: this.fFrom || undefined,
      validTo: this.fTo || undefined,
      active: this.fActive,
      notes: this.fNotes,
    };
    const existing = this.editingId ? this.benefits.byId(this.editingId) : undefined;
    const result = existing ? this.benefits.update({ ...existing, ...data }) : this.benefits.add(data);
    if (!result.ok) {
      this.error.set(this.translate.instant(ERROR_TEXT[result.error]));
      return;
    }
    this.formFor.set(null);
  }

  remove(b: BenefitModel): void {
    if (!confirm(this.translate.instant('Delete this benefit and its usage notes? No money is affected.'))) return;
    this.benefits.remove(b.id);
  }

  toggleUse(b: BenefitModel): void {
    this.openUse.set(this.openUse() === b.id ? null : b.id);
    this.uAmount = null;
    this.uNote = '';
    this.uDate = this.benefits.today();
  }

  addUse(b: BenefitModel): void {
    const result = this.benefits.addUse(b.id, { date: this.uDate, amount: Number(this.uAmount), note: this.uNote });
    this.message.set(this.translate.instant(result.ok ? 'Use noted. No money moved.' : ERROR_TEXT[result.error]));
    if (result.ok) {
      this.uAmount = null;
      this.uNote = '';
    }
  }

  removeUse(b: BenefitModel, useId: string): void {
    this.benefits.removeUse(b.id, useId);
  }
}
