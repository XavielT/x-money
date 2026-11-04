import { Injectable, signal } from '@angular/core';
import { CLIENT_SCHEMA_VERSION, SYNCED_COLLECTIONS } from '../data-layer/registry';
import { MIGRATIONS, Migration, migrateRecord, migrateSnapshot } from '../data-layer/migrations';
import { AuditLogService } from './audit-log.service';
import { StorageService } from './storage.service';

interface Snapshot {
  at: string;
  fromVersion: number;
  json: string; // the complete local data before migrating
}

interface QueuedOp {
  collection: string;
  data: Record<string, unknown> | null;
  schemaVersion: number;
}

export const SNAPSHOTS_KEPT = 2;

// Runs BEFORE any service reads data (app initializer). Order: snapshot, migrate in memory,
// only then write; if anything throws the old data is restored and nothing is ever uploaded.
// The migrated records are queued for upload afterwards (SyncService) and the server schema
// version is raised only once that upload is done.
@Injectable({ providedIn: 'root' })
export class MigrationService {
  // Shown as a discreet notice when a migration failed and the old data was kept
  failure = signal<string | null>(null);

  constructor(
    private storage: StorageService,
    private audit: AuditLogService
  ) {}

  async run(migrations: readonly Migration[] = MIGRATIONS, target = CLIENT_SCHEMA_VERSION): Promise<void> {
    const db = this.storage.localDb;
    const stored = await db.get<number>('device', 'schemaVersion');
    if (stored === undefined && !this.storage.hasSyncedData()) {
      await db.put('device', 'schemaVersion', target); // fresh install: born current
      return;
    }
    const from = stored ?? 1; // 2.5.x and 2.6.x installs never stored a version
    if (from >= target) return;

    const before = this.storage.snapshotAll();
    const queue = (await db.get<QueuedOp[]>('device', 'queue')) ?? [];
    try {
      await this.saveSnapshot({ at: new Date().toISOString(), fromVersion: from, json: JSON.stringify(before) });

      const migrated = migrateSnapshot(before, from, target, migrations);
      const migratedQueue = queue.map((op) =>
        op.schemaVersion < target && op.data && SYNCED_COLLECTIONS[op.collection] === 'entities'
          ? { ...op, data: migrateRecord(op.collection, op.data, op.schemaVersion, target, migrations) as Record<string, unknown>, schemaVersion: target }
          : op
      );

      try {
        this.storage.writeLocal(migrated);
        await this.storage.flush();
        await db.put('device', 'queue', migratedQueue);
        await db.put('device', 'schemaVersion', target);
        await db.put('device', 'uploadAfterMigration', true);
      } catch (error) {
        this.storage.writeLocal(before); // put back exactly what was there
        await this.storage.flush();
        throw error;
      }
      this.audit.log({
        type: 'migration',
        entity: 'schema',
        entityId: 'schema',
        before: { version: from },
        after: { version: target },
        origin: 'migration',
      });
    } catch (error) {
      console.error('x-money: data migration failed, keeping the old data and not syncing', error);
      this.storage.syncBlocked.set(true);
      this.failure.set(String((error as Error)?.message ?? error));
    }
  }

  async snapshots(): Promise<Snapshot[]> {
    return (await this.storage.localDb.get<Snapshot[]>('device', 'snapshots')) ?? [];
  }

  // The two most recent snapshots are kept
  private async saveSnapshot(snapshot: Snapshot): Promise<void> {
    const list = [...(await this.snapshots()), snapshot].slice(-SNAPSHOTS_KEPT);
    await this.storage.localDb.put('device', 'snapshots', list);
  }
}
