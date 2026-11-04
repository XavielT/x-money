import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SNAPSHOT_ORDER, UnusualFlag } from '../../../shared/domain/dashboard';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { CategoryService } from '../../../shared/services/category.service';
import { DashboardService } from '../../../shared/services/dashboard.service';
import { SettingsService } from '../../../shared/services/settings.service';
import { TranslateService } from '../../../shared/services/translate.service';

type Tab = 'evolution' | 'categories' | 'sources' | 'savings' | 'compare' | 'cashflow' | 'unusual';

const ROW_LABELS: Record<string, string> = {
  personalNet: 'Personal income (net)',
  commercialGross: 'Commercial sales (gross)',
  commercialBenefit: 'Commercial net benefit',
  expense: 'Expenses',
  fixedExpense: 'Fixed expenses',
  variableExpense: 'Variable expenses',
  netFlow: 'Income − expenses',
  liquidEnd: 'Liquid balance at month end',
};

// Analysis: each tab composes DashboardService (which composes the other services); nothing
// here calculates money. Estimates are labelled and show their assumptions.
@Component({
  selector: 'app-analysis',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './analysis.html',
  styleUrl: './analysis.scss',
})
export class AnalysisComponent {
  readonly tabs: { key: Tab; label: string }[] = [
    { key: 'evolution', label: 'Evolution' },
    { key: 'categories', label: 'Categories' },
    { key: 'sources', label: 'Income sources' },
    { key: 'savings', label: 'Savings' },
    { key: 'compare', label: 'Compare' },
    { key: 'cashflow', label: 'Cash flow' },
    { key: 'unusual', label: 'Unusual' },
  ];
  tab = signal<Tab>('evolution');

  // assigned in the constructor: parameter properties are not ready in field initializers
  flow: DashboardService['flow12'];
  savings: DashboardService['savings12'];
  topSources: DashboardService['topSources'];
  cashflow: DashboardService['cashflow'];
  unusual: DashboardService['unusual'];

  // category month and the two months of the comparison
  monthCat = signal('');
  monthA = signal('');
  monthB = signal('');

  share = computed(() => this.dashboard.categoryShare(this.monthCat()));
  rows = computed(() => this.dashboard.compare(this.monthA(), this.monthB()));
  months = computed(() => this.dashboard.months());

  // ----- chart geometry (presentation only)

  bars = computed(() => {
    const flow = this.flow();
    const max = Math.max(1, ...flow.flatMap((m) => [m.income, m.expense]));
    return flow.map((m, i) => ({
      label: m.month.slice(5),
      x: i * 20 + 2,
      incomeH: Math.round((m.income / max) * 70),
      expenseH: Math.round((m.expense / max) * 70),
      partial: m.partial,
      income: m.income,
      expense: m.expense,
    }));
  });

  donut = computed(() => {
    let offset = 25; // starts at the top
    return this.share()
      .slice(0, 8)
      .map((s) => {
        const slice = { ...s, dash: `${s.percent} ${100 - s.percent}`, offset };
        offset -= s.percent;
        return slice;
      });
  });

  savingsLine = computed(() => {
    const pts = this.savings();
    if (!pts.length) return '';
    const max = Math.max(1, ...pts.map((p) => p.total));
    const min = Math.min(...pts.map((p) => p.total), 0);
    const span = Math.max(1, max - min);
    return pts.map((p, i) => `${Math.round((i / Math.max(1, pts.length - 1)) * 100)},${Math.round(38 - ((p.total - min) / span) * 34)}`).join(' ');
  });

  flowLines = computed(() => {
    const points = this.cashflow().points;
    const all = points.flatMap((p) => [p.low, p.mid, p.high]);
    const max = Math.max(...all);
    const min = Math.min(...all, 0);
    const span = Math.max(1, max - min);
    const y = (v: number) => Math.round(58 - ((v - min) / span) * 54);
    const line = (pick: (p: (typeof points)[number]) => number) => points.map((p) => `${Math.round((p.day / 90) * 100)},${y(pick(p))}`).join(' ');
    return { mid: line((p) => p.mid), low: line((p) => p.low), high: line((p) => p.high), zero: y(0) };
  });

  constructor(
    private dashboard: DashboardService,
    private categories: CategoryService,
    public settings: SettingsService,
    private translate: TranslateService
  ) {
    this.flow = dashboard.flow12;
    this.savings = dashboard.savings12;
    this.topSources = dashboard.topSources;
    this.cashflow = dashboard.cashflow;
    this.unusual = dashboard.unusual;
    const months = dashboard.months();
    this.monthCat.set(months[0]);
    this.monthA.set(months[1] ?? months[0]);
    this.monthB.set(months[0]);
  }

  rowLabel(id: string): string {
    return ROW_LABELS[id] ?? id;
  }

  categoryName(id: string): string {
    return this.categories.byId(id)?.name ?? id;
  }

  setCushion(value: number | null): void {
    this.settings.setDashboard({ cushion: value && value > 0 ? Number(value) : 0 });
  }

  setUnusualMin(value: number | null): void {
    this.settings.setDashboard({ unusualMin: value && value > 0 ? Number(value) : 0 });
  }

  // "Why it was flagged"
  why(f: UnusualFlag): string {
    const params = { n: String(f.samples), threshold: `${this.settings.currency()}${Math.round(f.threshold).toLocaleString('en-US')}`, reference: `${this.settings.currency()}${Math.round(f.reference).toLocaleString('en-US')}` };
    return this.translate.instant(
      f.rule === 'iqr' ? 'Above Q3 + 1.5 × IQR ({threshold}) of your last {n} movements in this category' : 'More than 2 × the median ({reference}) of your last {n} movements in this category',
      params
    );
  }

  back(): void {
    history.back();
  }

  readonly order = SNAPSHOT_ORDER;
}
