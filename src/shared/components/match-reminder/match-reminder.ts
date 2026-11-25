import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { MatchReminderService } from '../../services/match-reminder.service';

// "Match {account} with your bank": only on Home, one account at a time (the one waiting longest). "Later" quiets it for 7 days.
@Component({
  selector: 'app-match-reminder',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe],
  template: `
    <div class="mr x-card" *ngIf="reminder.due()[0] as first" role="status">
      <span class="mr-text">
        {{ 'Time to match this account with your bank:' | t }} <b>{{ first.account.name }}</b>
        <span *ngIf="first.days !== null"> · {{ first.days }} {{ 'days since the last match' | t }}</span>
        <span *ngIf="first.days === null"> · {{ 'never matched' | t }}</span>
      </span>
      <a class="mr-now" [routerLink]="['/reconcile', first.account.id]">{{ 'Match with the bank' | t }}</a>
      <button class="mr-later" (click)="reminder.snooze()">{{ 'Later' | t }}</button>
    </div>
  `,
  styles: `
    .mr { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 12px; min-height: 44px; padding: 6px 14px; margin-bottom: 12px; font-size: 0.85rem; }
    .mr-text { flex: 1 1 100%; min-width: 0; }
    .mr-now, .mr-later { display: inline-flex; align-items: center; min-height: 44px; padding: 0 4px; background: none; border: none; font-weight: 600; }
    .mr-now { color: var(--Hub); }
    .mr-later { margin-left: auto; color: var(--main-ultra-light); }
  `,
})
export class MatchReminderComponent implements OnInit {
  constructor(public reminder: MatchReminderService) {}
  ngOnInit(): void {
    this.reminder.refreshClock();
  }
}
