import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

// Pre-2.6 storage: localStorage "x-money:*" keys mirrored to Capacitor Preferences.
// From 2.6 the working copy is IndexedDB; on Android Preferences stays as a live
// mirror (the OS never wipes it) that is only read when IndexedDB comes back empty.
export interface LegacySource {
  // raw JSON per key (without the prefix); Preferences wins over localStorage on native
  readAll(): Promise<Record<string, string>>;
  // keeps the old localStorage copy under another name once the migration is verified
  archive(keys: string[]): Promise<void>;
  // native durable mirror (no-op on the web); raw === null removes the key
  mirror(key: string, raw: string | null): void;
  // degraded mode (IndexedDB unavailable): localStorage is the working copy again
  writeLocal(key: string, raw: string | null): void;
  clearAll(): Promise<void>;
}

const PREFIX = 'x-money:';
const ARCHIVE_PREFIX = 'x-money-legacy-2.5:';

export class BrowserLegacy implements LegacySource {
  private native = Capacitor.isNativePlatform();

  async readAll(): Promise<Record<string, string>> {
    const found: Record<string, string> = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(PREFIX)) found[key.slice(PREFIX.length)] = localStorage.getItem(key) ?? '';
      }
    } catch {
      /* localStorage blocked */
    }
    if (this.native) {
      try {
        const { keys } = await Preferences.keys();
        for (const key of keys.filter((k) => k.startsWith(PREFIX))) {
          const { value } = await Preferences.get({ key });
          if (value !== null) found[key.slice(PREFIX.length)] = value;
        }
      } catch {
        /* Preferences unavailable */
      }
    }
    return found;
  }

  async archive(keys: string[]): Promise<void> {
    try {
      for (const key of keys) {
        const raw = localStorage.getItem(PREFIX + key);
        if (raw === null) continue;
        localStorage.setItem(ARCHIVE_PREFIX + key, raw);
        localStorage.removeItem(PREFIX + key);
      }
    } catch {
      /* keep whatever could not be moved */
    }
  }

  mirror(key: string, raw: string | null): void {
    if (!this.native) return;
    const op = raw === null ? Preferences.remove({ key: PREFIX + key }) : Preferences.set({ key: PREFIX + key, value: raw });
    op.catch(() => undefined);
  }

  writeLocal(key: string, raw: string | null): void {
    try {
      if (raw === null) localStorage.removeItem(PREFIX + key);
      else localStorage.setItem(PREFIX + key, raw);
    } catch {
      /* quota: nothing else to do in degraded mode */
    }
  }

  async clearAll(): Promise<void> {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith(PREFIX) || k.startsWith(ARCHIVE_PREFIX))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
    if (this.native) {
      try {
        const { keys } = await Preferences.keys();
        await Promise.all(keys.filter((k) => k.startsWith(PREFIX)).map((key) => Preferences.remove({ key })));
      } catch {
        /* ignore */
      }
    }
  }
}
