import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SettingsHeaderComponent } from '../../../../shared/components/settings-header/settings-header';
import { APP_VERSION } from '../../../../shared/config/app-version';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
import { AppUpdateService } from '../../../../shared/services/app-update.service';

// Settings > About and updates: the version and the update check.
@Component({
  selector: 'app-settings-about',
  standalone: true,
  imports: [CommonModule, TranslatePipe, SettingsHeaderComponent],
  template: `
    <div class="x-page settings">
      <app-settings-header title="About and updates" />
      <section class="settings-section" id="about">
        <h2>{{ 'App updates' | t }}</h2>
        <p class="settings-hint">X Money · v{{ version }}<ng-container *ngIf="updates.latest() as l"> · {{ 'latest' | t }} v{{ l }}</ng-container></p>
        <div class="settings-data">
          <button class="x-btn" (click)="updates.check()" [disabled]="updates.state() === 'checking' || updates.state() === 'applying'">{{ 'Check for updates' | t }}</button>
          <button class="x-btn" *ngIf="updates.state() === 'available'" (click)="updates.apply()">{{ 'Update now' | t }}</button>
        </div>
        <p class="settings-hint" *ngIf="updateStatusKey() as k">{{ k | t }}</p>
      </section>
    </div>
  `,
  styleUrl: '../settings.scss',
})
export class SettingsAboutComponent {
  readonly version = APP_VERSION;

  constructor(public updates: AppUpdateService) {}

  // The line under the update button
  updateStatusKey(): string {
    const u = this.updates;
    switch (u.state()) {
      case 'checking':
        return 'Looking for a new version…';
      case 'up-to-date':
        return 'You have the latest version.';
      case 'available':
        return u.native ? 'A new version is ready. It downloads as a file: open it to install it; your data stays.' : 'A new version is ready. Updating reloads the app; your data stays.';
      case 'applying':
        return 'Updating…';
      case 'error':
        return 'Could not check for updates. Check your connection and try again.';
      case 'unsupported':
        return 'This browser updates the app by itself when you reload it.';
      default:
        return '';
    }
  }
}
