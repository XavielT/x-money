// What Home says about how fresh its numbers are. Pure: the caller hands over the sync signals.
export type SyncNotice = 'updating' | 'offline' | 'none';

export interface SyncNoticeInput {
  signedIn: boolean; // a local-only app never syncs, so it has nothing to wait for
  linkReady: boolean; // the first-sync wizard is not on screen
  status: 'idle' | 'syncing' | 'offline' | 'error' | 'auth' | 'readonly';
  lastSyncAt: number | null; // null until the first sync of this session ends
  scanningMail: boolean;
}

export function syncNotice(i: SyncNoticeInput): SyncNotice {
  if (!i.signedIn) return 'none';
  if (i.status === 'offline') return 'offline';
  if (i.status === 'syncing' || i.scanningMail) return 'updating';
  // from the start until the first sync ends; an error or a lost session stops the wait (no endless spinner)
  if (i.status === 'idle' && i.lastSyncAt === null && i.linkReady) return 'updating';
  return 'none';
}
