import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { BackupReminderService } from '../../services/backup-reminder.service';
import { StorageService } from '../../services/storage.service';
import { SyncService } from '../../services/sync.service';
import { TransactionService } from '../../services/transaction.service';

// Thin strip at the top for things that must not go unnoticed: read-only mode (app older
// than the data), a wrong device clock, and the backup reminder.
@Component({
  selector: 'app-sync-banner',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe],
  templateUrl: './sync-banner.html',
  styleUrl: './sync-banner.scss',
})
export class SyncBannerComponent {
  skewDismissed = signal(false);
  backupDismissed = signal(false);

  constructor(
    public storage: StorageService,
    public sync: SyncService,
    public reminder: BackupReminderService,
    public transactions: TransactionService
  ) {}
}
