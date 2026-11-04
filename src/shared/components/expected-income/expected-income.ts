import { Component, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Expectation } from '../../domain/income';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { TX_ERROR_TEXT } from '../../ui/tx-error-text';
import { IncomeService } from '../../services/income.service';
import { IncomeSourceService } from '../../services/income-source.service';
import { SettingsService } from '../../services/settings.service';
import { TranslateService } from '../../services/translate.service';

// "Expected this week" and "Did it arrive?". An expected income is an expectation, never money:
// the movement is created only when the user taps "Yes, it arrived".
@Component({
  selector: 'app-expected-income',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './expected-income.html',
  styleUrl: './expected-income.scss',
})
export class ExpectedIncomeComponent {
  @Input() limit = 3;
  message = signal('');

  pending = computed(() => this.income.pending().slice(0, this.limit));
  upcoming = computed(() => this.income.upcoming().slice(0, this.limit));
  visible = computed(() => this.pending().length > 0 || this.upcoming().length > 0 || !!this.message());

  constructor(
    private income: IncomeService,
    private sources: IncomeSourceService,
    private router: Router,
    private translate: TranslateService,
    public settings: SettingsService
  ) {}

  name(e: Expectation): string {
    return this.sources.byId(e.sourceId)?.name ?? '';
  }

  icon(e: Expectation): string {
    return this.sources.byId(e.sourceId)?.icon ?? '💼';
  }

  expectedNet(e: Expectation): number | undefined {
    return this.sources.byId(e.sourceId)?.expectedNet;
  }

  weekday(e: Expectation): string {
    return new Date(`${e.date}T12:00:00`).toLocaleDateString(this.translate.locale(), { weekday: 'long' });
  }

  confirm(e: Expectation): void {
    const result = this.income.confirm(e.sourceId, e.date);
    this.message.set(this.translate.instant(result.ok ? 'Income registered.' : result.error === 'amount' ? 'Enter the amount you received.' : TX_ERROR_TEXT[result.error]));
    if (!result.ok && result.error === 'amount') this.other(e);
  }

  // A different amount, or a source without an expected figure: the form opens preloaded
  other(e: Expectation): void {
    this.router.navigate(['/add'], { queryParams: { kind: 'income', source: e.sourceId, date: e.date } });
  }

  skip(e: Expectation): void {
    this.income.skip(e.sourceId, e.date);
  }
}
