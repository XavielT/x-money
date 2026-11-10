import { Component } from '@angular/core';
import { AccountSettingsComponent } from '../../../../shared/components/account-settings/account-settings';
import { SettingsHeaderComponent } from '../../../../shared/components/settings-header/settings-header';

// Settings > Account: who is signed in, devices, password, recovery code, invites and sign out.
@Component({
  selector: 'app-settings-account',
  standalone: true,
  imports: [SettingsHeaderComponent, AccountSettingsComponent],
  template: `
    <div class="x-page settings">
      <app-settings-header title="Account" />
      <app-account-settings></app-account-settings>
    </div>
  `,
  styleUrl: '../settings.scss',
})
export class SettingsAccountComponent {}
