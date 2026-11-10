// What the Data screen says about syncing. Pure: the caller hands over the sync signals; every text is an English key.
export type SyncState = 'idle' | 'syncing' | 'offline' | 'error' | 'auth' | 'readonly';

export interface SyncStatusInput {
  signedIn: boolean; // false = local-only: nothing syncs
  status: SyncState;
  pending: number;
  lastError: string | null;
}

export interface SyncStatusView {
  headline: string; // "Synced", "Syncing…", "Offline", ...
  hint: string | null; // one sentence about what to do, only when there is a problem
  tone: 'ok' | 'busy' | 'warn';
}

export function syncStatusView(i: SyncStatusInput): SyncStatusView {
  if (!i.signedIn) return { headline: 'Only on this device', hint: 'Cloud sync is not set up. Your data stays only on this device.', tone: 'ok' };
  switch (i.status) {
    case 'syncing':
      return { headline: 'Syncing…', hint: null, tone: 'busy' };
    case 'offline':
      return { headline: 'Offline', hint: 'You are offline. Your changes are saved on this device and sync when you are back online.', tone: 'warn' };
    case 'error':
      return i.lastError === 'account_disabled'
        ? { headline: 'This account is disabled.', hint: 'Export a backup and contact the owner of the account.', tone: 'warn' }
        : { headline: 'Sync error', hint: 'Tap "Sync now". If it keeps failing, export a backup.', tone: 'warn' };
    case 'auth':
      return { headline: 'Sign in again', hint: 'Your session ended. Sign in again in Settings → Account.', tone: 'warn' };
    case 'readonly':
      return { headline: 'Read-only: update X Money', hint: 'This version is too old to save changes. Update X Money.', tone: 'warn' };
    default:
      return i.pending > 0 ? { headline: 'Waiting to sync', hint: null, tone: 'busy' } : { headline: 'Synced', hint: null, tone: 'ok' };
  }
}
