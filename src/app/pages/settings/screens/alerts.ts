import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InsightSettingsComponent } from '../../../../shared/components/insight-settings/insight-settings';
import { SettingsHeaderComponent } from '../../../../shared/components/settings-header/settings-header';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
import { CardNoticeService } from '../../../../shared/services/card-notice.service';
import { SettingsService } from '../../../../shared/services/settings.service';

// Settings > Alerts: card reminders and smart alerts up front; the budget thresholds are folded under "Advanced".
@Component({
  selector: 'app-settings-alerts',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, SettingsHeaderComponent, InsightSettingsComponent],
  templateUrl: './alerts.html',
  styleUrl: '../settings.scss',
})
export class SettingsAlertsComponent {
  constructor(
    public settingsService: SettingsService,
    public cardNotices: CardNoticeService
  ) {}

  setAntMax(value: number | null): void {
    this.settingsService.setAntMax(value && value > 0 ? Number(value) : undefined);
  }

  // Device reminders for card cut and due dates. The system permission is asked only here.
  async toggleCardAlerts(event: Event): Promise<void> {
    const on = (event.target as HTMLInputElement).checked;
    if (on) {
      const granted = await this.cardNotices.enable();
      if (!granted) (event.target as HTMLInputElement).checked = false;
    } else {
      await this.cardNotices.disable();
    }
  }
}
