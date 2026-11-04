import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Insight } from '../../domain/insights/types';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { SmartInsightService } from '../../services/smart-insight.service';
import { TranslateService } from '../../services/translate.service';

// The three most important smart alerts in ONE card inside the alerts area of Home. Loaded
// deferred (idle) so the detectors never delay the first screen or the entry of a movement.
@Component({
  selector: 'app-home-insights',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe],
  template: `
    <a routerLink="/insights" class="home-insights x-card" *ngIf="top().length">
      <b>🔔 {{ 'Smart alerts' | t }}</b>
      <span class="home-insight" *ngFor="let i of top()" [class.alert]="i.severity === 'alert'">• {{ title(i) }}</span>
    </a>
  `,
  styles: [
    `
      .home-insights {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 12px 16px;
        margin-bottom: 10px;
        text-decoration: none;
        color: var(--text);
        font-size: 0.88rem;
      }
      .home-insight {
        font-size: 0.82rem;
      }
      .home-insight.alert {
        color: var(--expense);
        font-weight: 600;
      }
    `,
  ],
})
export class HomeInsightsComponent {
  top = computed(() => this.insights.top());

  constructor(
    private insights: SmartInsightService,
    private translate: TranslateService
  ) {}

  title(i: Insight): string {
    return this.translate.instant(i.titleKey);
  }
}
