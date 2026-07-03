import { bootstrapApplication } from '@angular/platform-browser';
import { Preferences } from '@capacitor/preferences';
import { appConfig } from './app/app.config';
import { App } from './app/app';

const PREFIX = 'x-money:';

// Restore localStorage from native Preferences if the WebView storage was
// cleared, and seed Preferences from localStorage on first run after update.
async function syncDurableStorage(): Promise<void> {
  const { keys } = await Preferences.keys();
  const durableKeys = keys.filter((k) => k.startsWith(PREFIX));

  for (const key of durableKeys) {
    if (localStorage.getItem(key) === null) {
      const { value } = await Preferences.get({ key });
      if (value !== null) localStorage.setItem(key, value);
    }
  }

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(PREFIX) && !durableKeys.includes(key)) {
      const value = localStorage.getItem(key);
      if (value !== null) await Preferences.set({ key, value });
    }
  }
}

syncDurableStorage()
  .catch(() => {}) // never block startup on storage sync
  .then(() => bootstrapApplication(App, appConfig))
  .catch((err) => console.error(err));
