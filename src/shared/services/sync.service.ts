import { Injectable, signal } from '@angular/core';
import { ApiService } from './api.service';
import { BackupReminderService } from './backup-reminder.service';
import { ExportService } from './export.service';
import { SettingsService } from './settings.service';
import { StorageService } from './storage.service';
import { CLIENT_SCHEMA_VERSION } from '../data-layer/registry';
import { Counts, countLocal, countServer, countsMatch, decideLink } from '../data-layer/link';
import { SyncEngine, SyncError } from '../data-layer/sync-engine';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error' | 'auth' | 'readonly';

export type LinkPhase =
  | 'none'
  | 'checking' // asking the server what it holds
  | 'confirm-upload' // local data, empty server: waiting for "Upload my data"
  | 'choose' // data on both sides: waiting for the user's choice
  | 'backup-failed'
  | 'uploading'
  | 'downloading'
  | 'verify-failed'
  | 'error';

export interface LinkState {
  phase: LinkPhase;
  local?: Counts;
  server?: Counts;
  remaining?: number;
  total?: number;
  error?: string;
}

const INTERVAL_MS = 5 * 60 * 1000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;
const SKEW_WARNING_MS = 5 * 60 * 1000;

// Runs the sync engine for the signed-in account: first-time linking of the device,
// then push/pull on open, on foreground, on reconnect, after local changes and every
// 5 minutes while visible. No background sync (Safari has none).
@Injectable({ providedIn: 'root' })
export class SyncService {
  status = signal<SyncStatus>('idle');
  pending = signal(0);
  lastSyncAt = signal<number | null>(null);
  lastError = signal<string | null>(null);
  clockSkewMs = signal(0);
  link = signal<LinkState>({ phase: 'none' });

  private engine: SyncEngine | null = null;
  private accountId = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private retryAfterBackup: (() => Promise<void>) | null = null;
  private listeners: (() => void)[] = [];

  constructor(
    private api: ApiService,
    private storage: StorageService,
    private exporter: ExportService,
    private settings: SettingsService,
    private reminder: BackupReminderService
  ) {}

  get skewWarning(): boolean {
    return Math.abs(this.clockSkewMs()) > SKEW_WARNING_MS;
  }

  async start(accountId: string): Promise<void> {
    this.stop();
    if (this.storage.syncBlocked()) {
      // a data migration failed: the old data is intact and nothing may be uploaded
      this.lastError.set('migration_failed');
      this.status.set('error');
      return;
    }
    this.accountId = accountId;
    const engine = new SyncEngine(this.storage.localDb, this.api.transport, this.storage, () => Date.now() + this.api.client.skewMs);
    this.engine = engine;
    await engine.load();
    this.pending.set(engine.pending);
    engine.onEnqueue = () => {
      this.pending.set(engine.pending);
      this.scheduleSoon();
    };

    const linked = await this.storage.localDb.get<string>('device', 'linkedAccountId');
    if (linked === accountId) {
      this.activate();
      await this.queueMigratedRecords();
      await this.finishInterruptedUpload();
      await this.syncNow();
    } else {
      await this.beginLink();
    }
  }

  stop(): void {
    this.listeners.forEach((off) => off());
    this.listeners = [];
    if (this.timer) clearInterval(this.timer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.debounce) clearTimeout(this.debounce);
    this.timer = this.retryTimer = this.debounce = null;
    this.storage.setChangeSink(null);
    this.engine = null;
    this.status.set('idle');
    this.link.set({ phase: 'none' });
  }

  // From here local writes are queued for the server and triggers are armed
  private activate(): void {
    const engine = this.engine!;
    this.storage.setChangeSink((key, prev, next) => engine.recordChange(key, prev, next));
    this.timer = setInterval(() => {
      if (document.visibilityState === 'visible') void this.syncNow();
    }, INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void this.syncNow();
    };
    const onOnline = () => void this.syncNow();
    const onOffline = () => this.status.set('offline');
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    this.listeners.push(
      () => document.removeEventListener('visibilitychange', onVisible),
      () => window.removeEventListener('online', onOnline),
      () => window.removeEventListener('offline', onOffline)
    );
  }

