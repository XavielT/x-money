import { Component, Injector, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterOutlet } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Navbar } from '../shared/components/navbar/navbar';
import { TranslatePipe } from '../shared/pipes/translate.pipe';
import { RecurringService } from '../shared/services/recurring.service';
import { LockService } from '../shared/services/lock.service';
import { AuthService } from '../shared/services/auth.service';
import { SyncService } from '../shared/services/sync.service';
import { CreditCardService } from '../shared/services/credit-card.service';
import { CardNoticeService } from '../shared/services/card-notice.service';
import { StorageService } from '../shared/services/storage.service';
import { AuthGateComponent } from '../shared/components/auth-gate/auth-gate';
import { LinkWizardComponent } from '../shared/components/link-wizard/link-wizard';
import { SyncBannerComponent } from '../shared/components/sync-banner/sync-banner';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterOutlet,
    Navbar,
    TranslatePipe,
    AuthGateComponent,
    LinkWizardComponent,
    SyncBannerComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  pin = '';
  pinError = signal(false);

  // Injecting RecurringService here posts any due recurring transactions on startup
  constructor(
    private recurringService: RecurringService,
    public lock: LockService,
    public auth: AuthService,
    public sync: SyncService,
    private storage: StorageService,
    private injector: Injector,
    private router: Router
  ) {
    this.startCapture();
    // the optional device notices for critical alerts load only when the user turned them on
    if (Capacitor.isNativePlatform() && this.storage.get<{ smartAlerts?: boolean }>('device-prefs', {}).smartAlerts) {
      void import('../shared/services/insight-notice.service').then((m) => this.injector.get(m.InsightNoticeService));
    }
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

  // Smart capture at start-up (2.18.0): nothing loads unless the user turned the capture switch on.
  // It resumes the captures that waited for the connection and, only if the mail switch is on too,
  // looks for new bank notices (once per opening, never on a schedule).
  private startCapture(): void {
    const ai = this.storage.get<{ documentsEnabled?: boolean; documentsConsentAt?: string }>('ai-prefs', {});
    if (ai.documentsEnabled && ai.documentsConsentAt) {
      setTimeout(() => {
        void import('../shared/services/capture.service').then(async (m) => {
          const capture = this.injector.get(m.CaptureService);
          await capture.processQueue();
          if (capture.prefs().mailEnabled && this.auth.mode() === 'signed-in') {
            const mail = await import('../shared/services/mail-capture.service');
            await this.injector.get(mail.MailCaptureService).scan();
          }
        });
      }, 4000);
    }
    if (Capacitor.isNativePlatform()) {
      // something was shared to X Money from another app: go to Capture, where it is checked before sending
      void import('../shared/capture/share-receiver.service').then(async (m) => {
        const share = this.injector.get(m.ShareReceiverService);
        const handoff = await import('../shared/capture/share-handoff');
        const take = async () => {
          const items = await share.pending();
          if (!items.length) return;
          handoff.shareHandoff.items.push(...items);
          void this.router.navigate(['/capture']);
        };
        await take();
        share.onShared(() => void take());
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
