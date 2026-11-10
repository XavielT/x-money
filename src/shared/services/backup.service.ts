import { Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { BackupReminderService } from './backup-reminder.service';
import { ExportService } from './export.service';
import { SettingsService } from './settings.service';

// The one way to save a backup file: the same file Settings has always exported.
// The "last backup" clock only restarts when the user confirms the file was saved: on the phone the share sheet cannot say
// whether the file really arrived anywhere (the user may pick an app and go back), so the app asks.
@Injectable({ providedIn: 'root' })
export class BackupService {
  awaitingConfirm = signal(false);

  // overridable in tests
  native = () => Capacitor.isNativePlatform();

  constructor(
    private exportService: ExportService,
    private settings: SettingsService,
    private reminder: BackupReminderService
  ) {}

  // Returns false when the user closed the share sheet without choosing anything.
  // remember=false is for safety copies (before an import, before signing out): they never touch the reminder.
  async exportJson(opts: { remember?: boolean } = {}): Promise<boolean> {
    const remember = opts.remember ?? true;
    const stamp = new Date().toISOString().slice(0, 10);
    try {
      await this.exportService.exportFile(`x-money-backup-${stamp}.json`, this.settings.exportData(), 'application/json');
    } catch (e) {
      if (/cancel/i.test(e instanceof Error ? e.message : String(e))) return false;
      throw e;
    }
    if (remember) {
      if (this.native()) this.awaitingConfirm.set(true);
      else this.markSaved(); // a browser download has no share sheet to doubt
    }
    return true;
  }

  // "Yes, I saved it"
  markSaved(): void {
    this.awaitingConfirm.set(false);
    this.reminder.markExported();
  }

  // "No": nothing is recorded and the reminder keeps nagging
  dismissConfirm(): void {
    this.awaitingConfirm.set(false);
  }
}
