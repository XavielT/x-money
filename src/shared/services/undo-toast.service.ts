import { Injectable, signal } from '@angular/core';

export interface UndoToast {
  id: number;
  message: string;
  undo?: () => void;
}

// One short confirmation at the bottom of the app, with an optional "Undo" for a few seconds.
@Injectable({ providedIn: 'root' })
export class UndoToastService {
  private _current = signal<UndoToast | null>(null);
  current = this._current.asReadonly();
  durationMs = 6000;
  private nextId = 1;
  private timer: ReturnType<typeof setTimeout> | null = null;

  show(message: string, undo?: () => void): void {
    this.clear();
    const toast = { id: this.nextId++, message, undo };
    this._current.set(toast);
    this.timer = setTimeout(() => {
      if (this._current()?.id === toast.id) this._current.set(null);
    }, this.durationMs);
  }

  // "Undo": runs the action once and closes the toast
  undo(): void {
    const toast = this._current();
    this.clear();
    toast?.undo?.();
  }

  dismiss(): void {
    this.clear();
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this._current.set(null);
  }
}
