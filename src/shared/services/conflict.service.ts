import { Injectable, signal } from '@angular/core';
import { SYNCED_COLLECTIONS, toClientKey } from '../data-layer/registry';
import { StorageService } from './storage.service';

// A version that lost an edit conflict. The server writes these; nothing is ever
// discarded silently (docs/ARQUITECTURA.md, conflicts).
export interface ConflictModel {
  id: string;
  collection: string;
  recordId: string;
  deleted: boolean; // the losing change was a delete
  data: Record<string, unknown> | null;
  deviceId: string;
  clientUpdatedAt: number;
  detectedAt: number;
}

@Injectable({ providedIn: 'root' })
export class ConflictService {
  private _conflicts = signal<ConflictModel[]>([]);
  conflicts = this._conflicts.asReadonly();

  constructor(private storage: StorageService) {
    this._conflicts.set(this.read(this.storage.get<ConflictModel[]>('conflicts', [])));
    this.storage.watch('conflicts', (v) => this._conflicts.set(this.read(v as ConflictModel[] | undefined)));
  }

  private read(list: ConflictModel[] | undefined): ConflictModel[] {
    return [...(list ?? [])].sort((a, b) => b.detectedAt - a.detectedAt);
  }

  // Puts the saved version back (as a normal edit, so it syncs) and clears the entry
  restore(conflict: ConflictModel): void {
    if (!conflict.deleted && conflict.data) {
      const key = toClientKey(conflict.collection); // the server names the collection in snake_case
      const kind = SYNCED_COLLECTIONS[key];
      if (kind === 'entities') {
        const list = this.storage.get<Record<string, unknown>[]>(key, []);
        const at = list.findIndex((item) => item['id'] === conflict.recordId);
        if (at >= 0) list[at] = conflict.data;
        else list.push(conflict.data);
        this.storage.set(key, list);
        this.storage.refresh(key);
      } else if (kind === 'doc') {
        this.storage.set(key, (conflict.data as { value: unknown }).value);
        this.storage.refresh(key);
      }
    }
    this.dismiss(conflict.id);
  }

  dismiss(id: string): void {
    this.storage.set(
      'conflicts',
      this.storage.get<ConflictModel[]>('conflicts', []).filter((c) => c.id !== id)
    );
    this._conflicts.set(this.read(this.storage.get<ConflictModel[]>('conflicts', [])));
  }
}
