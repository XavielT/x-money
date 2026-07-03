import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterOutlet } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Navbar } from '../shared/components/navbar/navbar';
import { TranslatePipe } from '../shared/pipes/translate.pipe';
import { RecurringService } from '../shared/services/recurring.service';
import { LockService } from '../shared/services/lock.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterOutlet, Navbar, TranslatePipe],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  pin = '';
  pinError = signal(false);

  // Injecting RecurringService here posts any due recurring transactions on startup
  constructor(
    private recurringService: RecurringService,
    public lock: LockService
  ) {
    if (Capacitor.isNativePlatform()) {
      // Android hardware back: navigate back inside the app, exit only from Home
      CapacitorApp.addListener('backButton', () => {
        if (window.location.pathname === '/' || this.lock.locked()) {
          CapacitorApp.exitApp();
        } else {
          history.back();
        }
      });
      // Re-lock when the app goes to background
      CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) this.lock.lock();
      });
    }
  }

  async tryUnlock(): Promise<void> {
    if (!this.pin) return;
    const ok = await this.lock.unlock(this.pin);
    this.pin = '';
    this.pinError.set(!ok);
  }
}
