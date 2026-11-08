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
import { UpdateBannerComponent } from '../shared/components/update-banner/update-banner';
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
    UpdateBannerComponent,
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
    this.startUpdateChecks();
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

  // New versions (2.20.7): look for one a few seconds after start and each time the app comes back to the front, at most
  // every 30 minutes; a found update shows the banner. Loaded on demand, so it costs nothing at start-up.
  private startUpdateChecks(): void {
    const run = () => void import('../shared/services/app-update.service').then((m) => this.injector.get(m.AppUpdateService).autoCheck());
    setTimeout(run, 6000);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') run();
      });
    }
  }

  // Smart capture at start-up (2.18.0): nothing loads unless the user turned the capture switch on.
  // It resumes the captures that waited for the connection and, only if the mail switch is on too,
  // looks for new bank notices: at start-up and every time the app comes back to the foreground (an
  // iPhone keeps the app suspended, so "opening" it is a resume), never on a timer and never more
  // often than every 3 minutes. Every notice becomes a draft you approve.
  private startCapture(): void {
    const ai = this.storage.get<{ documentsEnabled?: boolean; documentsConsentAt?: string }>('ai-prefs', {});
    if (ai.documentsEnabled && ai.documentsConsentAt) {
      const run = async (): Promise<void> => {
        const m = await import('../shared/services/capture.service');
        const capture = this.injector.get(m.CaptureService);
        await capture.processQueue();
        if (!capture.prefs().mailEnabled || this.auth.mode() !== 'signed-in') return;
        const [{ MailCaptureService }, { mailScanDue }] = await Promise.all([import('../shared/services/mail-capture.service'), import('../shared/domain/capture/mail')]);
        const mail = this.injector.get(MailCaptureService);
        if (mail.scanning() || !mailScanDue(capture.prefs().lastMailScan, Date.now())) return;
        await mail.scan();
      };
      setTimeout(() => void run(), 4000);
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') void run();
        });
      }
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
      // Bank-app notifications (2.20.0): only when the user turned them on in Settings → Smart capture.
      // They are read on the device (no AI) and only ever become drafts in the tray.
      if (this.storage.get<{ notificationsEnabled?: boolean }>('capture-prefs', {}).notificationsEnabled) {
        void import('../shared/capture/notification-capture.service').then(async (m) => {
          const notices = this.injector.get(m.NotificationCaptureService);
          await notices.sync();
          await notices.drain();
          notices.onArrived(() => void notices.drain());
          // opened again from the background: whatever arrived meanwhile is read now
          void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
            if (isActive) void notices.drain();
          });
        });
      }
    }
  }

  async tryUnlock(): Promise<void> {
    if (!this.pin) return;
    const ok = await this.lock.unlock(this.pin);
    this.pin = '';
    this.pinError.set(!ok);
  }
}
