import {
  ApplicationConfig,
  inject,
  Injector,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';

import { routes } from './app.routes';
import { Capacitor } from '@capacitor/core';
import { provideServiceWorker } from '@angular/service-worker';
import { StorageService } from '../shared/services/storage.service';
import { AuthService } from '../shared/services/auth.service';
import { MigrationService } from '../shared/services/migration.service';
import { TranslateService } from '../shared/services/translate.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // The local copy must be loaded before any service reads it; then the session is restored
    provideAppInitializer(async () => {
      // inject() only works before the first await
      const injector = inject(Injector);
      await injector.get(StorageService).hydrate();
      // data migrations run before any service reads the data
      await injector.get(MigrationService).run();
      // resolved only now: AuthService pulls in the data services, which read the hydrated copy
      await injector.get(AuthService).init();
      // the Spanish texts load only for Spanish users
      await injector.get(TranslateService).ensureLoaded();
    }),
    // anchorScrolling: a link to /settings#data lands on that section
    provideRouter(routes, withInMemoryScrolling({ anchorScrolling: 'enabled' })),
    provideServiceWorker('xmoney-sw.js', {
      // The Android app ships its files inside the APK: a service worker there can only serve a stale copy
      enabled: !isDevMode() && !Capacitor.isNativePlatform(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
