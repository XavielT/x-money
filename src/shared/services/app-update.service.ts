import { Injectable, computed, inject, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { Capacitor } from '@capacitor/core';
import { APK_URL, APP_VERSION, LATEST_RELEASE_API } from '../config/app-version';
import { isNewerVersion, latestReleaseOf } from '../domain/app-update';

export type UpdateState = 'idle' | 'checking' | 'up-to-date' | 'available' | 'applying' | 'error' | 'unsupported';

const AUTO_CHECK_GAP_MS = 30 * 60 * 1000;
const NETWORK_TIMEOUT_MS = 10_000;
const READY_TIMEOUT_MS = 30_000;

// Updating the app from the app itself.
// - Web / iPhone PWA: the service worker keeps a cached copy of the app, and a suspended PWA can keep serving an old one
//   for days. "Update" asks the service worker for the new files, activates them and reloads.
// - Android app: the web files live inside the APK, so a new version is a new APK. The latest GitHub release is read
//   (one GET, nothing of yours is sent) and "Update" downloads the signed APK, which Android installs over this app
//   (same signing key: your data stays).
@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  private sw = inject(SwUpdate, { optional: true });

  readonly native = Capacitor.isNativePlatform();
  readonly current = APP_VERSION;

  private _state = signal<UpdateState>('idle');
  state = this._state.asReadonly();
  private _latest = signal<string | null>(null);
  latest = this._latest.asReadonly(); // the version found on Android; the web app does not know it
  private _dismissed = signal(false);
  bannerVisible = computed(() => this._state() === 'available' && !this._dismissed());

  clock: () => number = () => Date.now();
  reload: () => void = () => location.reload();
  openUrl: (url: string) => void = (url) => void window.open(url, '_blank', 'noopener');

  private ready = false; // the service worker has downloaded a new version
  private lastAuto = 0;

  constructor() {
    this.sw?.versionUpdates.subscribe((e) => {
      if (e.type === 'VERSION_READY') {
        this.ready = true;
        this._state.set('available');
      }
    });
  }

  dismissBanner(): void {
    this._dismissed.set(true);
  }

  // The button: look for a newer version now
  async check(): Promise<UpdateState> {
    const now = this._state();
    if (now === 'checking' || now === 'applying') return now;
    this._state.set('checking');
    try {
      if (this.native) await this.checkNative();
      else await this.checkWeb();
    } catch {
      this._state.set('error');
    }
    return this._state();
  }

  // Automatic look (start-up, return to the app): at most every 30 minutes and quiet; only a found update shows (banner)
  async autoCheck(): Promise<void> {
    if (this._state() === 'available' || this._state() === 'applying') return;
    const now = this.clock();
    if (this.lastAuto && now >= this.lastAuto && now - this.lastAuto < AUTO_CHECK_GAP_MS) return;
    this.lastAuto = now;
    await this.check();
  }

  // The button: install what was found
  async apply(): Promise<void> {
    if (this._state() !== 'available') return;
    if (this.native) {
      this.openUrl(APK_URL); // Android downloads it and offers to install; the state stays 'available' until it is done
      return;
    }
    this._state.set('applying');
    try {
      await this.waitReady();
      await this.sw?.activateUpdate();
    } catch {
      // a reload fetches the new files even when the activation did not run
    }
    this.reload();
  }

  private async checkNative(): Promise<void> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), NETWORK_TIMEOUT_MS);
    try {
      const res = await fetch(LATEST_RELEASE_API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store', signal: ctrl.signal });
      if (!res.ok) throw new Error(`http-${res.status}`);
      const release = latestReleaseOf(await res.json());
      if (!release) throw new Error('bad-reply');
      this._latest.set(release.version);
      // a release without its APK yet (the build is still running) is not an update to install
      this._state.set(release.hasApk && isNewerVersion(release.version, APP_VERSION) ? 'available' : 'up-to-date');
    } finally {
      clearTimeout(timer);
    }
  }

  private async checkWeb(): Promise<void> {
    if (!this.sw?.isEnabled) {
      this._state.set('unsupported'); // development, or a browser without service workers
      return;
    }
    const found = await this.sw.checkForUpdate();
    this._state.set(found || this.ready ? 'available' : 'up-to-date');
  }

  private async waitReady(): Promise<void> {
    const end = this.clock() + READY_TIMEOUT_MS;
    while (!this.ready && this.clock() < end) await new Promise((r) => setTimeout(r, 250));
  }
}
