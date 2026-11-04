import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RULES, RuleDef } from '../../domain/insights/engine';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { InsightNoticeService } from '../../services/insight-notice.service';
import { SmartInsightService } from '../../services/smart-insight.service';

// Settings → "Smart alerts": every rule can be switched off and has thresholds the user can change.
// Device notifications are opt-in and only for the critical alerts.
@Component({
  selector: 'app-insight-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './insight-settings.html',
  styleUrl: './insight-settings.scss',
})
export class InsightSettingsComponent {
  rules = RULES;

  constructor(
    public insights: SmartInsightService,
    public notices: InsightNoticeService
  ) {}

  enabled(r: RuleDef): boolean {
    return this.insights.ruleSetting(r.id).enabled;
  }

  value(r: RuleDef, key: string): number {
    return this.insights.ruleSetting(r.id).thresholds[key];
  }

  toggle(r: RuleDef, on: boolean): void {
    this.insights.setRule(r.id, { enabled: on });
  }

  setThreshold(r: RuleDef, key: string, value: number): void {
    if (!Number.isFinite(Number(value))) return;
    this.insights.setRule(r.id, { thresholds: { [key]: Number(value) } });
  }

  async toggleNotices(on: boolean): Promise<void> {
    if (on) await this.notices.enable();
    else await this.notices.disable();
  }
}
