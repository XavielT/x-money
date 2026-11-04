import { Injectable, effect, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { bankById } from '../data/banks';
import { PlannedNotice } from '../domain/cards';
import { AccountService } from './account.service';
import { CreditCardService } from './credit-card.service';
import { StorageService } from './storage.service';
import { TranslateService } from './translate.service';

interface DevicePrefs {
  cardAlerts?: boolean;
  [key: string]: unknown;
}

const MORNING_HOUR = 9;
const TAG = 'x-money-card';

// Stable positive 31-bit id from a notice key, so rescheduling replaces instead of duplicating
const idOf = (key: string): number => {
  let h = 7;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(h) % 2_000_000_000 || 1;
};

// "Card alerts": device notifications for cut and due dates. Device-only preference; the
// permission is asked only when the user turns it on. Approximate alarms (no exact-alarm
// permission) and a text that never carries an amount, so nothing sensitive shows on a locked
// screen. On the web/PWA the alerts exist only inside the app.
@Injectable({ providedIn: 'root' })
export class CardNoticeService {
  readonly supported = Capacitor.isNativePlatform();
  private _enabled = signal(false);
  enabled = this._enabled.asReadonly();
  // 'denied' when the user refused the system permission, 'error' when scheduling failed
  status = signal<'' | 'denied' | 'error'>('');

  constructor(
    private storage: StorageService,
    private cards: CreditCardService,
    private accounts: AccountService,
    private translate: TranslateService
  ) {
    this._enabled.set(this.supported && !!this.storage.get<DevicePrefs>('device-prefs', {}).cardAlerts);
    // whatever changes the notices (data, payments, card setup) reschedules them
    effect(() => {
      const notices = this.cards.notices();
      if (this._enabled()) void this.schedule(notices);
    });
  }

  // The plugin loads only on the phone and only when needed, so the web bundle stays light
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
    this.storage.set<DevicePrefs>('device-prefs', { ...this.storage.get<DevicePrefs>('device-prefs', {}), cardAlerts: value });
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

  // Text for a notice: no amounts, only the bank
  bodyOf(notice: PlannedNotice): string {
    const card = this.accounts.byId(notice.accountId);
    const bank = (card?.bankId && bankById(card.bankId)?.name) || card?.name || '';
    return this.translate.instant(notice.kind === 'cut' ? 'Your {bank} card cut date is coming up' : 'Your {bank} card payment due date is coming up', { bank });
  }

  private async schedule(notices: readonly PlannedNotice[]): Promise<void> {
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
          isExactNotification: false, // approximate alarms only
          extra: { tag: TAG },
        }));
      if (items.length) await LocalNotifications.schedule({ notifications: items });
      this.status.set('');
    } catch {
      this.status.set('error');
    }
  }
}
