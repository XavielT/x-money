import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SettingsHeaderComponent } from '../../../../shared/components/settings-header/settings-header';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
import { LockService } from '../../../../shared/services/lock.service';
import { TranslateService } from '../../../../shared/services/translate.service';

// Settings > App lock: the PIN that locks the app on start and when it goes to the background.
@Component({
  selector: 'app-settings-security',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, SettingsHeaderComponent],
  template: `
    <div class="x-page settings">
      <app-settings-header title="App lock" />
      <section class="settings-section" id="security">
        <p class="settings-hint">{{ 'Protect the app with a PIN. It locks on start and when going to background.' | t }}</p>

        <div class="settings-lock x-card" *ngIf="!lock.enabled()">
          <input class="x-input" type="password" inputmode="numeric" maxlength="8" [placeholder]="'New PIN (4-8 digits)' | t" [(ngModel)]="lockPin" name="lockPin" />
          <button class="x-btn" [disabled]="lockPin.trim().length < 4" (click)="enableLock()">{{ 'Enable lock' | t }}</button>
        </div>

        <div class="settings-lock x-card" *ngIf="lock.enabled()">
          <input class="x-input" type="password" inputmode="numeric" maxlength="8" [placeholder]="'Current PIN' | t" [(ngModel)]="unlockPin" name="unlockPin" />
          <button class="x-btn x-btn-danger" [disabled]="!unlockPin.trim()" (click)="disableLock()">{{ 'Disable lock' | t }}</button>
        </div>
      </section>
    </div>
  `,
  styleUrl: '../settings.scss',
})
export class SettingsSecurityComponent {
  lockPin = '';
  unlockPin = '';

  constructor(
    public lock: LockService,
    private translate: TranslateService
  ) {}

  async enableLock(): Promise<void> {
    const pin = this.lockPin.trim();
    if (!/^\d{4,8}$/.test(pin)) return;
    await this.lock.enable(pin);
    this.lockPin = '';
  }

  async disableLock(): Promise<void> {
    if (!(await this.lock.verify(this.unlockPin.trim()))) {
      alert(this.translate.instant('Wrong PIN'));
      return;
    }
    this.lock.disable();
    this.unlockPin = '';
  }
}
