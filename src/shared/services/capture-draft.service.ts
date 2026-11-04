import { Injectable, computed, signal } from '@angular/core';
import { CaptureDraft } from '../models/capture-draft.model';
import { daysBetween, localIso } from '../domain/dates';
import { StorageService } from './storage.service';

// Pending proposals older than this get a reminder; they are NEVER approved or deleted by themselves
export const STALE_DAYS = 7;

// The drafts of smart capture: the only thing a capture writes. A draft is a proposal; nothing becomes
// a movement until the user approves it (rule 11). Synced like any other collection: an approved draft
// on one device is not pending on the other. The files themselves never sync, only these fields.
@Injectable({ providedIn: 'root' })
export class CaptureDraftService {
  private _drafts = signal<CaptureDraft[]>([]);
  drafts = this._drafts.asReadonly();

  pending = computed(() => this._drafts().filter((d) => d.status === 'pending' || d.status === 'duplicate'));
  queued = computed(() => this._drafts().filter((d) => d.status === 'queued'));
  // what the navigation badge shows: waiting for the user's decision
  pendingCount = computed(() => this.pending().length);
  history = computed(() => this._drafts().filter((d) => d.status === 'approved' || d.status === 'rejected' || d.status === 'failed').sort((a, b) => b.createdAt.localeCompare(a.createdAt)));

  clock: () => Date = () => new Date();

  constructor(private storage: StorageService) {
    this._drafts.set(this.storage.get<CaptureDraft[]>('capture_drafts', []));
    this.storage.watch('capture_drafts', (v) => this._drafts.set((v as CaptureDraft[] | undefined) ?? []));
  }

  byId(id: string): CaptureDraft | undefined {
    return this._drafts().find((d) => d.id === id);
  }

  private commit(list: CaptureDraft[]): void {
    this._drafts.set(list);
    this.storage.set('capture_drafts', list);
  }

  add(draft: CaptureDraft): boolean {
    if (this.storage.readOnly()) return false;
    if (this.byId(draft.id)) return true; // idempotent
    this.commit([draft, ...this._drafts()]);
    return true;
  }

  // Only the 'queued' placeholder of a capture made offline can leave the list (it is replaced by the real drafts)
  drop(id: string): boolean {
    if (this.storage.readOnly() || this.byId(id)?.status !== 'queued') return false;
    this.commit(this._drafts().filter((d) => d.id !== id));
    return true;
  }

  update(id: string, patch: Partial<CaptureDraft>): CaptureDraft | undefined {
    if (this.storage.readOnly()) return undefined;
    const current = this.byId(id);
    if (!current) return undefined;
    const next = { ...current, ...patch, id: current.id };
    for (const k of Object.keys(next) as (keyof CaptureDraft)[]) if (next[k] === undefined) delete next[k];
    this.commit(this._drafts().map((d) => (d.id === id ? next : d)));
    return next;
  }

  // Pending drafts that have waited a week: a reminder, nothing else
  stale(): CaptureDraft[] {
    const today = localIso(this.clock());
    return this.pending().filter((d) => daysBetween(d.createdAt.slice(0, 10), today) >= STALE_DAYS);
  }

  hasMessage(messageId: string): boolean {
    return this._drafts().some((d) => d.messageId === messageId);
  }
}
