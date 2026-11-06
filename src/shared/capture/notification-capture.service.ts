import { Injectable, signal } from '@angular/core';
import { Capacitor, PluginListenerHandle, registerPlugin } from '@capacitor/core';
import { CaptureService } from '../services/capture.service';

interface NativeNotification {
  id: string;
  pkg: string;
  title: string;
  text: string;
  postedAt: number;
}

export interface NotificationAccess {
  enabled: boolean; // the switch in X Money's settings
  granted: boolean; // Android's "Notification access" for X Money, which only the user can grant
}

interface NotificationCapturePlugin {
  status(): Promise<NotificationAccess>;
  setEnabled(options: { enabled: boolean }): Promise<NotificationAccess>;
  openSettings(): Promise<void>;
  getPending(): Promise<{ items: NativeNotification[] }>;
  ack(options: { ids: string[] }): Promise<void>;
  addListener(event: 'bankNotification', cb: () => void): Promise<PluginListenerHandle>;
}

const native = registerPlugin<NotificationCapturePlugin>('NotificationCapture');

export interface DrainResult {
  drafts: number;
  skipped: number;
}

// Bank-app notifications (Popular, Banreservas, BHD) from the Android listener to DRAFTS in the capture
// tray. Everything is on the device: the listener keeps the text of those apps only, this service reads it
// with the local bank-notice reader (no AI, no network) and removes each item once it is a draft. Nothing
// here writes a movement: approving stays the user's tap in the tray (rule 11).
@Injectable({ providedIn: 'root' })
export class NotificationCaptureService {
  readonly available = Capacitor.isNativePlatform();
  private _access = signal<NotificationAccess | null>(null);
  access = this._access.asReadonly();
  private running: Promise<DrainResult> | null = null;

  constructor(private capture: CaptureService) {}

  async refresh(): Promise<NotificationAccess | null> {
    if (!this.available) return null;
    try {
      this._access.set(await native.status());
    } catch {
      this._access.set(null);
    }
    return this._access();
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.capture.setPrefs({ notificationsEnabled: enabled });
    if (!this.available) return;
    try {
      this._access.set(await native.setEnabled({ enabled }));
    } catch {
      this._access.set(null);
    }
  }

  async openAndroidSettings(): Promise<void> {
    if (!this.available) return;
    await native.openSettings().catch(() => undefined);
  }

  // Keeps the listener's switch in line with the saved preference (a reinstall or a restore can desync them)
  async sync(): Promise<void> {
    if (!this.available) return;
    const wanted = this.capture.prefs().notificationsEnabled;
    const now = await this.refresh();
    if (now && now.enabled !== wanted) await native.setEnabled({ enabled: wanted }).then((a) => this._access.set(a)).catch(() => undefined);
  }

  // Re-entrant: two triggers at once (start-up and an arriving notification) share one run
  drain(): Promise<DrainResult> {
    if (this.running) return this.running;
    this.running = this.run().finally(() => (this.running = null));
    return this.running;
  }

  private async run(): Promise<DrainResult> {
    const result: DrainResult = { drafts: 0, skipped: 0 };
    if (!this.available || !this.capture.prefs().notificationsEnabled) return result;
    const { items } = await native.getPending().catch(() => ({ items: [] as NativeNotification[] }));
    const done: string[] = [];
    for (const n of items) {
      const outcome = this.capture.ingestNotification({ id: n.id, pkg: n.pkg, title: n.title, text: n.text, postedAt: n.postedAt });
      if (outcome === 'error') continue; // stays in the inbox for the next run: nothing is lost
      if (outcome === 'draft') result.drafts++;
      else if (outcome === 'skipped') result.skipped++;
      done.push(n.id);
    }
    if (done.length) await native.ack({ ids: done }).catch(() => undefined);
    return result;
  }

  // The callback runs when a bank notification arrives while the app is open
  onArrived(cb: () => void): () => void {
    if (!this.available) return () => undefined;
    let handle: PluginListenerHandle | null = null;
    let removed = false;
    void native.addListener('bankNotification', cb).then((h) => {
      if (removed) void h.remove();
      else handle = h;
    });
    return () => {
      removed = true;
      void handle?.remove();
    };
  }
}
