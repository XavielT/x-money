import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { syncStatusView } from '../../domain/sync-status';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { AuthService } from '../../services/auth.service';
import { BackupReminderService } from '../../services/backup-reminder.service';
import { BackupService } from '../../services/backup.service';
import { SyncService } from '../../services/sync.service';
import { TranslateService } from '../../services/translate.service';

// Top of Settings > Your data: how syncing is going and when the last backup was. It only reads; the sync itself is untouched.
@Component({
  selector: 'app-sync-status',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './sync-status.html',
  styleUrl: '../account-settings/account-settings.scss',
})
export class SyncStatusComponent {
  reminderDays: number;

  view = computed(() =>
    syncStatusView({ signedIn: this.auth.mode() !== 'local', status: this.sync.status(), pending: this.sync.pending(), lastError: this.sync.lastError() ?? null })
  );

  constructor(
    public auth: AuthService,
    public sync: SyncService,
    public reminder: BackupReminderService,
    private backup: BackupService,
    private translate: TranslateService
  ) {
    this.reminder.refreshClock();
    this.reminderDays = reminder.reminderDays();
  }

  syncNow(): Promise<void> {
    return this.sync.syncNow();
  }

  backUpNow(): Promise<void> {
    return this.backup.exportJson();
  }

  setReminderDays(): void {
    this.reminder.setDays(Number(this.reminderDays));
  }

  snoozed(): number | null {
    const until = this.reminder.snoozedUntil();
    return until !== null && until > Date.now() ? until : null;
  }

  when(ms: number): string {
    return new Date(ms).toLocaleString(this.translate.locale());
  }

  day(ms: number): string {
    return new Date(ms).toLocaleDateString(this.translate.locale());
  }
}
