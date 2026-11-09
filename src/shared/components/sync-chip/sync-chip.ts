import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { syncNotice } from '../../domain/sync-notice';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { AuthService } from '../../services/auth.service';
import { MailCaptureService } from '../../services/mail-capture.service';
import { SyncService } from '../../services/sync.service';

// Under the main figure of Home: tells the user when the numbers are still being brought up to date, or that they are the last
// saved ones (offline). It never blocks anything and always keeps its row, so figures changing do not look like a layout jump.
@Component({
  selector: 'app-sync-chip',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  template: `
    <div class="chip" [class.on]="notice() !== 'none'" [attr.aria-live]="'polite'">
      <ng-container *ngIf="notice() === 'updating'"><span class="dot"></span>{{ 'Updating…' | t }}</ng-container>
      <ng-container *ngIf="notice() === 'offline'">{{ 'Offline: showing the last saved data' | t }}<ng-container *ngIf="lastTime()"> · {{ lastTime() }}</ng-container></ng-container>
    </div>
  `,
  styles: `
    .chip {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-height: 28px;
      margin: 6px 0;
      font-size: 0.75rem;
      color: var(--main-ultra-light);
      visibility: hidden;
    }
    .chip.on {
      visibility: visible;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--Hub);
      animation: chip-pulse 1.2s ease-in-out infinite;
    }
    @keyframes chip-pulse {
      50% {
        opacity: 0.25;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .dot {
        animation: none;
      }
    }
  `,
})
export class SyncChipComponent {
  notice = computed(() =>
    syncNotice({
      signedIn: this.auth.mode() === 'signed-in',
      linkReady: this.sync.link().phase === 'none',
      status: this.sync.status(),
      lastSyncAt: this.sync.lastSyncAt(),
      scanningMail: this.mail.scanning(),
    })
  );

  lastTime = computed(() => {
    const at = this.sync.lastSyncAt();
    return at === null ? '' : new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  });

  constructor(
    private auth: AuthService,
    private sync: SyncService,
    private mail: MailCaptureService
  ) {}
}
