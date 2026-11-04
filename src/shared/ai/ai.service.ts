import { Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import { aiUrl } from '../config/app-config';
import { ApiService } from '../services/api.service';
import { AuthService } from '../services/auth.service';
import { StorageService } from '../services/storage.service';
import { TranslateService } from '../services/translate.service';
import { AiGateway, XMoneyAiGateway } from './ai-gateway';
import {
  AI_MODULES,
  AiFailure,
  AiFeatureDef,
  AiLocale,
  AiModule,
  AiPrefs,
  AiRunResult,
  AiServerUsage,
  AiStatus,
  AiWireRequest,
  CAPTURE_DAILY_LIMIT,
  CLIENT_DAILY_LIMIT,
  DEFAULT_AI_PREFS,
  DEFAULT_REQUEST_CAP,
  DEFAULT_TOKEN_CAP,
} from './ai.types';
import { AI_CATALOG } from './catalog';
import { CAPTURE_FEATURE } from './capture-feature';
import { finalizeText } from './output';

export const AI_GATEWAY = new InjectionToken<AiGateway>('AI_GATEWAY', {
  providedIn: 'root',
  factory: () => new XMoneyAiGateway(inject(ApiService).client, aiUrl()),
});

interface CacheEntry {
  at: number;
  output: string;
}

// The one door of the app to AI. Nothing leaves the device unless the general switch is on, the
// module switch is on and the user confirmed the first-use explanation; without a session or
// without a connection every feature just shows its deterministic alternative. No result of AI
// changes data by itself: the caller always gets a suggestion.
@Injectable({ providedIn: 'root' })
export class AiService {
  private gateway = inject(AI_GATEWAY);
  private _prefs = signal<AiPrefs>(DEFAULT_AI_PREFS);
  private _serverUsage = signal<AiServerUsage | null>(null);
  private _limitReached = signal(false);
  private _online = signal(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  private features = new Map<string, AiFeatureDef>();
  private inflight = new Map<string, Promise<AiRunResult>>();
  private cache = new Map<string, CacheEntry>();

  prefs = this._prefs.asReadonly();
  serverUsage = this._serverUsage.asReadonly();

  constructor(
    private storage: StorageService,
    private auth: AuthService,
    private translate: TranslateService
  ) {
    this._prefs.set(this.readPrefs());
    const saved = this.storage.get<Record<string, CacheEntry>>('ai-cache', {});
    for (const [k, v] of Object.entries(saved)) this.cache.set(k, v);
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this._online.set(true));
      window.addEventListener('offline', () => this._online.set(false));
    }
    // the connection test: no module, nothing from the user
    for (const def of AI_CATALOG) this.register(def); // the functions of the modules (2.17.0)
    this.register(CAPTURE_FEATURE); // smart capture (2.18.0): its own switch, outside the module list
    this.register({ id: 'ping', module: null, sends: 'nothing', labelKey: 'Connection test', describeKey: 'Nothing from your data is sent: only a fixed test word.', ttlMs: 0, output: 'plain' });
  }

  // ----- registry of functions (prompt 11 registers the module functions here)

  register(def: AiFeatureDef): void {
    this.features.set(def.id, def);
  }

  registered(): AiFeatureDef[] {
    return [...this.features.values()];
  }

  // ----- state

  caps = computed(() => ({ requests: this._serverUsage()?.requestCap ?? DEFAULT_REQUEST_CAP, tokens: this._serverUsage()?.tokenCap ?? DEFAULT_TOKEN_CAP }));

  // What was used this month: the larger of what this device counted and what the server reports
  // methods, not computeds: the month changes with the clock, which no signal reports
  used(): { requests: number; tokens: number } {
    const local = this._prefs().usage;
    const month = this.monthKey();
    const mine = local.month === month ? local : { requests: 0, tokens: 0 };
    const server = this._serverUsage();
    return { requests: Math.max(mine.requests, server?.requests ?? 0), tokens: Math.max(mine.tokens, server?.tokens ?? 0) };
  }

  usagePercent(): number {
    const c = this.caps();
    const u = this.used();
    return Math.round(Math.max(u.requests / c.requests, u.tokens / c.tokens) * 100);
  }

  // 'warn' from 80 % of the monthly cap, 'full' at 100 %
  usageLevel(): 'ok' | 'warn' | 'full' {
    return this._limitReached() || this.usagePercent() >= 100 ? 'full' : this.usagePercent() >= 80 ? 'warn' : 'ok';
  }

  status(): AiStatus {
    if (!this._prefs().enabled) return 'off';
    if (this.auth.mode() !== 'signed-in') return 'no-session';
    if (!this._online()) return 'offline';
    if (this.usageLevel() === 'full') return 'limit';
    return 'ready';
  }

  // The state of smart capture, independent of the general switch and of the module ones
  captureStatus(): 'off' | 'no-session' | 'offline' | 'capture-limit' | 'limit' | 'ready' {
    const p = this._prefs();
    if (!p.documentsEnabled || !p.documentsConsentAt) return 'off';
    if (this.auth.mode() !== 'signed-in') return 'no-session';
    if (!this._online()) return 'offline';
    if (this.captureToday() >= CAPTURE_DAILY_LIMIT) return 'capture-limit';
    if (this.usageLevel() === 'full') return 'limit';
    return 'ready';
  }

  moduleEnabled(m: AiModule): boolean {
    return !!this._prefs().modules[m];
  }

  isAcknowledged(featureId: string): boolean {
    return this._prefs().acknowledged.includes(featureId);
  }

  // ----- preferences (device only)

  private monthKey(): string {
    return new Date().toISOString().slice(0, 7);
  }

  private dayKey(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private readPrefs(): AiPrefs {
    const saved = this.storage.get<Partial<AiPrefs>>('ai-prefs', {});
    return { ...DEFAULT_AI_PREFS, ...saved, documentsEnabled: !!saved.documentsEnabled && !!saved.documentsConsentAt, modules: { ...(saved.modules ?? {}) }, acknowledged: [...(saved.acknowledged ?? [])], usage: { ...DEFAULT_AI_PREFS.usage, ...(saved.usage ?? {}) } };
  }

  private savePrefs(next: AiPrefs): void {
    this._prefs.set(next);
    this.storage.set('ai-prefs', next);
  }

  setEnabled(on: boolean): void {
    this.savePrefs({ ...this._prefs(), enabled: on });
    if (!on) this._limitReached.set(false);
  }

  setModule(m: AiModule, on: boolean): void {
    if (!AI_MODULES.includes(m)) return;
    this.savePrefs({ ...this._prefs(), modules: { ...this._prefs().modules, [m]: on } });
  }

  // The switch of smart capture. It is independent of the general switch and of the module ones, and it
  // never turns on without the consent being recorded; turning it off withdraws the consent.
  setDocuments(on: boolean): void {
    const p = this._prefs();
    if (on) this.savePrefs({ ...p, documentsEnabled: true, documentsConsentAt: new Date().toISOString() });
    else this.savePrefs({ ...p, documentsEnabled: false, documentsConsentAt: undefined });
  }

  setSkipPreview(on: boolean): void {
    this.savePrefs({ ...this._prefs(), skipPreview: on });
  }

  acknowledge(featureId: string): void {
    if (this.isAcknowledged(featureId)) return;
    this.savePrefs({ ...this._prefs(), acknowledged: [...this._prefs().acknowledged, featureId] });
  }

  private count(tokens: number): void {
    const p = this._prefs();
    const month = this.monthKey();
    const day = this.dayKey();
    const u = p.usage;
    this.savePrefs({
      ...p,
      usage: {
        month,
        requests: (u.month === month ? u.requests : 0) + 1,
        tokens: (u.month === month ? u.tokens : 0) + tokens,
        day,
        dayRequests: (u.day === day ? u.dayRequests : 0) + 1,
        dayCaptures: u.day === day ? u.dayCaptures : 0,
      },
    });
  }

  private countCapture(): void {
    const p = this._prefs();
    const day = this.dayKey();
    this.savePrefs({ ...p, usage: { ...p.usage, day, dayRequests: p.usage.day === day ? p.usage.dayRequests : 0, dayCaptures: (p.usage.day === day ? (p.usage.dayCaptures ?? 0) : 0) + 1 } });
  }

  captureToday(): number {
    const u = this._prefs().usage;
    return u.day === this.dayKey() ? (u.dayCaptures ?? 0) : 0;
  }

  dayRequests(): number {
    const u = this._prefs().usage;
    return u.day === this.dayKey() ? u.dayRequests : 0;
  }

  // ----- cache

  clearCache(): void {
    this.cache.clear();
    this.storage.set('ai-cache', {});
  }

  private persistCache(): void {
    this.storage.set('ai-cache', Object.fromEntries(this.cache));
  }

  private fingerprint(featureId: string, locale: AiLocale, input: unknown): string {
    const text = JSON.stringify([featureId, locale, input], (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return `${featureId}:${(h >>> 0).toString(16)}:${text.length}`;
  }

  // ----- what is sent

  locale(): AiLocale {
    return this.translate.lang() === 'es' ? 'es' : 'en';
  }

  // The exact body that goes to the function (the requestId is added when it is sent)
  preview(featureId: string, input: unknown): Omit<AiWireRequest, 'requestId'> {
    return { feature: featureId, input: input ?? {}, locale: this.locale() };
  }

  // ----- the call

  // `values`: the figures calculated on the device for the {{markers}} of a marked-text feature
  async run(featureId: string, input: unknown, options: { values?: Record<string, string> } = {}): Promise<AiRunResult> {
    const def = this.features.get(featureId);
    if (!def) return { ok: false, code: 'unknown-feature' };
    if (def.sends === 'document') return this.runDocument(def, input);
    const blocked = this.blockedBy(def);
    if (blocked) return { ok: false, code: blocked };

    const locale = this.locale();
    const key = this.fingerprint(featureId, locale, input);
    const hit = this.cache.get(key);
    if (hit && def.ttlMs > 0 && Date.now() - hit.at < def.ttlMs) return this.shape(def, hit.output, true, options.values);

    const pending = this.inflight.get(key); // the same request already travelling: share it
    if (pending) return pending;

    const call = this.send(def, key, locale, input, options.values).finally(() => this.inflight.delete(key));
    this.inflight.set(key, call);
    return call;
  }

  // A document capture (2.18.0): it needs ITS switch with the recorded consent, a session, a connection
  // and room in the daily limit. Never cached (nothing of the document is kept) and never shared between
  // calls: every capture is a separate, explicit send the user asked for.
  private async runDocument(def: AiFeatureDef, input: unknown): Promise<AiRunResult> {
    const p = this._prefs();
    if (!p.documentsEnabled || !p.documentsConsentAt) return { ok: false, code: 'documents-off' };
    if (this.auth.mode() !== 'signed-in') return { ok: false, code: 'no-session' };
    if (!this._online()) return { ok: false, code: 'offline' };
    if (this.captureToday() >= CAPTURE_DAILY_LIMIT) return { ok: false, code: 'capture-limit' };
    if (this.usageLevel() === 'full') return { ok: false, code: 'limit' };
    const result = await this.gateway.run({ feature: def.id, input, locale: this.locale(), requestId: crypto.randomUUID() });
    if (!result.ok) {
      if (result.code === 'quota') this._limitReached.set(true);
      if (result.code === 'daily_limit') return { ok: false, code: 'capture-limit' };
      if (result.code === 'invalid_output') return { ok: false, code: 'invalid-output' };
      return { ok: false, code: result.code };
    }
    this.count(result.usage.inputTokens + result.usage.outputTokens);
    this.countCapture();
    return { ok: true, text: result.output, raw: result.output, fromCache: false };
  }

  // The reasons nothing may be sent, in order. Nothing here touches the network.
  private blockedBy(def: AiFeatureDef): AiFailure | null {
    if (!this._prefs().enabled) return 'off';
    if (def.module && !this.moduleEnabled(def.module)) return 'module-off';
    if (!this.isAcknowledged(def.id)) return 'consent-needed';
    if (this.auth.mode() !== 'signed-in') return 'no-session';
    if (!this._online()) return 'offline';
    if (this.dayRequests() >= CLIENT_DAILY_LIMIT) return 'client-limit';
    if (this.usageLevel() === 'full') return 'limit';
    return null;
  }

  private async send(def: AiFeatureDef, key: string, locale: AiLocale, input: unknown, values?: Record<string, string>): Promise<AiRunResult> {
    const result = await this.gateway.run({ feature: def.id, input: input ?? {}, locale, requestId: crypto.randomUUID() });
    if (!result.ok) {
      if (result.code === 'quota') this._limitReached.set(true);
      return { ok: false, code: result.code };
    }
    this.count(result.usage.inputTokens + result.usage.outputTokens);
    if (def.ttlMs > 0) {
      this.cache.set(key, { at: Date.now(), output: result.output });
      this.persistCache();
    }
    return this.shape(def, result.output, false, values);
  }

  // marked-text goes through the validator and the substitution; nothing else reaches the screen
  private shape(def: AiFeatureDef, raw: string, fromCache: boolean, values?: Record<string, string>): AiRunResult {
    if (def.output === 'plain') return { ok: true, text: raw, raw, fromCache };
    const checked = finalizeText(raw, values ?? {});
    return checked.ok ? { ok: true, text: checked.text, raw, fromCache } : { ok: false, code: 'invalid-output' };
  }

  // ----- usage on the server (the user's own usage)

  async refreshUsage(): Promise<boolean> {
    if (this.auth.mode() !== 'signed-in' || !this._online()) return false;
    const r = await this.gateway.usage();
    if (!r.ok) return false;
    this._serverUsage.set(r.usage);
    this._limitReached.set(r.usage.requests >= r.usage.requestCap || r.usage.tokens >= r.usage.tokenCap);
    return true;
  }

  // ----- messages

  messageOf(code: AiFailure): string {
    const key = MESSAGES[code] ?? MESSAGES.provider_error;
    return this.translate.instant(key);
  }
}

const MESSAGES: Record<AiFailure, string> = {
  off: 'Artificial intelligence is off. Turn it on in Settings.',
  'module-off': 'This module has AI turned off in Settings.',
  'consent-needed': 'Confirm first what will be sent.',
  'no-session': 'Sign in to use AI.',
  offline: 'No connection. The normal functions keep working.',
  'client-limit': 'You reached the daily AI limit on this device. The normal functions keep working.',
  limit: 'You reached the limit for the month; the normal functions keep working the same.',
  quota: 'You reached the limit for the month; the normal functions keep working the same.',
  rate_limited: 'Too many requests in a row. Try again in a minute.',
  timeout: 'The AI service took too long. Try again later.',
  provider_error: 'The AI service is not available right now.',
  bad_request: 'The AI request was not valid.',
  unauthorized: 'AI is not enabled for this account.',
  'invalid-output': 'The AI text was discarded because it contained figures. The calculated summary is shown instead.',
  'unknown-feature': 'This AI function does not exist.',
  'documents-off': 'Smart capture is off. Turn it on in Settings.',
  'capture-limit': 'You reached the daily limit of captures. You can still enter the movement by hand.',
  daily_limit: 'You reached the daily limit of captures. You can still enter the movement by hand.',
  invalid_output: 'The document could not be read in the expected shape. Enter it by hand.',
};
