import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { SyncService } from '../../services/sync.service';

// First sync of this device with the account (docs/ARQUITECTURA.md). Nothing is changed
// until the user chooses, and a JSON backup is always made first.
@Component({
  selector: 'app-link-wizard',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './link-wizard.html',
  styleUrl: '../auth-gate/auth-gate.scss',
})
export class LinkWizardComponent {
  rows = [
    { key: 'accounts', label: 'Accounts' },
    { key: 'transactions', label: 'Transactions' },
    { key: 'categories', label: 'Categories' },
    { key: 'budgets', label: 'Budgets' },
    { key: 'recurring', label: 'Recurring' },
  ];

  constructor(public sync: SyncService) {}

  get percent(): number {
    const { total, remaining } = this.sync.link();
    return total ? Math.round(((total - (remaining ?? 0)) / total) * 100) : 0;
  }
}
