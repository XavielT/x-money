import { Injectable, signal } from '@angular/core';
import { StorageService } from './storage.service';

export type AppLanguage = 'en' | 'es';

// English text is the key; the Spanish map lives in translations-es.ts and is loaded on demand.

@Injectable({ providedIn: 'root' })
export class TranslateService {
  private _lang = signal<AppLanguage>('en');
  private es: Record<string, string> = {};
  lang = this._lang.asReadonly();

  constructor(private storage: StorageService) {
    this._lang.set(this.storage.get<AppLanguage>('lang', 'en'));
    this.storage.watch('lang', (v) => {
      this._lang.set((v as AppLanguage | undefined) ?? 'en');
      void this.ensureLoaded(); // the language was changed on another device
    });
  }

  // Loads the Spanish map when the language is Spanish. Runs once at start-up (app initializer);
  // changing the language reloads the app, so it is never needed later.
  async ensureLoaded(): Promise<void> {
    if (this._lang() === 'es' && !Object.keys(this.es).length) this.es = (await import('./translations-es')).ES;
  }

  // Optional {name} placeholders, for sentences that carry a bank or an account name
  instant(key: string, params?: Record<string, string>): string {
    const text = this._lang() === 'es' ? this.es[key] ?? key : key;
    return params ? text.replace(/\{(\w+)\}/g, (_m, name: string) => params[name] ?? '') : text;
  }

  // Locale for date formatting (month names, weekdays)
  locale(): string {
    return this._lang() === 'es' ? 'es' : 'en-US';
  }

  // Language changes are rare: persist and let the caller reload the app so
  // every pure pipe re-evaluates
  setLanguage(lang: AppLanguage): void {
    this.storage.set('lang', lang);
  }
}
