import {
  ApplicationConfig,
  inject,
  Injector,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { provideServiceWorker } from '@angular/service-worker';
import { StorageService } from '../shared/services/storage.service';
import { AuthService } from '../shared/services/auth.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // The local copy must be loaded before any service reads it; then the session is restored
    provideAppInitializer(async () => {
      // inject() only works before the first await
      const injector = inject(Injector);
      await injector.get(StorageService).hydrate();
      // resolved only now: AuthService pulls in the data services, which read the hydrated copy
      await injector.get(AuthService).init();
    }),
    provideRouter(routes),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
