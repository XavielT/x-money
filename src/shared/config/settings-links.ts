// Where each part of Settings lives. Every link into Settings goes through here, so moving a section is a change to this file
// only. Today every destination is the one Settings page, scrolled to the section (the fragment is the section's id).
export interface SettingsLink {
  commands: unknown[];
  fragment?: string;
}

const here = (fragment: string): SettingsLink => ({ commands: ['/settings'], fragment });

export const SETTINGS_LINKS = {
  preferences: here('preferences'),
  categories: here('categories'),
  recurring: here('recurring'),
  alerts: here('alerts'),
  features: here('features'),
  data: here('data'),
  security: here('security'),
  account: here('account'),
  about: here('about'),
} as const satisfies Record<string, SettingsLink>;

export type SettingsDestination = keyof typeof SETTINGS_LINKS;
