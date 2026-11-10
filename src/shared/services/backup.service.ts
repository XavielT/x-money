import { Injectable } from '@angular/core';
import { BackupReminderService } from './backup-reminder.service';
import { ExportService } from './export.service';
import { SettingsService } from './settings.service';

// The one way to save a backup file: the same file Settings has always exported, and the "last backup" clock restarts.
@Injectable({ providedIn: 'root' })
export class BackupService {
  constructor(
    private exportService: ExportService,
    private settings: SettingsService,
    private reminder: BackupReminderService
  ) {}

  async exportJson(): Promise<void> {
    const stamp = new Date().toISOString().slice(0, 10);
    await this.exportService.exportFile(`x-money-backup-${stamp}.json`, this.settings.exportData(), 'application/json');
    this.reminder.markExported();
  }
}
