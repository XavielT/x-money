// Where each part of Settings lives. Every link into Settings goes through here, so moving a section is a change to this file
// only. Each destination is its own screen: /settings/<id>. (The old /settings#<id> links are redirected by the Settings menu.)
export interface SettingsLink {
  commands: unknown[];
  fragment?: string;
}

const screen = (id: string): SettingsLink => ({ commands: ['/settings', id] });

export const SETTINGS_LINKS = {
  preferences: screen('preferences'),
  categories: screen('categories'),
  recurring: screen('recurring'),
  alerts: screen('alerts'),
  features: screen('features'),
  data: screen('data'),
  security: screen('security'),
  account: screen('account'),
  about: screen('about'),
} as const satisfies Record<string, SettingsLink>;

export type SettingsDestination = keyof typeof SETTINGS_LINKS;
