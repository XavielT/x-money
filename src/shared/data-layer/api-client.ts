// Client for the xmoney-api edge function: plain fetch, no supabase-js, no anon key.
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { PullRecord, PushResult, SyncError, SyncTransport, WireOp } from './sync-engine';
import { CLIENT_SCHEMA_VERSION } from './registry';

export class ApiError extends Error {
  constructor(
    public status: number, // 0 = no network / timeout
    public code: string,
    public retryAfterSeconds?: number
  ) {
    super(code);
  }
}

export interface SessionData {
  refreshToken: string;
  accountId: string;
  email: string;
}

export interface SessionPersistence {
  load(): Promise<SessionData | null>;
  save(data: SessionData): Promise<void>;
  clear(): Promise<void>;
  deviceId(): Promise<string>;
}

const SESSION_KEY = 'x-money-session';
const DEVICE_KEY = 'x-money-device';

// Refresh token: Capacitor Preferences on the app, localStorage on the web (readable by
// any script of the origin: that is why the web build ships a strict CSP, see vercel.json)
export class BrowserSessionPersistence implements SessionPersistence {
  private native = Capacitor.isNativePlatform();

  private async read(key: string): Promise<string | null> {
    try {
      if (this.native) return (await Preferences.get({ key })).value;
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  private async write(key: string, value: string | null): Promise<void> {
    try {
      if (this.native) {
        if (value === null) await Preferences.remove({ key });
        else await Preferences.set({ key, value });
      } else if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* storage blocked: the session will not survive a restart */
    }
  }

  async load(): Promise<SessionData | null> {
    const raw = await this.read(SESSION_KEY);
    try {
      return raw ? (JSON.parse(raw) as SessionData) : null;
    } catch {
      return null;
    }
  }
  save(data: SessionData) {
    return this.write(SESSION_KEY, JSON.stringify(data));
  }
  clear() {
    return this.write(SESSION_KEY, null);
  }
  async deviceId(): Promise<string> {
    let id = await this.read(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      await this.write(DEVICE_KEY, id);
    }
    return id;
  }
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  account: { id: string; email: string };
  serverNow: number;
  recoveryCode?: string;
}

interface CallOptions {
  auth?: boolean;
  retry?: boolean; // only for idempotent calls (sync)
  base?: string; // another function of the same project (xmoney-ai); the session is shared
}

export class XMoneyApiClient {
  private accessToken: string | null = null;
  private refreshing: Promise<void> | null = null;
  skewMs = 0; // server clock minus device clock, from the last response
  onSessionLost: (() => void) | null = null;

  constructor(
    private baseUrl: string,
    private persistence: SessionPersistence,
    private fetchFn: typeof fetch = (...args) => fetch(...args),
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private timeoutMs = 20_000
  ) {}

  hasAccessToken(): boolean {
    return this.accessToken !== null;
  }

  async setSession(response: AuthResponse): Promise<void> {
    this.accessToken = response.accessToken;
    await this.persistence.save({
      refreshToken: response.refreshToken,
      accountId: response.account.id,
      email: response.account.email,
    });
  }

  async clearSession(): Promise<void> {
    this.accessToken = null;
    await this.persistence.clear();
  }

  async call<T>(action: string, body: object = {}, options: CallOptions = {}): Promise<T> {
    const auth = options.auth ?? true;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.once<T>(action, body, auth, options.base);
      } catch (error) {
        const transient = error instanceof ApiError && (error.status === 0 || error.status >= 500);
        if (!options.retry || !transient || attempt >= 2) throw error;
        await this.sleep(400 * 3 ** attempt);
      }
    }
  }

  private async once<T>(action: string, body: object, auth: boolean, base?: string): Promise<T> {
    if (auth && !this.accessToken) await this.refreshOnce();
    let res = await this.send(action, body, auth, base);
    if (res.status === 401 && auth) {
      await this.refreshOnce(); // a single refresh, shared by every request in flight
      res = await this.send(action, body, auth, base);
    }
    return this.parse<T>(res);
  }

  private async send(action: string, body: object, auth: boolean, base?: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (auth && this.accessToken) headers['Authorization'] = `Bearer ${this.accessToken}`;
      return await this.fetchFn(`${base ?? this.baseUrl}/${action}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
        credentials: 'omit',
      });
    } catch {
      throw new ApiError(0, 'network');
    } finally {
      clearTimeout(timer);
    }
  }

  private async parse<T>(res: Response): Promise<T> {
    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      /* empty or not JSON */
    }
    if (typeof data['serverNow'] === 'number') this.skewMs = data['serverNow'] - Date.now();
    if (!res.ok) {
      // xmoney-api answers { error }, xmoney-ai answers { ok: false, code }
      throw new ApiError(res.status, String(data['error'] ?? data['code'] ?? 'error'), data['retryAfterSeconds'] as number | undefined);
    }
    return data as T;
  }

  private refreshOnce(): Promise<void> {
    this.refreshing ??= this.doRefresh().finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  private async doRefresh(): Promise<void> {
    const session = await this.persistence.load();
    if (!session?.refreshToken) {
      this.onSessionLost?.();
      throw new ApiError(401, 'unauthorized');
    }
    // never retried: replaying a rotated refresh token would revoke the session
    const res = await this.send('auth/refresh', { refreshToken: session.refreshToken }, false);
    if (res.status === 401 || res.status === 403) {
      this.accessToken = null;
      await this.persistence.clear(); // local data stays; the user just signs in again
      this.onSessionLost?.();
      throw new ApiError(401, 'session_expired');
    }
    const data = await this.parse<AuthResponse>(res);
    await this.setSession(data);
  }
}

// Adapts the client to what the sync engine needs, mapping failures to SyncError kinds
export class ApiTransport implements SyncTransport {
  constructor(private client: XMoneyApiClient) {}

  private async run<T>(action: string, body: object): Promise<T> {
    try {
      return await this.client.call<T>(action, body, { retry: true });
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.status === 0) throw new SyncError('network');
      if (error.status === 401) throw new SyncError('auth');
      if (error.status === 403) throw new SyncError('forbidden');
      if (error.status === 409) throw new SyncError('outdated');
      if (error.status >= 500 || error.status === 429) throw new SyncError('server');
      throw new SyncError('bad_request', error.code);
    }
  }

  push(ops: WireOp[]) {
    return this.run<{ results: PushResult[] }>('sync/push', { schemaVersion: CLIENT_SCHEMA_VERSION, ops });
  }

  pull(since: number, limit: number) {
    return this.run<{ records: PullRecord[]; hasMore: boolean; cursor: number }>('sync/pull', { since, limit });
  }

  raiseSchema(version: number) {
    return this.run<{ schemaVersion: number }>('sync/meta', { schemaVersion: version });
  }

  meta() {
    return this.run<{ schemaVersion: number; counts: Record<string, number>; serverNow: number }>('sync/meta', {});
  }
}
