import { describe, expect, it } from 'vitest';
import { SyncNoticeInput, syncNotice } from './sync-notice';

const base: SyncNoticeInput = { signedIn: true, linkReady: true, status: 'idle', lastSyncAt: 1000, scanningMail: false };

describe('syncNotice', () => {
  it('after the first sync and idle: nothing', () => expect(syncNotice(base)).toBe('none'));
  it('syncing: updating', () => expect(syncNotice({ ...base, status: 'syncing' })).toBe('updating'));
  it('from the start until the first sync ends: updating', () => expect(syncNotice({ ...base, lastSyncAt: null })).toBe('updating'));
  it('the mail scan counts too', () => expect(syncNotice({ ...base, scanningMail: true })).toBe('updating'));
  it('offline wins, with or without a last sync', () => {
    expect(syncNotice({ ...base, status: 'offline' })).toBe('offline');
    expect(syncNotice({ ...base, status: 'offline', lastSyncAt: null })).toBe('offline');
  });
  it('a local-only app never says it is updating', () => expect(syncNotice({ ...base, signedIn: false, lastSyncAt: null, status: 'syncing' })).toBe('none'));
  it('an error, a lost session or read-only mode stop the wait', () => {
    for (const status of ['error', 'auth', 'readonly'] as const) expect(syncNotice({ ...base, status, lastSyncAt: null })).toBe('none');
  });
  it('while the first-sync wizard is open the app is not waiting', () => expect(syncNotice({ ...base, lastSyncAt: null, linkReady: false })).toBe('none'));
});
