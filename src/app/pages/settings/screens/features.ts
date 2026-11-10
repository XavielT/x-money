import { Component } from '@angular/core';
import { AiSettingsComponent } from '../../../../shared/components/ai-settings/ai-settings';
import { CaptureSettingsComponent } from '../../../../shared/components/capture-settings/capture-settings';
import { ModuleSwitchesComponent } from '../../../../shared/components/module-switches/module-switches';
import { SettingsHeaderComponent } from '../../../../shared/components/settings-header/settings-header';

// Settings > Features: the module switches, then the optional AI and smart capture with their own consents.
@Component({
  selector: 'app-settings-features',
  standalone: true,
  imports: [SettingsHeaderComponent, ModuleSwitchesComponent, AiSettingsComponent, CaptureSettingsComponent],
  template: `
    <div class="x-page settings">
      <app-settings-header title="Features" />
      <app-module-switches />
      <app-ai-settings />
      <app-capture-settings />
    </div>
  `,
  styleUrl: '../settings.scss',
})
export class SettingsFeaturesComponent {}
