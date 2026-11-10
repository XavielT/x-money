import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { UndoToastService } from '../../services/undo-toast.service';

// The toast of UndoToastService, above the bottom navigation and the safe area.
@Component({
  selector: 'app-undo-toast',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  template: `
    <div class="toast" *ngIf="toasts.current() as t" role="status" aria-live="polite">
      <span class="toast-text">{{ t.message }}</span>
      <button class="toast-undo" *ngIf="t.undo" (click)="toasts.undo()">{{ 'Undo' | t }}</button>
    </div>
  `,
  styles: [
    `
      .toast {
        position: fixed; left: 50%; transform: translateX(-50%); z-index: 30;
        bottom: calc(84px + env(safe-area-inset-bottom));
        width: calc(100% - 32px); max-width: 448px;
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        padding: 6px 8px 6px 16px; border-radius: 12px;
        background: var(--card-bg); color: var(--text); border: 1px solid var(--card-border);
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
      }
      .toast-text { flex: 1; min-width: 0; font-size: 0.9rem; }
      .toast-undo {
        min-height: 44px; min-width: 64px; padding: 0 14px; font-weight: 700;
        background: none; border: 0; color: var(--Hub); font-size: 0.95rem;
      }
    `,
  ],
})
export class UndoToastComponent {
  constructor(public toasts: UndoToastService) {}
}
