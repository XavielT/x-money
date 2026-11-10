// The Settings menu: which screens exist and the one status line each row shows. Pure: the caller hands over the facts.
export const SETTINGS_SECTION_IDS = ['features', 'preferences', 'categories', 'recurring', 'alerts', 'data', 'account', 'security', 'about'] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

export interface SettingsSection {
  id: SettingsSectionId;
  icon: string;
  title: string; // English key
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: 'features', icon: '🧩', title: 'Features' },
  { id: 'preferences', icon: '🎛️', title: 'Preferences' },
  { id: 'categories', icon: '🏷️', title: 'Categories' },
  { id: 'recurring', icon: '🔁', title: 'Recurring transactions' },
  { id: 'alerts', icon: '🔔', title: 'Alerts' },
  { id: 'data', icon: '💾', title: 'Your data' },
  { id: 'account', icon: '👤', title: 'Account' },
  { id: 'security', icon: '🔒', title: 'App lock' },
  { id: 'about', icon: 'ℹ️', title: 'About and updates' },
];

export function isSettingsSection(value: string | null | undefined): value is SettingsSectionId {
  return !!value && (SETTINGS_SECTION_IDS as readonly string[]).includes(value);
}

export interface MenuFacts {
  language: 'en' | 'es';
  currency: string;
  categories: number;
  recurringActive: number;
  recurringTotal: number;
  riskAt: number;
  modulesOn: number;
  signedIn: boolean;
  lastSyncTime: string | null; // already formatted by the caller; null = no sync yet
  pending: number;
  lockOn: boolean;
  email: string;
  version: string;
}

export interface MenuStatus {
  key: string; // English key for TranslateService
  params?: Record<string, string>;
}

// One short line per row. Keys are English; the caller translates them.
export function menuStatus(id: SettingsSectionId, f: MenuFacts): MenuStatus {
  switch (id) {
    case 'features':
      return { key: '{n} on', params: { n: String(f.modulesOn) } };
    case 'preferences':
      return { key: '{language} · {currency}', params: { language: f.language === 'es' ? 'Español' : 'English', currency: f.currency } };
    case 'categories':
      return { key: '{n} categories', params: { n: String(f.categories) } };
    case 'recurring':
      return f.recurringTotal === 0 ? { key: 'None yet' } : { key: '{n} active', params: { n: String(f.recurringActive) } };
    case 'alerts':
      return { key: 'Budget warning at {n}%', params: { n: String(f.riskAt) } };
    case 'data':
      if (!f.signedIn) return { key: 'Only on this device' };
      if (f.pending > 0) return { key: '{n} changes waiting to sync', params: { n: String(f.pending) } };
      return f.lastSyncTime ? { key: 'Last sync {time}', params: { time: f.lastSyncTime } } : { key: 'Not synced yet' };
    case 'account':
      return f.signedIn ? { key: '{email}', params: { email: f.email } } : { key: 'Only on this device' };
    case 'security':
      return { key: f.lockOn ? 'On' : 'Off' };
    case 'about':
      return { key: 'Version {v}', params: { v: f.version } };
  }
}