  private scheduleSoon(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.syncNow(), 1500);
  }

  private scheduleRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const delay = Math.min(MAX_BACKOFF_MS, 5000 * 2 ** this.attempts);
    this.attempts++;
    this.retryTimer = setTimeout(() => void this.syncNow(), delay);
  }

  async syncNow(): Promise<void> {
    const engine = this.engine;
    if (!engine || this.status() === 'readonly' || this.link().phase !== 'none') return;
    if (this.status() === 'syncing') return;
    this.status.set('syncing');
    try {
      const meta = await this.api.transport.meta();
      this.clockSkewMs.set(this.api.client.skewMs);
      if (meta.schemaVersion > CLIENT_SCHEMA_VERSION) {
        this.storage.readOnly.set(true);
        this.status.set('readonly');
        return;
      }
      await engine.sync();
      await this.raiseServerSchema(engine);
      this.lastSyncAt.set(Date.now());
      this.lastError.set(null);
      this.attempts = 0;
      this.status.set('idle');
    } catch (error) {
      this.handleError(error);
    } finally {
      this.pending.set(engine.pending);
    }
  }

  // After a data migration every record is queued once (unchanged ones are no-ops on the
  // server); only when that upload is finished the server schema version is raised
  private async queueMigratedRecords(): Promise<void> {
    const db = this.storage.localDb;
    if (!(await db.get<boolean>('device', 'uploadAfterMigration'))) return;
    this.engine!.enqueueSnapshot(this.storage.snapshotSynced(), Date.now());
    await db.delete('device', 'uploadAfterMigration');
    await db.put('device', 'raiseServerSchema', CLIENT_SCHEMA_VERSION);
    this.pending.set(this.engine!.pending);
  }

  private async raiseServerSchema(engine: SyncEngine): Promise<void> {
    const db = this.storage.localDb;
    const wanted = await db.get<number>('device', 'raiseServerSchema');
    if (wanted === undefined || engine.pending > 0) return;
    await this.api.transport.raiseSchema(wanted);
    await db.delete('device', 'raiseServerSchema');
  }

  private handleError(error: unknown): void {
    const kind = error instanceof SyncError ? error.kind : 'server';
    if (kind === 'network') {
      this.status.set('offline');
      this.scheduleRetry();
    } else if (kind === 'auth') {
      this.status.set('auth');
      this.api.client.onSessionLost?.(); // sign in again; the local copy and outbox stay
    } else if (kind === 'outdated') {
      this.storage.readOnly.set(true);
      this.status.set('readonly');
    } else if (kind === 'forbidden') {
      this.lastError.set('account_disabled'); // never retried in a loop
      this.status.set('error');
    } else {
      this.lastError.set(error instanceof Error ? error.message : 'error');
      this.status.set('error');
      this.scheduleRetry();
    }
  }

  // ---------------------------------------------------------------- first sync

  private async beginLink(): Promise<void> {
    this.link.set({ phase: 'checking' });
    try {
      const meta = await this.api.transport.meta();
      this.clockSkewMs.set(this.api.client.skewMs);
      if (meta.schemaVersion > CLIENT_SCHEMA_VERSION) {
        this.storage.readOnly.set(true);
        this.status.set('readonly');
        this.link.set({ phase: 'none' });
        return;
      }
      const snapshot = this.storage.snapshotSynced();
      const local = countLocal(snapshot);
      const server = countServer(meta.counts);
      switch (decideLink(snapshot, meta.counts)) {
        case 'link-empty':
          await this.markLinked();
          this.engine!.enqueueSnapshot(snapshot, 0);
          this.link.set({ phase: 'none' });
          await this.syncNow();
          break;
        case 'download':
          await this.takeServerCopy();
          break;
        case 'upload':
          this.link.set({ phase: 'confirm-upload', local, server });
          break;
        case 'choose':
          this.link.set({ phase: 'choose', local, server });
          break;
      }
    } catch (error) {
      this.link.set({ phase: 'error', error: error instanceof SyncError ? error.kind : 'error' });
    }
  }

  retryLink(): Promise<void> {
    return this.beginLink();
  }

  // Automatic JSON backup before anything touches the data. If it cannot be produced the
  // user decides: try again, or continue without it.
  private async backupFirst(next: () => Promise<void>): Promise<void> {
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      await this.exporter.exportFile(`x-money-backup-before-sync-${stamp}.json`, this.settings.exportData(), 'application/json');
      this.reminder.markExported();
    } catch {
      this.retryAfterBackup = next;
      this.link.update((l) => ({ ...l, phase: 'backup-failed' }));
      return;
    }
    await next();
  }

  async continueAfterBackupFailure(skipBackup: boolean): Promise<void> {
    const next = this.retryAfterBackup;
    this.retryAfterBackup = null;
    if (!next) return;
    if (skipBackup) await next();
    else await this.backupFirst(next);
  }

  private async markLinked(): Promise<void> {
    await this.storage.localDb.put('device', 'linkedAccountId', this.accountId);
    this.activate();
  }

  // "Upload my data": server empty, this device has the data
  uploadMyData(): Promise<void> {
    return this.backupFirst(() => this.uploadAll());
  }

  private async uploadAll(): Promise<void> {
    const engine = this.engine!;
    const snapshot = this.storage.snapshotSynced();
    const expected = countLocal(snapshot);
    this.link.update((l) => ({ ...l, phase: 'uploading', local: expected }));
    try {
      await this.markLinked();
      const queued = engine.enqueueSnapshot(snapshot, 0);
      await this.storage.localDb.put('device', 'verify', { expected });
      this.link.update((l) => ({ ...l, total: Math.max(queued, engine.pending), remaining: engine.pending }));
      await engine.push((remaining) => this.link.update((l) => ({ ...l, remaining })));
      await this.verifyUpload(expected, false);
    } catch (error) {
      this.link.set({ phase: 'error', error: error instanceof SyncError ? error.kind : 'error' });
    }
  }

  // The app was closed mid-upload: the outbox is persistent, so just finish and verify
  private async finishInterruptedUpload(): Promise<void> {
    const verify = await this.storage.localDb.get<{ expected: Counts }>('device', 'verify');
    if (!verify) return;
    this.link.set({ phase: 'uploading', remaining: this.engine!.pending });
    try {
      await this.engine!.push((remaining) => this.link.update((l) => ({ ...l, remaining })));
      await this.verifyUpload(verify.expected, false);
    } catch (error) {
      this.link.set({ phase: 'error', error: error instanceof SyncError ? error.kind : 'error' });
    }
  }

  private async verifyUpload(expected: Counts, afterMerge: boolean): Promise<void> {
    const meta = await this.api.transport.meta();
    const local = afterMerge ? countLocal(this.storage.snapshotSynced()) : expected;
    if (!countsMatch(local, meta.counts)) {
      this.link.set({ phase: 'verify-failed', local, server: countServer(meta.counts) });
      return;
    }
    await this.storage.localDb.delete('device', 'verify');
    this.link.set({ phase: 'none' });
    this.lastSyncAt.set(Date.now());
    this.status.set('idle');
    if (afterMerge) location.reload(); // services re-read the merged data
    else this.scheduleSoon();
  }

  retryUpload(): Promise<void> {
    return this.uploadAll();
  }

  // Both sides have data. Choice 1: keep the server copy (this device's data is replaced)
  keepServerCopy(): Promise<void> {
    return this.backupFirst(() => this.takeServerCopy());
  }

  private async takeServerCopy(): Promise<void> {
    const engine = this.engine!;
    this.link.update((l) => ({ ...l, phase: 'downloading' }));
    try {
      this.storage.wipeSynced();
      await engine.reset();
      await this.markLinked();
      await engine.pull();
      await this.storage.flush();
      location.reload();
    } catch (error) {
      this.link.set({ phase: 'error', error: error instanceof SyncError ? error.kind : 'error' });
    }
  }

  // Choice 2: merge by id. Server copy wins overlaps; the losing versions are kept in
  // "conflicts" (Settings -> Change history), nothing is dropped.
  mergeById(): Promise<void> {
    return this.backupFirst(() => this.mergeAll());
  }

  private async mergeAll(): Promise<void> {
    const engine = this.engine!;
    this.link.update((l) => ({ ...l, phase: 'uploading' }));
    try {
      await this.markLinked();
      const snapshot = this.storage.snapshotSynced();
      engine.enqueueSnapshot(snapshot, 0);
      await engine.push((remaining) => this.link.update((l) => ({ ...l, remaining })));
      await engine.pull();
      await this.storage.flush();
      await this.verifyUpload({}, true);
    } catch (error) {
      this.link.set({ phase: 'error', error: error instanceof SyncError ? error.kind : 'error' });
    }
  }

  // ---------------------------------------------------------------- sign out

  // Forget everything tied to the account on this device (the server copy is untouched)
  async eraseLocal(): Promise<void> {
    this.stop();
    this.storage.wipeSynced();
    const db = this.storage.localDb;
    for (const key of ['queue', 'revs', 'cursor', 'rejected', 'linkedAccountId', 'verify']) {
      await db.delete('device', key);
    }
    await this.storage.flush();
  }
}
