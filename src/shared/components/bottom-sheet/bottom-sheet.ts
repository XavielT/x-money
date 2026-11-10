import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../pipes/translate.pipe';

// A sheet that slides up from the bottom with a title and a close button; the content is projected.
@Component({
  selector: 'app-bottom-sheet',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  template: `
    <div class="sheet-backdrop" *ngIf="open()" (click)="closed.emit()"></div>
    <section class="sheet" *ngIf="open()" role="dialog" aria-modal="true" [attr.aria-label]="title() | t">
      <header class="sheet-head">
        <h2>{{ title() | t }}</h2>
        <button class="sheet-close" (click)="closed.emit()" [attr.aria-label]="'Close' | t">✕</button>
      </header>
      <div class="sheet-body"><ng-content /></div>
    </section>
  `,
  styles: [
    `
      .sheet-backdrop { position: fixed; inset: 0; z-index: 40; background: rgba(0, 0, 0, 0.55); }
      .sheet {
        position: fixed; left: 0; right: 0; bottom: 0; z-index: 41; max-width: 480px; margin: 0 auto;
        max-height: 80vh; display: flex; flex-direction: column;
        background: var(--secondary); border-radius: 18px 18px 0 0; border: 1px solid var(--card-border);
        padding-bottom: env(safe-area-inset-bottom);
      }
      .sheet-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 8px 4px 16px; }
      .sheet-head h2 { font-family: var(--font-heading); font-size: 1rem; font-weight: 700; margin: 0; }
      .sheet-close { min-width: 44px; min-height: 44px; background: none; border: 0; color: var(--text); font-size: 1.1rem; }
      .sheet-body { overflow-y: auto; padding: 4px 16px 16px; }
    `,
  ],
})
export class BottomSheetComponent {
  open = input.required<boolean>();
  title = input.required<string>();
  closed = output<void>();
}
