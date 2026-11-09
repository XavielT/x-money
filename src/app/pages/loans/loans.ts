import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LoanModel } from '../../../shared/models/loan.model';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { LoanResult, LoanService } from '../../../shared/services/loan.service';
import { SettingsService } from '../../../shared/services/settings.service';
import { TranslateService } from '../../../shared/services/translate.service';
import { outstanding, paidOfInstallment } from '../../../shared/domain/loan-ops';

const ERRORS: Record<string, string> = {
  amount: 'The amount must be greater than zero.',
  exceeds: 'That is more than what is left on this installment (or than the debt).',
  'no-installment': 'There is no installment to pay.',
  inactive: 'This loan is closed.',
  account: 'Choose an existing RD$ account.',
  'out-of-order': 'Finish the installments in order before an extra payment.',
  'partial-pending': 'Complete the installment you started before an extra payment.',
  'method-rate': 'Extra payments are not supported for flat-rate loans.',
  'later-payments': 'Reverse the later payments first.',
  'already-reversed': 'This payment is already reversed.',
  'read-only': 'This device is read-only right now.',
  write: 'The movements could not be written.',
};

import { ModuleOffComponent } from '../../../shared/components/module-off/module-off';

@Component({
  selector: 'app-loans',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe, ModuleOffComponent],
  templateUrl: './loans.html',
  styleUrl: './loans.scss',
})
export class LoansComponent {
  message = signal('');
  openId = signal<string | null>(null);
  extraOpen = signal(false);

  payAmount: number | null = null;
  payDate = '';
  payInstallment: number | null = null;
  extraAmount: number | null = null;
  extraMode: 'reduce-term' | 'reduce-installment' = 'reduce-term';

  list = computed(() =>
    this.loans.loans().map((loan) => {
      const owed = outstanding(loan);
      const next = this.loans.next(loan);
      return {
        loan,
        owed,
        percent: loan.debt > 0 ? Math.min(100, Math.round(((loan.debt - owed) / loan.debt) * 100)) : 0,
        next,
        nextLeft: next ? this.loans.remaining(loan, next.n) : 0,
        alert: this.loans.alerts().find((a) => a.loanId === loan.id),
      };
    })
  );
  active = computed(() => this.list().filter((r) => r.loan.status !== 'voided'));
  voided = computed(() => this.list().filter((r) => r.loan.status === 'voided'));

  constructor(
    private translate: TranslateService,
    public loans: LoanService,
    public settings: SettingsService
  ) {
    this.payDate = this.loans.today();
  }

  money(n: number | null | undefined): string {
    return `${this.settings.currency()}${(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  paidOf(l: LoanModel, n: number): number {
    return paidOfInstallment(l, n);
  }

  alertText(a: { stage: string; daysLeft: number }, name: string): string {
    const key = a.stage === 'overdue' ? 'The installment of {name} is {days} days overdue' : a.daysLeft <= 0 ? 'The installment of {name} is due today' : 'The installment of {name} is due in {days} days';
    return this.translate.instant(key, { name, days: String(Math.abs(a.daysLeft)) });
  }

  private report(r: LoanResult, done?: () => void): boolean {
    if (r.ok) {
      this.message.set('');
      done?.();
      return true;
    }
    this.message.set(this.translate.instant(ERRORS[r.error] ?? 'That could not be saved.'));
    return false;
  }

  toggle(l: LoanModel): void {
    const open = this.openId() === l.id;
    this.openId.set(open ? null : l.id);
    this.extraOpen.set(false);
    this.message.set('');
    this.payInstallment = null;
    this.payAmount = null;
    this.payDate = this.loans.today();
  }

  // The amount is prefilled with what is left on the installment: the user may type less (a partial payment)
  prefill(l: LoanModel): void {
    const row = this.payInstallment ? l.schedule.find((r) => r.n === Number(this.payInstallment)) : this.loans.next(l);
    this.payAmount = row ? this.loans.remaining(l, row.n) : null;
  }

  pay(l: LoanModel): void {
    const amount = this.payAmount ?? this.loans.remaining(l, this.loans.next(l)?.n ?? 0);
    this.report(this.loans.pay(l.id, { amount: Number(amount), date: this.payDate, installment: this.payInstallment ? Number(this.payInstallment) : undefined }), () => {
      this.payAmount = null;
      this.payInstallment = null;
    });
  }

  payExtra(l: LoanModel): void {
    this.report(this.loans.payExtra(l.id, { amount: Number(this.extraAmount ?? 0), mode: this.extraMode, date: this.payDate }), () => {
      this.extraAmount = null;
      this.extraOpen.set(false);
    });
  }

  reverse(l: LoanModel, paymentId: string): void {
    if (!confirm(this.translate.instant('Reverse this payment? It stays in the history.'))) return;
    this.report(this.loans.reversePayment(l.id, paymentId));
  }

  undo(l: LoanModel): void {
    if (!confirm(this.translate.instant('Undo this loan? The money received is reversed and nothing is deleted.'))) return;
    this.report(this.loans.undo(l.id));
  }
}
