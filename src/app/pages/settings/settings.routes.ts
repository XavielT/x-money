import { Routes } from '@angular/router';
import { SettingsSectionId } from '../../../shared/domain/settings-menu';

// /settings is the menu; /settings/<id> is one screen per section (ids = the keys of SETTINGS_LINKS).
// The Record type makes the compiler ask for a route whenever a section is added to the menu.
const screens: Record<SettingsSectionId, () => Promise<unknown>> = {
  features: () => import('./screens/features').then((m) => m.SettingsFeaturesComponent),
  preferences: () => import('./screens/preferences').then((m) => m.SettingsPreferencesComponent),
  categories: () => import('./screens/categories').then((m) => m.SettingsCategoriesComponent),
  recurring: () => import('./screens/recurring').then((m) => m.SettingsRecurringComponent),
  alerts: () => import('./screens/alerts').then((m) => m.SettingsAlertsComponent),
  data: () => import('./screens/data').then((m) => m.SettingsDataComponent),
  account: () => import('./screens/account').then((m) => m.SettingsAccountComponent),
  security: () => import('./screens/security').then((m) => m.SettingsSecurityComponent),
  about: () => import('./screens/about').then((m) => m.SettingsAboutComponent),
};

export const SETTINGS_ROUTES: Routes = [
  { path: 'settings', loadComponent: () => import('./settings').then((m) => m.SettingsComponent) },
  ...(Object.keys(screens) as SettingsSectionId[]).map((id) => ({
    path: `settings/${id}`,
    loadComponent: screens[id] as () => Promise<never>,
  })),
];
