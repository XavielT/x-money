import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Indicator } from '../../domain/dashboard';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { DashboardService } from '../../services/dashboard.service';
import { SettingsService } from '../../services/settings.service';
import { IndicatorSheetComponent } from '../indicator-sheet/indicator-sheet';

// The ten indicators: "Available money" as the main figure and the rest in two columns under
// "See more". Each one opens "How was it calculated?". Indicators of modules that do not exist
// yet are not drawn at all (a zero would mislead).
@Component({
  selector: 'app-dashboard-indicators',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe, IndicatorSheetComponent],
  templateUrl: './dashboard-indicators.html',
  styleUrl: './dashboard-indicators.scss',
})
export class DashboardIndicatorsComponent {
  expanded = signal(false);
  selected = signal<Indicator | null>(null);

  main = computed(() => this.dashboard.visible().find((i) => i.id === 'available')!);
  others = computed(() => this.dashboard.visible().filter((i) => i.id !== 'available'));
  liquid = computed(() => this.main()?.components.find((c) => c.label === 'Liquid net worth')?.amount ?? 0);

  constructor(
    private dashboard: DashboardService,
    public settings: SettingsService
  ) {}

  open(i: Indicator): void {
    this.selected.set(i);
  }
}
