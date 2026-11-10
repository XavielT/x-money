import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChangeHistoryComponent } from '../../../../shared/components/change-history/change-history';
import { ConflictListComponent } from '../../../../shared/components/conflict-list/conflict-list';
import { SettingsHeaderComponent } from '../../../../shared/components/settings-header/settings-header';
import { SyncStatusComponent } from '../../../../shared/components/sync-status/sync-status';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
import { AuthService } from '../../../../shared/services/auth.service';
import { BackupService } from '../../../../shared/services/backup.service';
import { ExportService } from '../../../../shared/services/export.service';
import { SettingsService } from '../../../../shared/services/settings.service';
import { StorageService } from '../../../../shared/services/storage.service';
import { SyncService } from '../../../../shared/services/sync.service';
import { TranslateService } from '../../../../shared/services/translate.service';

// Settings > Your data: sync and backup status, CSV export, conflicts and the change history; import and the
// danger zone are at the bottom. Every control keeps the logic it had in the old long page.
@Component({
  selector: 'app-settings-data',
  standalone: true,
  imports: [CommonModule, TranslatePipe, SettingsHeaderComponent, SyncStatusComponent, ConflictListComponent, ChangeHistoryComponent],
  templateUrl: './data.html',
  styleUrl: '../settings.scss',
})
export class SettingsDataComponent {
  constructor(
    private exportService: ExportService,
    private settingsService: SettingsService,
    private translate: TranslateService,
    public auth: AuthService,
    private sync: SyncService,
    private storage: StorageService,
    private backup: BackupService
  ) {}

  async exportCsv(): Promise<void> {
    const stamp = new Date().toISOString().slice(0, 10);
    await this.exportService.exportFile(`x-money-transactions-${stamp}.csv`, this.exportService.buildCsv(), 'text/csv');
  }

  // Importing goes through the data layer, so it syncs like any edit: with an account it
  // replaces the data on every device. A backup of the current data is saved first.
  async onImportFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    const reject = (key: string, detail = '') => {
      alert(this.translate.instant(key) + detail);
      input.value = '';
    };

    // Validate the whole file first: a bad backup never touches the current data
    const preview = this.settingsService.previewImport(text);
    if (!preview.ok) {
      const e = preview.error;
      if (e.code === 'not-json') return reject('That file is not valid JSON.');
      if (e.code === 'not-xmoney') return reject('That file is not a valid X Money backup.');
      if (e.code === 'newer-version') return reject('That backup is from a newer version of X Money. Update the app first.');
      return reject('The backup has a problem and was not imported. Your data was not touched.', ` (${e.key}${e.index !== undefined ? ' #' + (e.index + 1) : ''}${e.field ? ': ' + e.field : ''})`);
    }

    const warning =
      this.auth.mode() === 'local'
        ? 'Import this backup? It replaces the data on this device. A backup of the current data is saved first.'
        : 'Import this backup? It replaces your data on ALL your devices. A backup of the current data is saved first.';
    const c = preview.counts;
    const counts = `${this.translate.instant('Backup contents:')} ${c.accounts} ${this.translate.instant('Accounts')} · ${c.transactions} ${this.translate.instant('Transactions')} · ${c.categories} ${this.translate.instant('Categories')} · ${c.budgets} ${this.translate.instant('Budgets')}`;
    if (!confirm(`${this.translate.instant(warning)}\n\n${counts}`)) {
      input.value = '';
      return;
    }
    try {
      await this.backup.exportJson({ remember: false }); // safety copy of what is there now
    } catch {
      if (!confirm(this.translate.instant('The safety backup could not be saved. Import anyway?'))) {
        input.value = '';
        return;
      }
    }
    const result = this.settingsService.importData(text);
    if (result.ok) {
      await this.storage.flush(); // make sure the copy is on disk before reloading
      alert(this.translate.instant('Backup restored.'));
      location.reload();
    } else {
      reject('The backup has a problem and was not imported. Your data was not touched.');
    }
  }

  // Local-only mode: wipes the data of this device. With an account the server copy must
  // never be deleted from here, so this only removes the copy on this device and signs out.
  async wipeData(): Promise<void> {
    if (this.auth.mode() === 'local') {
      if (!confirm(this.translate.instant('Delete ALL data? This cannot be undone.'))) return;
      this.settingsService.wipeData();
      await this.storage.flush();
      location.reload();
      return;
    }
    if (this.sync.pending() > 0) {
      alert(this.translate.instant('You have changes that are not synced yet. Sync or export a backup first.'));
      return;
    }
    if (!confirm(this.translate.instant('Remove the data from this device and sign out? Your data stays in your account.'))) return;
    await this.auth.logout({ eraseLocal: true });
  }
}
