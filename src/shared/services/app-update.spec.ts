// The update button: the iPhone/web app asks its service worker, the Android app asks GitHub. Everything is faked:
// no network, no service worker, no browser.
import { TestBed } from '@angular/core/testing';
import { SwUpdate } from '@angular/service-worker';
import { Capacitor } from '@capacitor/core';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, vi } from 'vitest';
import { APK_URL, APP_VERSION } from '../config/app-version';
import { AppUpdateService } from './app-update.service';

class FakeSw {
  isEnabled = true;
  events = new Subject<{ type: string }>();
  versionUpdates = this.events.asObservable();
  found = false;
  checkForUpdate = vi.fn(async () => this.found);
  activateUpdate = vi.fn(async () => true);
}

let sw: FakeSw;
const make = (native: boolean): AppUpdateService => {
  vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(native);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: SwUpdate, useValue: sw }] });
  const s = TestBed.inject(AppUpdateService);
  s.reload = vi.fn();
  s.openUrl = vi.fn();
  return s;
};

const reply = (body: unknown, ok = true) => vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }) as unknown as Response);
const release = (tag: string, apk = true) => ({ tag_name: tag, assets: apk ? [{ name: 'x-money.apk' }] : [] });
const next = (() => {
  const [a, b, c] = APP_VERSION.split('.').map(Number);
  return `v${a}.${b}.${c + 1}`;
})();

beforeEach(() => {
  sw = new FakeSw();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('web / iPhone app (service worker)', () => {
  it('no new version: it says so', async () => {
    const s = make(false);
    expect(await s.check()).toBe('up-to-date');
    expect(sw.checkForUpdate).toHaveBeenCalledTimes(1);
  });

  it('a new version is found, then Update activates it and reloads (and only then)', async () => {
    const s = make(false);
    sw.found = true;
    expect(await s.check()).toBe('available');
    expect(s.bannerVisible()).toBe(true);
    sw.events.next({ type: 'VERSION_READY' });
    await s.apply();
    expect(sw.activateUpdate).toHaveBeenCalledTimes(1);
    expect(s.reload).toHaveBeenCalledTimes(1);
    expect(s.openUrl).not.toHaveBeenCalled(); // the web app never downloads an APK
  });

  it('a version the service worker downloaded by itself shows the banner without any check', () => {
    const s = make(false);
    sw.events.next({ type: 'VERSION_READY' });
    expect(s.state()).toBe('available');
    expect(s.bannerVisible()).toBe(true);
    s.dismissBanner();
    expect(s.bannerVisible()).toBe(false);
  });

  it('a browser without a service worker (or development) says the browser updates it on reload', async () => {
    sw.isEnabled = false;
    expect(await make(false).check()).toBe('unsupported');
  });

  it('a failing check is an error, never a crash', async () => {
    const s = make(false);
    sw.checkForUpdate.mockRejectedValueOnce(new Error('offline'));
    expect(await s.check()).toBe('error');
  });

  it('Update does nothing when there is nothing to install', async () => {
    const s = make(false);
    await s.apply();
    expect(sw.activateUpdate).not.toHaveBeenCalled();
    expect(s.reload).not.toHaveBeenCalled();
  });
});

describe('Android app (GitHub releases)', () => {
  it('a newer release with its APK: available, and Update opens the download of the signed APK', async () => {
    vi.stubGlobal('fetch', reply(release(next)));
    const s = make(true);
    expect(await s.check()).toBe('available');
    expect(s.latest()).toBe(next.slice(1));
    await s.apply();
    expect(s.openUrl).toHaveBeenCalledWith(APK_URL);
    expect(APK_URL).toMatch(/^https:\/\/github\.com\/XavielT\/x-money\/releases\/latest\/download\/x-money\.apk$/);
    expect(sw.checkForUpdate).not.toHaveBeenCalled();
    expect(s.reload).not.toHaveBeenCalled();
  });

  it('the same or an older release: up to date', async () => {
    vi.stubGlobal('fetch', reply(release('v' + APP_VERSION)));
    expect(await make(true).check()).toBe('up-to-date');
    vi.stubGlobal('fetch', reply(release('v0.0.1')));
    expect(await make(true).check()).toBe('up-to-date');
  });

  it('a newer release whose APK is not attached yet (the build is running) is not an update to install', async () => {
    vi.stubGlobal('fetch', reply(release(next, false)));
    expect(await make(true).check()).toBe('up-to-date');
  });

  it('only ever asks for the public releases of the project and sends nothing of yours', async () => {
    const f = reply(release(next));
    vi.stubGlobal('fetch', f);
    await make(true).check();
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/XavielT/x-money/releases/latest');
    expect(init.method).toBeUndefined(); // a plain GET
    expect(init.body).toBeUndefined();
    expect(init.credentials).toBeUndefined();
  });

  it('a bad reply, an HTTP error or no connection is an error, not an update', async () => {
    vi.stubGlobal('fetch', reply({ message: 'Not Found' }));
    expect(await make(true).check()).toBe('error');
    vi.stubGlobal('fetch', reply({}, false));
    expect(await make(true).check()).toBe('error');
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    expect(await make(true).check()).toBe('error');
  });
});

describe('automatic checks', () => {
  it('run at most every 30 minutes and never while an update is waiting', async () => {
    const f = reply(release('v' + APP_VERSION));
    vi.stubGlobal('fetch', f);
    const s = make(true);
    let t = 1_000_000;
    s.clock = () => t;
    await s.autoCheck();
    await s.autoCheck();
    expect(f).toHaveBeenCalledTimes(1); // the second one is too soon
    t += 31 * 60 * 1000;
    await s.autoCheck();
    expect(f).toHaveBeenCalledTimes(2);

    vi.stubGlobal('fetch', reply(release(next)));
    t += 31 * 60 * 1000;
    await s.autoCheck();
    expect(s.state()).toBe('available');
    const g = reply(release(next));
    vi.stubGlobal('fetch', g);
    t += 31 * 60 * 1000;
    await s.autoCheck();
    expect(g).not.toHaveBeenCalled(); // already waiting: no flicker, no extra request
  });

  it('a clock that went backwards does not block the check for good', async () => {
    const f = reply(release('v' + APP_VERSION));
    vi.stubGlobal('fetch', f);
    const s = make(true);
    s.clock = () => 5_000_000;
    await s.autoCheck();
    s.clock = () => 1_000;
    await s.autoCheck();
    expect(f).toHaveBeenCalledTimes(2);
  });
});
