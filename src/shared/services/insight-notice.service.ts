import { Injectable, effect, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Insight } from '../domain/insights/types';
import { SmartInsightService } from './smart-insight.service';
import { StorageService } from './storage.service';
import { TranslateService } from './translate.service';

interface DevicePrefs {
  smartAlerts?: boolean;
  [key: string]: unknown;
}

const TAG = 'x-money-insight';
const MORNING_HOUR = 9;

const idOf = (key: string): number => {
  let h = 11;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(h) % 2_000_000_000 || 1;
};

// Device notifications ONLY for the critical insights (an overdue payment, not enough money for the
// next 30 days) and ONLY if the user turned them on here. A device-only preference, no amounts in
// the text (it would show on a locked screen). On the web/PWA the alerts live inside the app.
@Injectable({ providedIn: 'root' })
export class InsightNoticeService {
  readonly supported = Capacitor.isNativePlatform();
  private _enabled = signal(false);
  enabled = this._enabled.asReadonly();
  status = signal<'' | 'denied' | 'error'>('');

  constructor(
    private storage: StorageService,
    private insights: SmartInsightService,
    private translate: TranslateService
  ) {
    this._enabled.set(this.supported && !!this.storage.get<DevicePrefs>('device-prefs', {}).smartAlerts);
    effect(() => {
      // reads the critical insights only when the user turned the notices on: nothing runs otherwise
      if (this._enabled()) void this.schedule(this.insights.critical());
    });
  }

  private plugin() {
    return import('@capacitor/local-notifications').then((m) => m.LocalNotifications);
  }

  async enable(): Promise<boolean> {
    if (!this.supported) return false;
    this.status.set('');
    try {
      const LocalNotifications = await this.plugin();
      let perm = await LocalNotifications.checkPermissions();
      if (perm.display !== 'granted') perm = await LocalNotifications.requestPermissions();
      if (perm.display !== 'granted') {
        this.status.set('denied');
        return false;
      }
    } catch {
      this.status.set('error');
      return false;
    }
    this._enabled.set(true);
    this.persist(true);
    return true;
  }

  async disable(): Promise<void> {
    this._enabled.set(false);
    this.persist(false);
    await this.clear();
  }

  private persist(value: boolean): void {
    this.storage.set<DevicePrefs>('device-prefs', { ...this.storage.get<DevicePrefs>('device-prefs', {}), smartAlerts: value });
  }

  private async clear(): Promise<void> {
    try {
      const LocalNotifications = await this.plugin();
      const { notifications } = await LocalNotifications.getPending();
      const mine = notifications.filter((n) => n.extra?.['tag'] === TAG);
      if (mine.length) await LocalNotifications.cancel({ notifications: mine.map((n) => ({ id: n.id })) });
    } catch {
      /* nothing pending or plugin unavailable */
    }
  }

  // Next 9:00 (today if it is still early, else tomorrow)
  private nextMorning(): Date {
    const at = new Date();
    at.setHours(MORNING_HOUR, 0, 0, 0);
    if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);
    return at;
  }

  private async schedule(critical: readonly Insight[]): Promise<void> {
    try {
      const LocalNotifications = await this.plugin();
      await this.clear();
      if (!critical.length) return;
      const at = this.nextMorning();
      await LocalNotifications.schedule({
        notifications: critical.map((i) => ({
          id: idOf(i.id),
          title: 'X Money',
          body: this.translate.instant(i.titleKey), // the title never carries an amount
          schedule: { at, allowWhileIdle: false },
          isExactNotification: false,
          extra: { tag: TAG },
        })),
      });
      this.status.set('');
    } catch {
      this.status.set('error');
    }
  }
}
