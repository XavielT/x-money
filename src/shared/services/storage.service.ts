import { Injectable } from '@angular/core';
import { Preferences } from '@capacitor/preferences';

// Generic storage wrapper. localStorage is the synchronous working copy;
// every write is mirrored to Capacitor Preferences (native SharedPreferences
// on Android), which the OS never wipes under storage pressure. On boot,
// main.ts restores localStorage from Preferences if the WebView cache was
// cleared. On the web, Preferences itself falls back to localStorage.
@Injectable({ providedIn: 'root' })
export class StorageService {
  private readonly prefix = 'x-money:';

  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(this.prefix + key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  }

  set<T>(key: string, value: T): void {
    const raw = JSON.stringify(value);
    localStorage.setItem(this.prefix + key, raw);
    Preferences.set({ key: this.prefix + key, value: raw }).catch(() => {});
  }

  remove(key: string): void {
    localStorage.removeItem(this.prefix + key);
    Preferences.remove({ key: this.prefix + key }).catch(() => {});
  }

  clearAll(): void {
    Object.keys(localStorage)
      .filter((key) => key.startsWith(this.prefix))
      .forEach((key) => localStorage.removeItem(key));
    Preferences.keys()
      .then(({ keys }) =>
        Promise.all(
          keys.filter((k) => k.startsWith(this.prefix)).map((key) => Preferences.remove({ key }))
        )
      )
      .catch(() => {});
  }
}
