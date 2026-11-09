import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SETTINGS_LINKS } from '../../config/settings-links';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { BackupReminderService } from '../../services/backup-reminder.service';
import { TransactionService } from '../../services/transaction.service';

// "Time to back up": only on Home. "Later" quiets it for 7 days (kept on the device, survives a restart).
@Component({
  selector: 'app-backup-reminder',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe],
  template: `
    <div class="bk x-card" *ngIf="reminder.due() && transactions.transactions().length" role="status">
      <span class="bk-text">{{ 'Time to back up your data' | t }}</span>
      <a class="bk-now" [routerLink]="links.data.commands" [fragment]="links.data.fragment">{{ 'Back up now' | t }}</a>
      <button class="bk-later" (click)="reminder.snooze()">{{ 'Later' | t }}</button>
    </div>
  `,
  styles: `
    .bk {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 4px 12px;
      min-height: 44px;
      padding: 6px 14px;
      margin-bottom: 12px;
      font-size: 0.85rem;
    }
    .bk-text {
      flex: 1 1 100%;
      min-width: 0;
    }
    .bk-now,
    .bk-later {
      display: inline-flex;
      align-items: center;
      min-height: 44px;
      padding: 0 4px;
      background: none;
      border: none;
      font-weight: 600;
    }
    .bk-now {
      color: var(--Hub);
    }
    .bk-later {
      margin-left: auto;
      color: var(--main-ultra-light);
    }
  `,
})
export class BackupReminderComponent implements OnInit {
  readonly links = SETTINGS_LINKS;

  constructor(
    public reminder: BackupReminderService,
    public transactions: TransactionService
  ) {}

  ngOnInit(): void {
    this.reminder.refreshClock();
  }
}
