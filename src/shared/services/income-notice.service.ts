import { Injectable, effect, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { IncomeNotice, plannedIncomeNotices } from '../domain/income-notices';
import { IncomeSourceService } from './income-source.service';
import { StorageService } from './storage.service';
import { TransactionService } from './transaction.service';
import { TranslateService } from './translate.service';

interface DevicePrefs {
  incomeAlerts?: boolean;
  [key: string]: unknown;
}

const MORNING_HOUR = 9;
const TAG = 'x-money-income';

const idOf = (key: string): number => {
  let h = 11;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(h) % 2_000_000_000 || 1;
};

// "Income alerts": a device reminder on the morning of each expected income (payroll, a client's payment), so you confirm it with
// "Yes, it arrived". Device-only preference, permission asked only when turned on, approximate alarms, and a text without amounts.
@Injectable({ providedIn: 'root' })
export class IncomeNoticeService {
  readonly supported = Capacitor.isNativePlatform();
  private _enabled = signal(false);
  enabled = this._enabled.asReadonly();
  status = signal<'' | 'denied' | 'error'>('');

  constructor(
    private storage: StorageService,
    private sources: IncomeSourceService,
    private transactions: TransactionService,
    private translate: TranslateService
  ) {
    this._enabled.set(this.supported && !!this.storage.get<DevicePrefs>('device-prefs', {}).incomeAlerts);
    effect(() => {
      const notices = plannedIncomeNotices(this.sources.active(), this.transactions.transactions(), this.todayIso());
      if (this._enabled()) void this.schedule(notices);
    });
  }

  private todayIso(): string {
    const d = this.transactions.clock();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
    this.storage.set<DevicePrefs>('device-prefs', { ...this.storage.get<DevicePrefs>('device-prefs', {}), incomeAlerts: value });
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

  bodyOf(notice: IncomeNotice): string {
    const name = this.sources.byId(notice.sourceId)?.name ?? '';
    return this.translate.instant('{name} should arrive today. Open X Money to confirm it', { name });
  }

  private async schedule(notices: readonly IncomeNotice[]): Promise<void> {
    try {
      const LocalNotifications = await this.plugin();
      await this.clear();
      const now = Date.now();
      const items = notices
        .map((n) => {
          const [y, m, d] = n.at.split('-').map(Number);
          return { n, at: new Date(y, m - 1, d, MORNING_HOUR, 0, 0) };
        })
        .filter((x) => x.at.getTime() > now)
        .map(({ n, at }) => ({
          id: idOf(n.key),
          title: 'X Money',
          body: this.bodyOf(n),
          schedule: { at, allowWhileIdle: false },
          isExactNotification: false,
          extra: { tag: TAG },
        }));
      if (items.length) await LocalNotifications.schedule({ notifications: items });
      this.status.set('');
    } catch {
      this.status.set('error');
    }
  }
}
