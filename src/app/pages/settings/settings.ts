import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AccountService } from '../../../shared/services/account.service';
import { TransactionService } from '../../../shared/services/transaction.service';
import { SettingsService } from '../../../shared/services/settings.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class SettingsComponent {
  currencies = ['$', 'RD$', '€', '£', '¥'];
  accountIcons = ['💵', '💳', '🏦', '💰', '🪙', '📱'];

  // New account form
  newName = '';
  newIcon = '💵';
  newBalance: number | null = 0;

  constructor(
    public accountService: AccountService,
    public transactionService: TransactionService,
    public settingsService: SettingsService
  ) {}

  abs(value: number): number {
    return Math.abs(value);
  }

  setCurrency(symbol: string): void {
    this.settingsService.setCurrency(symbol);
  }

  addAccount(): void {
    const name = this.newName.trim();
    if (!name) return;
    this.accountService.add(name, this.newIcon, Number(this.newBalance) || 0);
    this.newName = '';
    this.newBalance = 0;
  }

  removeAccount(id: string): void {
    if (this.accountService.accounts().length <= 1) {
      alert('You need at least one account.');
      return;
    }
    if (!confirm('Remove this account? Its transactions will keep showing as "Unknown" account.')) return;
    this.accountService.remove(id);
  }

  exportData(): void {
    const json = this.settingsService.exportData();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `x-money-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  onImportFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      if (this.settingsService.importData(text)) {
        alert('Backup restored.');
        location.reload();
      } else {
        alert('That file is not a valid X Money backup.');
        input.value = '';
      }
    });
  }

  wipeData(): void {
    if (!confirm('Delete ALL data? This cannot be undone.')) return;
    this.settingsService.wipeData();
    location.reload();
  }
}
