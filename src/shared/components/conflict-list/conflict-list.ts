import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { AuthService } from '../../services/auth.service';
import { ConflictModel, ConflictService } from '../../services/conflict.service';
import { TranslateService } from '../../services/translate.service';

// Versions that lost a sync conflict: the newer edit won and the other one is kept here, never deleted silently.
@Component({
  selector: 'app-conflict-list',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  template: `
    <section class="acct" *ngIf="auth.mode() !== 'local'">
      <h2>{{ 'Conflicting versions' | t }}</h2>
      <p class="acct-hint">{{ 'When the same record is edited on two devices, the newer edit wins and the other version is kept here. Nothing is deleted silently.' | t }}</p>
      <p class="acct-hint" *ngIf="!conflictService.conflicts().length">{{ 'No conflicts.' | t }}</p>
      <div class="acct-card x-card" *ngFor="let c of conflictService.conflicts()">
        <div class="acct-conflict">
          <strong>{{ describe(c) }}</strong>
          <small>{{ when(c.detectedAt) }}<ng-container *ngIf="c.deleted"> · {{ 'a delete that lost to a newer edit' | t }}</ng-container></small>
        </div>
        <div class="acct-actions">
          <button class="acct-small" *ngIf="!c.deleted" (click)="conflictService.restore(c)">{{ 'Restore this version' | t }}</button>
          <button class="acct-small" (click)="conflictService.dismiss(c.id)">{{ 'Dismiss' | t }}</button>
        </div>
      </div>
    </section>
  `,
  styleUrl: '../account-settings/account-settings.scss',
})
export class ConflictListComponent {
  constructor(
    public auth: AuthService,
    public conflictService: ConflictService,
    private translate: TranslateService
  ) {}

  describe(c: ConflictModel): string {
    const d = (c.data ?? {}) as Record<string, unknown>;
    const parts = [d['name'], d['amount'], d['date'], d['note']].filter((v) => v !== undefined && v !== '').join(' · ');
    return `${c.collection} · ${parts || c.recordId}`;
  }

  when(ms: number): string {
    return new Date(ms).toLocaleString(this.translate.locale());
  }
}
