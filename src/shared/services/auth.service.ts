import { Injectable, computed, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { ApiService } from './api.service';
import { StorageService } from './storage.service';
import { SyncService } from './sync.service';
import { AuditLogService } from './audit-log.service';
import { ApiError, AuthResponse } from '../data-layer/api-client';

// local      = backend not configured: no accounts, data stays on the device (as in 2.5.x)
// signed-out = backend configured, nobody signed in
// expired    = the stored session was revoked or expired: sign in again, local data is kept
// signed-in  = session stored (also when offline: the app opens with the local copy)
export type AuthMode = 'local' | 'signed-out' | 'expired' | 'signed-in';

export interface SessionInfo {
  id: string;
  deviceLabel: string;
  createdAt: number;
  lastUsedAt: number;
  current: boolean;
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Device';
  return `${os} · ${Capacitor.isNativePlatform() ? 'App' : 'Web'}`;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  mode = signal<AuthMode>('local');
  email = signal('');
  needsAuth = computed(() => this.mode() === 'signed-out' || this.mode() === 'expired');

  // Recovery code shown right after signup / recover / regenerate; must be acknowledged
  recoveryCode = signal<string | null>(null);
  private pendingSignup: AuthResponse | null = null;

  constructor(
    private api: ApiService,
    private storage: StorageService,
    private sync: SyncService,
    private audit: AuditLogService
  ) {}

  async init(): Promise<void> {
    this.audit.deviceId = await this.api.persistence.deviceId(); // names the device in every audit event
    if (!this.api.configured) return;
    this.api.client.onSessionLost = () => this.mode.set('expired');
    const db = this.storage.localDb;
    const session = await this.api.persistence.load();
    if (session) {
      this.email.set(session.email);
      this.mode.set('signed-in'); // optimistic: works offline with the local copy
      void this.sync.start(session.accountId);
    } else {
      this.email.set((await db.get<string>('device', 'lastEmail')) ?? '');
      const linked = await db.get<string>('device', 'linkedAccountId');
      this.mode.set(linked ? 'expired' : 'signed-out');
    }
  }

  private deviceInfo = async () => ({
    deviceId: await this.api.persistence.deviceId(),
    deviceLabel: deviceLabel(),
  });

  async login(email: string, password: string, options: { replaceLocal?: boolean } = {}): Promise<void> {
    const res = await this.api.client.call<AuthResponse>('auth/login', { email, password, ...(await this.deviceInfo()) }, { auth: false });
    await this.finish(res, options.replaceLocal ?? false);
  }

  // Creates the account; the session starts only after the recovery code is acknowledged
  async signup(email: string, password: string, inviteCode: string): Promise<void> {
    const res = await this.api.client.call<AuthResponse>(
      'auth/signup',
      { email, password, inviteCode, ...(await this.deviceInfo()) },
      { auth: false }
    );
    this.pendingSignup = res;
    this.recoveryCode.set(res.recoveryCode ?? null);
  }

  // A one-time invite code for someone else to create an account (only the owner account can make them)
  async createInvite(): Promise<{ code: string; expiresAt: number }> {
    return this.api.client.call<{ code: string; expiresAt: number }>('auth/invite/create');
  }

  async acknowledgeRecoveryCode(): Promise<void> {
    this.recoveryCode.set(null);
    const res = this.pendingSignup;
    this.pendingSignup = null;
    if (res) await this.finish(res, false);
  }

  private async finish(res: AuthResponse, replaceLocal: boolean): Promise<void> {
    const db = this.storage.localDb;
    const linked = await db.get<string>('device', 'linkedAccountId');
    if (linked && linked !== res.account.id) {
      if (!replaceLocal) {
        await this.api.client.setSession(res); // only to close that session on the server
        await this.api.client.call('auth/logout').catch(() => undefined);
        await this.api.client.clearSession();
        throw new ApiError(409, 'different_account');
      }
      await this.sync.eraseLocal();
    }
    await this.api.client.setSession(res);
    await db.put('device', 'lastEmail', res.account.email);
    this.email.set(res.account.email);
    this.mode.set('signed-in');
    void this.sync.start(res.account.id);
  }

  // Returns the new recovery code (shown once)
  async recover(email: string, recoveryCode: string, newPassword: string): Promise<void> {
    const res = await this.api.client.call<{ recoveryCode: string }>(
      'auth/recover',
      { email, recoveryCode, newPassword },
      { auth: false }
    );
    this.recoveryCode.set(res.recoveryCode);
  }

  acknowledgeRecovered(): void {
    this.recoveryCode.set(null);
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.api.client.call('auth/change-password', { currentPassword, newPassword });
  }

  async regenerateRecoveryCode(password: string): Promise<void> {
    const res = await this.api.client.call<{ recoveryCode: string }>('auth/regenerate-recovery', { password });
    this.recoveryCode.set(res.recoveryCode);
  }

  async sessions(): Promise<SessionInfo[]> {
    return (await this.api.client.call<{ sessions: SessionInfo[] }>('auth/sessions')).sessions;
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.api.client.call('auth/revoke', { sessionId });
  }

  // eraseLocal: also drop this device's copy of the financial data (the server keeps it)
  async logout(options: { eraseLocal: boolean }): Promise<void> {
    await this.api.client.call('auth/logout').catch(() => undefined); // offline: the server session just expires
    await this.api.client.clearSession();
    this.sync.stop();
    if (options.eraseLocal) {
      await this.sync.eraseLocal();
      location.reload();
      return;
    }
    this.mode.set('signed-out');
  }
}
