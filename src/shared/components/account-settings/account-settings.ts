import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { AuthService, SessionInfo } from '../../services/auth.service';
import { SyncService } from '../../services/sync.service';
import { ConflictModel, ConflictService } from '../../services/conflict.service';
import { BackupReminderService } from '../../services/backup-reminder.service';
import { ExportService } from '../../services/export.service';
import { SettingsService } from '../../services/settings.service';
import { TranslateService } from '../../services/translate.service';
import { ApiError } from '../../data-layer/api-client';

// Settings -> Account: who is signed in, sync status, password, recovery code, devices,
// sign out, and the change history (conflicts). In local-only mode it just says so.
@Component({
  selector: 'app-account-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './account-settings.html',
  styleUrl: './account-settings.scss',
})
export class AccountSettingsComponent {
  sessions = signal<SessionInfo[]>([]);
  message = signal<{ text: string; ok: boolean } | null>(null);
  busy = signal(false);
  currentPassword = '';
  newPassword = '';
  recoveryPassword = '';
  reminderDays = 30;
  invite = signal<{ code: string; expiresAt: number } | null>(null);

  // iOS Safari has no install prompt: hint only when it can be installed and is not yet
  showIosHint = computed(() => 'standalone' in navigator && !(navigator as { standalone?: boolean }).standalone);

  statusKey = computed(() => {
    switch (this.sync.status()) {
      case 'syncing':
        return 'Syncing…';
      case 'offline':
        return 'Offline';
      case 'error':
        return this.sync.lastError() === 'account_disabled' ? 'This account is disabled.' : 'Sync error';
      case 'auth':
        return 'Sign in again';
      case 'readonly':
        return 'Read-only: update X Money';
      default:
        return this.sync.pending() ? 'Waiting to sync' : 'Synced';
    }
  });

  async makeInvite(): Promise<void> {
    this.busy.set(true);
    this.message.set(null);
    try {
      this.invite.set(await this.auth.createInvite());
    } catch (error) {
      const code = error instanceof ApiError ? error.code : '';
      this.message.set({
        ok: false,
        text: this.translate.instant(code === 'not_owner' ? 'Only the first (owner) account can create invite codes.' : code === 'too_many_invites' ? 'You already have 5 unused codes. Wait for one to be used or to expire.' : 'The code could not be created. Try again.'),
      });
    } finally {
      this.busy.set(false);
    }
  }

  async copyInvite(): Promise<void> {
    const code = this.invite()?.code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      this.message.set({ ok: true, text: this.translate.instant('Copied.') });
    } catch {
      this.message.set({ ok: false, text: this.translate.instant('It could not be copied: write it down.') });
    }
  }

  constructor(
    public auth: AuthService,
    public sync: SyncService,
    public conflictService: ConflictService,
    public reminder: BackupReminderService,
    private exportService: ExportService,
    private settings: SettingsService,
    private translate: TranslateService
  ) {
    this.reminderDays = reminder.reminderDays();
    if (auth.mode() === 'signed-in') void this.loadSessions();
  }

  private say(key: string, ok = true): void {
    this.message.set({ text: this.translate.instant(key), ok });
  }

  private errorKey(e: unknown): string {
    const code = e instanceof ApiError ? e.code : '';
    if (e instanceof ApiError && e.status === 0) return 'No connection. The first sign-in needs internet.';
    if (code === 'invalid_credentials') return 'Wrong password.';
    if (code === 'weak_password') return 'The password needs at least 6 characters.';
    if (code === 'locked') return 'Account locked. Try again later.';
    return 'Something went wrong. Try again.';
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.message.set(null);
    try {
      await action();
    } catch (e) {
      this.say(this.errorKey(e), false);
    } finally {
      this.busy.set(false);
    }
  }

  async loadSessions(): Promise<void> {
    try {
      this.sessions.set(await this.auth.sessions());
    } catch {
      /* offline: the list is optional */
    }
  }

  changePassword(): Promise<void> {
    return this.run(async () => {
      await this.auth.changePassword(this.currentPassword, this.newPassword);
      this.currentPassword = this.newPassword = '';
      this.say('Password updated. Other devices were signed out.');
      await this.loadSessions();
    });
  }

  regenerateCode(): Promise<void> {
    return this.run(async () => {
      await this.auth.regenerateRecoveryCode(this.recoveryPassword);
      this.recoveryPassword = '';
    });
  }

  revoke(session: SessionInfo): Promise<void> {
    return this.run(async () => {
      await this.auth.revokeSession(session.id);
      await this.loadSessions();
    });
  }

  syncNow(): Promise<void> {
    return this.sync.syncNow();
  }

  setReminderDays(): void {
    this.reminder.setDays(Number(this.reminderDays));
  }

  async signOut(): Promise<void> {
    if (this.sync.pending() > 0) {
      const syncFirst = confirm(this.translate.instant('You have changes that are not synced yet. OK = sync now. Cancel = export a backup instead.'));
      if (!syncFirst) {
        await this.exportBackup();
        return;
      }
      await this.sync.syncNow();
      if (this.sync.pending() > 0) {
        alert(this.translate.instant('Could not sync. Export a backup and try again.'));
        return;
      }
    }
    const eraseLocal = confirm(this.translate.instant('Also remove this device copy of your financial data? OK = remove (recommended). Cancel = keep it here. Your account data is not deleted.'));
    await this.auth.logout({ eraseLocal });
  }

  private async exportBackup(): Promise<void> {
    const stamp = new Date().toISOString().slice(0, 10);
    await this.exportService.exportFile(`x-money-backup-${stamp}.json`, this.settings.exportData(), 'application/json');
    this.reminder.markExported();
  }

  describe(c: ConflictModel): string {
    const d = (c.data ?? {}) as Record<string, unknown>;
    const parts = [d['name'], d['amount'], d['date'], d['note']].filter((v) => v !== undefined && v !== '').join(' · ');
    return `${c.collection} · ${parts || c.recordId}`;
  }

  when(ms: number): string {
    return new Date(ms).toLocaleString(this.translate.locale());
  }
}
