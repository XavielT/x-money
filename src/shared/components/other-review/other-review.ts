import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OtherGroup, OTHER_EXPENSE_ID } from '../../domain/other-review';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { CategoryService } from '../../services/category.service';
import { OtherReviewService } from '../../services/other-review.service';
import { TranslateService } from '../../services/translate.service';

const SHOWN = 6;

// Settings > Categories: what was filed under "Other", by place. Pick the category (the one the app proposes is already chosen)
// and tap Move: all the movements of that place move, and the next ones are filed by themselves.
@Component({
  selector: 'app-other-review',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  template: `
    <section class="x-card other" *ngIf="review.groups().length || notice()">
      <h2>📦 {{ 'Filed under Other' | t }}</h2>
      <p class="note" *ngIf="review.groups().length">{{ 'Put each place where it belongs in one tap. The next ones are filed by themselves.' | t }}</p>
      <p class="done" *ngIf="notice()">✅ {{ notice() }}</p>
      <div class="row" *ngFor="let g of visible(); trackBy: trackKey">
        <div class="who">
          <b>{{ g.label }}</b>
          <small>{{ g.count }} · {{ symbol(g) }}{{ g.total | number: '1.2-2' }}</small>
        </div>
        <select class="x-input" [ngModel]="choice(g)" (ngModelChange)="choose(g, $event)" [name]="'other-' + g.key">
          <option value="">{{ 'Choose' | t }}</option>
          <option *ngFor="let c of options()" [value]="c.id">{{ c.icon }} {{ c.name | t }}</option>
        </select>
        <button class="x-btn" [disabled]="!choice(g)" (click)="move(g)">{{ 'Move' | t }}</button>
      </div>
      <button class="x-btn more" *ngIf="review.groups().length > shown()" (click)="shown.set(999)">{{ 'Show all' | t }} ({{ review.groups().length }})</button>
    </section>
  `,
  styles: [
    `
      .other { margin-bottom: 16px; display: grid; gap: 10px; }
      h2 { margin: 0; font-size: 1.05rem; }
      .note, .done { margin: 0; color: var(--text-muted, #aaa); font-size: 0.85rem; }
      .done { color: var(--income); }
      .row { display: grid; grid-template-columns: 1fr; gap: 6px; padding: 10px 0; border-top: 1px solid var(--border, #2a2a2a); }
      .who { display: flex; flex-direction: column; gap: 2px; }
      .who small { color: var(--text-muted, #aaa); }
    `,
  ],
})
export class OtherReviewComponent {
  shown = signal(SHOWN);
  notice = signal('');
  private chosen = signal<Record<string, string>>({});

  visible = computed(() => this.review.groups().slice(0, this.shown()));
  options = computed(() => this.categories.expenseCategories().filter((c) => c.id !== OTHER_EXPENSE_ID));

  constructor(
    public review: OtherReviewService,
    private categories: CategoryService,
    private translate: TranslateService
  ) {}

  trackKey(_: number, g: OtherGroup): string {
    return g.key;
  }

  symbol(g: OtherGroup): string {
    return g.currency === 'USD' ? 'US$' : 'RD$';
  }

  // what the user picked, else what the built-in knowledge proposes
  choice(g: OtherGroup): string {
    return this.chosen()[g.key] ?? g.suggestion ?? '';
  }

  choose(g: OtherGroup, id: string): void {
    this.chosen.update((m) => ({ ...m, [g.key]: id }));
  }

  move(g: OtherGroup): void {
    const id = this.choice(g);
    if (!id) return;
    const r = this.review.apply(g, id);
    const name = this.categories.byId(id)?.name ?? '';
    this.notice.set(`${this.translate.instant('{n} moved to')} ${this.translate.instant(name)}.`.replace('{n}', String(r.changed)));
  }
}
