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

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe],
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
    public translate: TranslateService
  ) {}

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
  }

  async exportCsv(): Promise<void> {
    const stamp = new Date().toISOString().slice(0, 10);
    await this.exportService.exportFile(
      `x-money-transactions-${stamp}.csv`,
      this.exportService.buildCsv(),
      'text/csv'
    );
  }

  onImportFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      if (this.settingsService.importData(text)) {
        alert(this.translate.instant('Backup restored.'));
        location.reload();
      } else {
        alert(this.translate.instant('That file is not a valid X Money backup.'));
        input.value = '';
      }
    });
  }

  wipeData(): void {
    if (!confirm(this.translate.instant('Delete ALL data? This cannot be undone.'))) return;
    this.settingsService.wipeData();
    location.reload();
  }
}
