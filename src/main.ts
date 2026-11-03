import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Storage hydration (and the 2.5.x -> 2.6 migration) runs in the app initializer,
// see app.config.ts and StorageService.hydrate().
bootstrapApplication(App, appConfig).catch((err) => console.error(err));
