import { Injectable, signal } from '@angular/core';
import { TransactionModel } from '../models/transaction.model';
import { StorageService } from './storage.service';

export type AuditType =
  | 'create'
  | 'edit'
  | 'reverse'
  | 'delete'
  | 'convert-transfer'
  | 'undo-convert'
  | 'balance-adjustment'
  | 'reconcile'
  | 'import'
  | 'migration'
  | 'account-archive'
  | 'account-unarchive'
  | 'recurring-post'
  | 'income-pattern'
  | 'audit-trim'
  | 'card-config'
  | 'statement-bank-figures'
  | 'statement-interest'
  | 'card-payment-convert'
  | 'income-source'
  | 'income-received'
  | 'income-classify'
  | 'benefit'
  | 'category'
  | 'budget-move'
  | 'budget-move-undo'
  | 'bucket'
  | 'business-operation'
  | 'business-sale'
  | 'business-withdrawal'
  | 'goal'
  | 'goal-entry'
  | 'loan'
  | 'loan-payment';

export type AuditEntity = 'transaction' | 'account' | 'backup' | 'schema' | 'audit' | 'statement' | 'income-source' | 'benefit' | 'category' | 'budget' | 'business' | 'goal' | 'loan';

export interface AuditEvent {
  id: string;
  at: string; // ISO timestamp
  type: AuditType;
  entity: AuditEntity;
  entityId: string;
  accountId?: string;
  before?: unknown; // summarized
  after?: unknown;
  origin: string; // what triggered it: manual, recurring, import, reconciliation...
  deviceId: string;
}

export const AUDIT_LIMIT = 2000;

// The few fields that identify a movement, enough to understand a change without storing
// the whole record twice
export function summarizeTransaction(t: TransactionModel): Record<string, unknown> {
  const out: Record<string, unknown> = { type: t.type, amount: t.amount, accountId: t.accountId, date: t.date };
  if (t.toAccountId) out['toAccountId'] = t.toAccountId;
  if (t.categoryId) out['categoryId'] = t.categoryId;
  if (t.currency) out['currency'] = t.currency;
  if (t.fee) out['fee'] = t.fee;
  if (t.note) out['note'] = t.note;
  if (t.origin) out['origin'] = t.origin;
  return out;
}

// Append-only, capped history. It is a synced collection; every event names the device
// that produced it. Nothing here ever edits an existing event.
@Injectable({ providedIn: 'root' })
export class AuditLogService {
  private _events = signal<AuditEvent[]>([]);
  events = this._events.asReadonly();

  // Set once the device id is known (see AuthService.init)
  deviceId = 'unknown';
  now: () => Date = () => new Date();

  constructor(private storage: StorageService) {
    this._events.set(this.storage.get<AuditEvent[]>('audit', []));
    this.storage.watch('audit', (v) => this._events.set((v as AuditEvent[] | undefined) ?? []));
  }

  byId(id: string): AuditEvent | undefined {
    return this._events().find((e) => e.id === id);
  }

  log(event: Omit<AuditEvent, 'id' | 'at' | 'deviceId' | 'origin'> & { origin?: string }): AuditEvent {
    const full: AuditEvent = {
      ...event,
      id: crypto.randomUUID(),
      at: this.now().toISOString(),
      origin: event.origin ?? 'manual',
      deviceId: this.deviceId,
    };
    let list = [...this._events(), full];
    if (list.length > AUDIT_LIMIT) {
      // keep the newest events and say so: the history never shrinks silently
      const removed = list.length - AUDIT_LIMIT + 1;
      list = [
        ...list.slice(removed),
        { id: crypto.randomUUID(), at: full.at, type: 'audit-trim', entity: 'audit', entityId: 'audit', after: { removed }, origin: 'system', deviceId: this.deviceId },
      ];
    }
    this._events.set(list);
    this.storage.set('audit', list);
    return full;
  }
}
