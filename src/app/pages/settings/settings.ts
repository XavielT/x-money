import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TransactionType } from '../../../shared/models/transaction.model';
import { RecurringFrequency, RecurringModel } from '../../../shared/models/recurring.model';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { AccountService } from '../../../shared/services/account.service';
import { TransactionService } from '../../../shared/services/transaction.service';
import { SettingsService } from '../../../shared/services/settings.service';
import { CategoryService } from '../../../shared/services/category.service';
import { RecurringService } from '../../../shared/services/recurring.service';
import { ExportService } from '../../../shared/services/export.service';
import { LockService } from '../../../shared/services/lock.service';
import { AppLanguage, TranslateService } from '../../../shared/services/translate.service';
import { AuthService } from '../../../shared/services/auth.service';
import { SyncService } from '../../../shared/services/sync.service';
import { StorageService } from '../../../shared/services/storage.service';
import { BackupReminderService } from '../../../shared/services/backup-reminder.service';
import { CardNoticeService } from '../../../shared/services/card-notice.service';
import { AccountSettingsComponent } from '../../../shared/components/account-settings/account-settings';
import { ChangeHistoryComponent } from '../../../shared/components/change-history/change-history';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe, AccountSettingsComponent, ChangeHistoryComponent],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class SettingsComponent {
  currencies = ['$', 'RD$', '€', '£', '¥'];

  // Category management
  catType: TransactionType = 'expense';

  // Recurring rule editing
  editingRuleId: string | null = null;
  editAmount: number | null = null;
  editFrequency: RecurringFrequency = 'monthly';

  // App lock
  lockPin = '';
  unlockPin = '';

  constructor(
    private exportService: ExportService,
    public accountService: AccountService,
    public transactionService: TransactionService,
    public settingsService: SettingsService,
    public categoryService: CategoryService,
    public recurringService: RecurringService,
    public lock: LockService,
    public translate: TranslateService,
    public auth: AuthService,
    private sync: SyncService,
    private storage: StorageService,
    private reminder: BackupReminderService,
    public cardNotices: CardNoticeService
  ) {}

  // Device reminders for card cut and due dates. The system permission is asked only here.
  async toggleCardAlerts(event: Event): Promise<void> {
    const on = (event.target as HTMLInputElement).checked;
    if (on) {
      const granted = await this.cardNotices.enable();
      if (!granted) (event.target as HTMLInputElement).checked = false;
    } else {
      await this.cardNotices.disable();
    }
  }

  abs(value: number): number {
    return Math.abs(value);
  }

  setCurrency(symbol: string): void {
    this.settingsService.setCurrency(symbol);
  }

  setTaxPercent(value: number | string): void {
    const percent = Number(value);
    if (isFinite(percent)) this.settingsService.setTaxPercent(percent);
  }

  setLanguage(lang: AppLanguage): void {
    if (this.translate.lang() === lang) return;
    this.translate.setLanguage(lang);
    location.reload(); // re-render everything in the new language
  }

  frequencyLabel(frequency: string): string {
    const labels: Record<string, string> = {
      daily: 'Daily',
      weekly: 'Weekly',
      monthly: 'Monthly',
      yearly: 'Yearly',
    };
    return this.translate.instant(labels[frequency] ?? frequency);
  }

  startEditRecurring(rule: RecurringModel): void {
    this.editingRuleId = rule.id;
    this.editAmount = rule.amount;
    this.editFrequency = rule.frequency;
  }

  saveEditRecurring(): void {
    if (!this.editingRuleId || this.editAmount == null || this.editAmount <= 0) return;
    this.recurringService.update(this.editingRuleId, Number(this.editAmount), this.editFrequency);
    this.editingRuleId = null;
  }

  removeRecurring(id: string): void {
    if (!confirm(this.translate.instant('Delete this recurring transaction? Already posted movements stay.'))) return;
    this.recurringService.remove(id);
  }

  removeCategory(id: string): void {
    if (!confirm(this.translate.instant('Delete this category? Its transactions will show as "Unknown".'))) return;
    this.categoryService.remove(id);
  }

  async enableLock(): Promise<void> {
    const pin = this.lockPin.trim();
    if (!/^\d{4,8}$/.test(pin)) return;
    await this.lock.enable(pin);
    this.lockPin = '';
  }

  async disableLock(): Promise<void> {
    if (!(await this.lock.verify(this.unlockPin.trim()))) {
      alert(this.translate.instant('Wrong PIN'));
      return;
    }
    this.lock.disable();
    this.unlockPin = '';
  }

  async exportData(): Promise<void> {
    const stamp = new Date().toISOString().slice(0, 10);
    await this.exportService.exportFile(
      `x-money-backup-${stamp}.json`,
      this.settingsService.exportData(),
      'application/json'
    );
    this.reminder.markExported();
  }

  async exportCsv(): Promise<void> {
    const stamp = new Date().toISOString().slice(0, 10);
    await this.exportService.exportFile(
      `x-money-transactions-${stamp}.csv`,
      this.exportService.buildCsv(),
      'text/csv'
    );
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
      await this.exportData(); // safety copy of what is there now
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
