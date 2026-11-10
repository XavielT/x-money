import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SettingsHeaderComponent } from '../../../../shared/components/settings-header/settings-header';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
import { SettingsService } from '../../../../shared/services/settings.service';
import { AppLanguage, TranslateService } from '../../../../shared/services/translate.service';

// Settings > Preferences: language, the symbol for pesos and the default bank transfer tax.
@Component({
  selector: 'app-settings-preferences',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe, SettingsHeaderComponent],
  templateUrl: './preferences.html',
  styleUrl: '../settings.scss',
})
export class SettingsPreferencesComponent {
  currencies = ['$', 'RD$', '€', '£', '¥'];

  constructor(
    public settingsService: SettingsService,
    public translate: TranslateService
  ) {}

  setCurrency(symbol: string): void {
    this.settingsService.setCurrency(symbol);
  }

  setTaxPercent(value: number | string): void {
    const percent = Number(value);
    if (isFinite(percent)) this.settingsService.setTaxPercent(percent);
  }

  setLanguage(lang: AppLanguage): void {
    if (this.translate.lang() === lang) return;
    this.translate.setLanguage(lang);
    location.reload(); // re-render everything in the new language
  }
}
