import { describe, expect, it } from 'vitest';
import { SETTINGS_LINKS } from '../config/settings-links';
import { MenuFacts, SETTINGS_SECTIONS, SETTINGS_SECTION_IDS, isSettingsSection, menuStatus } from './settings-menu';
import { syncStatusView } from './sync-status';

const facts: MenuFacts = {
  language: 'en', currency: 'RD$', categories: 12, recurringActive: 2, recurringTotal: 3, riskAt: 90, modulesOn: 3,
  signedIn: true, lastSyncTime: '5:51 PM', pending: 0, lockOn: false, email: 'ana@example.com', version: '2.23.0',
};

describe('settings menu', () => {
  it('every id has a section, the same ids SETTINGS_LINKS uses, and no duplicates', () => {
    expect(SETTINGS_SECTIONS.map((s) => s.id).sort()).toEqual([...SETTINGS_SECTION_IDS].sort());
    expect(new Set(SETTINGS_SECTION_IDS).size).toBe(SETTINGS_SECTION_IDS.length);
    expect(Object.keys(SETTINGS_LINKS).sort()).toEqual([...SETTINGS_SECTION_IDS].sort());
  });

  it('isSettingsSection only accepts real ids', () => {
    expect(isSettingsSection('data')).toBe(true);
    expect(isSettingsSection('nothing')).toBe(false);
    expect(isSettingsSection(null)).toBe(false);
    expect(isSettingsSection(undefined)).toBe(false);
    expect(isSettingsSection('')).toBe(false);
  });

  it('status lines', () => {
    expect(menuStatus('features', facts)).toEqual({ key: '{n} on', params: { n: '3' } });
    expect(menuStatus('preferences', facts)).toEqual({ key: '{language} · {currency}', params: { language: 'English', currency: 'RD$' } });
    expect(menuStatus('preferences', { ...facts, language: 'es' }).params?.['language']).toBe('Español');
    expect(menuStatus('recurring', { ...facts, recurringTotal: 0, recurringActive: 0 })).toEqual({ key: 'None yet' });
    expect(menuStatus('recurring', facts).params).toEqual({ n: '2' });
    expect(menuStatus('alerts', facts).params).toEqual({ n: '90' });
    expect(menuStatus('data', facts)).toEqual({ key: 'Last sync {time}', params: { time: '5:51 PM' } });
    expect(menuStatus('data', { ...facts, pending: 4 })).toEqual({ key: '{n} changes waiting to sync', params: { n: '4' } });
    expect(menuStatus('data', { ...facts, lastSyncTime: null })).toEqual({ key: 'Not synced yet' });
    expect(menuStatus('data', { ...facts, signedIn: false })).toEqual({ key: 'Only on this device' });
    expect(menuStatus('account', facts).params).toEqual({ email: 'ana@example.com' });
    expect(menuStatus('account', { ...facts, signedIn: false })).toEqual({ key: 'Only on this device' });
    expect(menuStatus('security', facts)).toEqual({ key: 'Off' });
    expect(menuStatus('security', { ...facts, lockOn: true })).toEqual({ key: 'On' });
    expect(menuStatus('about', facts).params).toEqual({ v: '2.23.0' });
  });

  it('every section yields a status, for zeros and empty lists too', () => {
    const empty: MenuFacts = { ...facts, categories: 0, recurringActive: 0, recurringTotal: 0, modulesOn: 0, pending: 0, lastSyncTime: null, signedIn: false, email: '' };
    for (const id of SETTINGS_SECTION_IDS) expect(menuStatus(id, empty).key.length, id).toBeGreaterThan(0);
  });
});

describe('sync status view', () => {
  const base = { signedIn: true, status: 'idle' as const, pending: 0, lastError: null };

  it('local-only mode never claims to sync', () => {
    expect(syncStatusView({ ...base, signedIn: false })).toMatchObject({ headline: 'Only on this device', tone: 'ok' });
  });

  it('idle: synced, or waiting when changes are pending', () => {
    expect(syncStatusView(base)).toEqual({ headline: 'Synced', hint: null, tone: 'ok' });
    expect(syncStatusView({ ...base, pending: 2 })).toEqual({ headline: 'Waiting to sync', hint: null, tone: 'busy' });
  });

  it('syncing is busy with no hint', () => {
    expect(syncStatusView({ ...base, status: 'syncing' })).toEqual({ headline: 'Syncing…', hint: null, tone: 'busy' });
  });

  it('every problem state has a warning tone and a one-sentence hint', () => {
    for (const status of ['offline', 'error', 'auth', 'readonly'] as const) {
      const view = syncStatusView({ ...base, status });
      expect(view.tone, status).toBe('warn');
      expect(view.hint, status).toBeTruthy();
    }
    expect(syncStatusView({ ...base, status: 'error', lastError: 'account_disabled' }).headline).toBe('This account is disabled.');
  });
});
