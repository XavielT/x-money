// Prompt 10 (v2.16.0): the single AI layer. Nothing here calls a real provider: the gateway is a
// fake or a client over a simulated fetch. What is proven: nothing leaves with the switch off, the
// minimizer never lets identifying data through, figures only come from the device, and every
// failure falls back to the deterministic alternative.
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { afterEach, beforeEach, vi } from 'vitest';
import { ApiError, SessionPersistence, XMoneyApiClient } from '../data-layer/api-client';
import { DEVICE_ONLY_KEYS, isSyncedKey } from '../data-layer/registry';
import { BACKUP_KEYS } from '../data-layer/backup';
import { aiUrl } from '../config/app-config';
import { AuthService } from '../services/auth.service';
import { StorageService } from '../services/storage.service';
import { MemoryStorage } from '../testing/memory-storage';
import { AI_GATEWAY, AiService } from './ai.service';
import { AiGateway, GatewayResult, GatewayUsage, XMoneyAiGateway, failureOf } from './ai-gateway';
import { AiFeatureDef, AiWireRequest, CLIENT_DAILY_LIMIT, DEFAULT_AI_PREFS } from './ai.types';
import { MAX_CATEGORIES, MinimizerContext, minimize, safeLabel, scrubNote } from './minimizer';
import { finalizeText, findMarkers, substituteMarkers, validateOutput } from './output';

// ----- the minimizer: nothing identifying gets through

function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('AiMinimizer', () => {
  it('property: with random account names, banks, last 4 digits, ids and people, none of them appears in the output', () => {
    const rnd = prng(20261104);
    const hex = (n: number) => Array.from({ length: n }, () => Math.floor(rnd() * 16).toString(16)).join('');
    const uuid = () => `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`;
    for (let i = 0; i < 300; i++) {
      const accountNames = [`Zorvex${i} Nomina`, `Quilmar${i}`];
      const bankNames = [`Banco Tarkan${i}`, `Coop Velmora${i}`];
      const personNames = [`Mauricio Brelzan${i}`];
      const last4 = [String(1000 + Math.floor(rnd() * 9000)), String(1000 + Math.floor(rnd() * 9000))];
      const ids = [uuid(), uuid(), `acc-${hex(6)}`];
      const ctx: MinimizerContext = { accountNames, bankNames, knownIds: ids, personNames };
      const out = minimize(
        {
          figures: { income_month: 52000.456, 'Bad Key': 5, expenses_month: 31000 },
          counts: { movements: 41.6 },
          series: { expenses_by_month: [1, 2, 3, NaN, 4] },
          categories: [
            { name: 'Food', total: 8000 },
            { name: 'Transport', total: 3000 },
            { name: `${bankNames[0]} ${last4[0]}`, total: 500 },
            { name: `Pago ${accountNames[0]}`, total: 700 },
            { name: `Transfer to ${personNames[0]}`, total: 900 },
            { name: ids[0], total: 11 },
            { name: `Visa terminada en ${last4[1]}`, total: 12 },
            { name: `x${last4[1]}`, total: 13 },
            { name: `${ids[2]}`, total: 14 },
            { name: 'maria@example.com', total: 15 },
          ],
        },
        ctx
      );
      const strings = [...Object.keys(out.figures), ...Object.keys(out.counts), ...Object.keys(out.series), ...out.categories.map((c) => c.name), ...out.placeholders];
      const forbidden = [...accountNames, ...bankNames, ...personNames, ...ids, ...last4, 'maria@example.com'].map((x) => x.toLowerCase());
      for (const s of strings) for (const f of forbidden) expect(s.toLowerCase()).not.toContain(f);
      // the useful labels survive and what had to go became "Other", added together
      expect(out.categories.map((c) => c.name)).toEqual(expect.arrayContaining(['Food', 'Transport', 'Other']));
      expect(out.categories.find((c) => c.name === 'Other')!.total).toBe(500 + 700 + 900 + 11 + 12 + 13 + 14 + 15);
    }
  });

  it('keeps only snake_case keys, rounds figures to cents, drops NaN, caps series and categories, and offers its keys as placeholders', () => {
    const out = minimize(
      { figures: { income_month: 52000.456, 'Bad Key': 5, nan_value: NaN, '9start': 1 }, counts: { movements: 41.6, neg: -3 }, series: { s: Array.from({ length: 40 }, (_, i) => i), 'Bad-Key': [1] }, categories: Array.from({ length: 30 }, (_, i) => ({ name: `Cat${String.fromCharCode(97 + (i % 26))}x${i}`, total: i })) },
      { accountNames: [], bankNames: [], knownIds: [] }
    );
    expect(out.figures).toEqual({ income_month: 52000.46 });
    expect(out.placeholders).toEqual(['income_month']);
    expect(out.counts).toEqual({ movements: 42, neg: 0 });
    expect(out.series['s']).toHaveLength(24);
    expect(out.series['s'][23]).toBe(39);
    expect(Object.keys(out.series)).toEqual(['s']);
    expect(out.categories).toHaveLength(MAX_CATEGORIES);
    expect(out.categories[0].total).toBeGreaterThanOrEqual(out.categories[1].total);
  });

  it('a label with a name of the user, digits of a card or an id becomes "Other"; plain labels stay', () => {
    const ctx: MinimizerContext = { accountNames: ['Nomina Joel'], bankNames: ['Popular'], knownIds: [], personNames: ['Ana'] };
    expect(safeLabel('Groceries', ctx)).toBe('Other'.replace('Other', 'Groceries'));
    for (const bad of ['Pago Nomina Joel', 'banco popular', 'Prestamo de Ana', 'Visa 4242', 'Ref 1234567', '', '   ']) expect(safeLabel(bad, ctx)).toBe('Other');
  });

  it('the text of a note (the one exception) loses emails, ids, card digits, long numbers and the names of the user accounts and banks', () => {
    const ctx: MinimizerContext = { accountNames: ['Nomina Joel'], bankNames: ['BancoX'], knownIds: ['acc-12ab'], personNames: [] };
    const out = scrubNote('Pago tarjeta terminada en 4242 de Nomina Joel en BancoX ref 123456789 a ana@mail.com id acc-12ab 3f2504e0-4f89-11d3-9a0c-0305e82c3301 Uber', ctx);
    expect(out).toBe('Pago tarjeta de en ref a id Uber');
    for (const gone of ['4242', 'Nomina Joel', 'BancoX', '123456789', 'ana@mail.com', 'acc-12ab', '3f2504e0']) expect(out).not.toContain(gone);
    expect(scrubNote('x'.repeat(500), ctx)).toHaveLength(200);
  });
});

// ----- the output validator and the markers

describe('output validation: the figures come from the device, never from the model', () => {
  const allowed = new Set(['income_month', 'expense_change', 'top_category']);

  it('accepts text with offered markers (spaces inside the braces allowed) and small plain numbers', () => {
    expect(validateOutput('Tu ingreso del mes fue {{income_month}} y {{ expense_change }}. Fueron 3 meses estables.', allowed)).toEqual({ ok: true, text: 'Tu ingreso del mes fue {{income_month}} y {{ expense_change }}. Fueron 3 meses estables.' });
    expect(findMarkers('{{a}} y {{ b_2 }} y {{X}}')).toEqual(['a', 'b_2']);
  });

  it('rejects an unknown marker, an empty text, money, percentages and large numbers, in Spanish and English', () => {
    const reason = (t: string) => {
      const r = validateOutput(t, allowed);
      return r.ok ? 'ok' : r.reason;
    };
    expect(reason('   ')).toBe('empty');
    expect(reason('Gastaste {{secret_number}}')).toBe('unknown-marker');
    for (const money of ['Gastaste RD$5,000', 'Gastaste RD$ 5000', 'You spent $ 500', 'You spent $500', 'Gastaste 5 000 pesos', 'ganaste 300 dólares', 'about 300 dollars', 'US$300', 'USD 20', '1500 DOP', '€20']) expect(reason(money)).toBe('money');
    for (const pct of ['Subió 15%', 'Subió 15 %', 'rose 12.5 percent', 'subió 8 por ciento']) expect(['percent', 'number']).toContain(reason(pct));
    for (const num of ['Fueron 1,500 movimientos', 'Fueron 1.500 movimientos', 'Un total de 12345', 'promedio 12.5', 'Gastaste 8,50']) expect(reason(num)).toBe('number');
    expect(reason('Subió 15%')).toBe('percent');
  });

  it('a marker is not confused with a figure, and figures in the values are never validated (they are ours)', () => {
    expect(validateOutput('{{income_month}}', allowed).ok).toBe(true);
    const out = finalizeText('Tu ingreso fue {{income_month}} ({{expense_change}} sobre el mes pasado).', { income_month: 'RD$52,000.00', expense_change: '12.5%' });
    expect(out).toEqual({ ok: true, text: 'Tu ingreso fue RD$52,000.00 (12.5% sobre el mes pasado).' });
  });

  it('substitution fails (null) when a marker has no value; it never leaves a blank or a {{marker}} on screen', () => {
    expect(substituteMarkers('a {{x}} b {{y}}', { x: '1' })).toBeNull();
    expect(substituteMarkers('a {{x}} b {{x}}', { x: '1' })).toBe('a 1 b 1');
    expect(substituteMarkers('sin marcadores', {})).toBe('sin marcadores');
    expect(finalizeText('Hola {{nope}}', { x: '1' })).toEqual({ ok: false, reason: 'unknown-marker' });
    expect(finalizeText('Gastaste RD$99 y {{x}}', { x: '1' })).toEqual({ ok: false, reason: 'money' });
  });
});

// ----- the gateway: mapping of failures with a simulated fetch

describe('XMoneyAiGateway', () => {
  const BASE = 'https://p.supabase.co/functions/v1/xmoney-ai';
  const API = 'https://p.supabase.co/functions/v1/xmoney-api';
  const wire: AiWireRequest = { feature: 'ping', input: {}, locale: 'en', requestId: 'r1' };

  function setup(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
    const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
    const persistence: SessionPersistence = { load: async () => ({ refreshToken: 'r', accountId: 'a', email: 'e' }), save: async () => undefined, clear: async () => undefined, deviceId: async () => 'd' };
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(init.body as string) : null });
      return handler(url, init);
    }) as unknown as typeof fetch;
    const client = new XMoneyApiClient(API, persistence, fetchFn, async () => undefined);
    return { gateway: new XMoneyAiGateway(client, BASE), client, calls };
  }
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const withToken = async (c: XMoneyApiClient) => c.setSession({ accessToken: 'tok', refreshToken: 'r', sessionId: 's', account: { id: 'a', email: 'e' }, serverNow: Date.now() });

  it('posts to the AI function (not to xmoney-api) with the same bearer token, exactly once', async () => {
    const { gateway, client, calls } = setup(() => json(200, { ok: true, output: 'pong', usage: { inputTokens: 3, outputTokens: 1 }, model: 'm', requestId: 'r1' }));
    await withToken(client);
    expect(await gateway.run(wire)).toEqual({ ok: true, output: 'pong', usage: { inputTokens: 3, outputTokens: 1 }, model: 'm', requestId: 'r1' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/run`);
    expect(calls[0].headers['Authorization']).toBe('Bearer tok');
    expect(calls[0].body).toEqual(wire);
  });

  it('maps each failure to a code the screens understand, and never retries a call that costs money', async () => {
    const cases: [number, Record<string, unknown>, string][] = [
      [403, { ok: false, code: 'unauthorized' }, 'unauthorized'],
      [429, { ok: false, code: 'quota' }, 'quota'],
      [429, { ok: false, code: 'rate_limited' }, 'rate_limited'],
      [504, { ok: false, code: 'timeout' }, 'timeout'],
      [502, { ok: false, code: 'provider_error' }, 'provider_error'],
      [500, { ok: false, code: 'provider_error' }, 'provider_error'],
      [400, { ok: false, code: 'bad_request' }, 'bad_request'],
      [413, { ok: false, code: 'bad_request' }, 'bad_request'],
    ];
    for (const [status, body, code] of cases) {
      const { gateway, client, calls } = setup(() => json(status, body));
      await withToken(client);
      expect(await gateway.run(wire)).toEqual({ ok: false, code });
      expect(calls).toHaveLength(1);
    }
  });

  it('no connection is "offline"; an expired session (401 and the refresh fails) is "no-session"', async () => {
    const off = setup(() => {
      throw new Error('down');
    });
    await withToken(off.client);
    expect(await off.gateway.run(wire)).toEqual({ ok: false, code: 'offline' });
    const expired = setup((url) => json(401, { error: url.endsWith('auth/refresh') ? 'unauthorized' : 'unauthorized' }));
    await withToken(expired.client);
    expect(await expired.gateway.run(wire)).toEqual({ ok: false, code: 'no-session' });
  });

  it('the usage action returns the caps and the counts', async () => {
    const { gateway, client, calls } = setup(() => json(200, { ok: true, requests: 12, tokens: 3400, requestCap: 300, tokenCap: 400000, month: '2026-11' }));
    await withToken(client);
    expect(await gateway.usage()).toEqual({ ok: true, usage: { requests: 12, tokens: 3400, requestCap: 300, tokenCap: 400000, month: '2026-11' } });
    expect(calls[0].url).toBe(`${BASE}/usage`);
  });

  it('failureOf: a foreign error is a provider error, and the AI URL is derived from the API one', () => {
    expect(failureOf(new Error('x'))).toBe('provider_error');
    expect(failureOf(new ApiError(0, 'network'))).toBe('offline');
    expect(failureOf(new ApiError(401, 'session_expired'))).toBe('no-session');
    expect(aiUrl('https://p.supabase.co/functions/v1/xmoney-api')).toBe(BASE);
    expect(aiUrl('https://p.supabase.co/functions/v1/xmoney-api///')).toBe(BASE);
  });
});

// ----- AiService

class FakeGateway implements AiGateway {
  calls: AiWireRequest[] = [];
  next: () => Promise<GatewayResult> = async () => ({ ok: true, output: 'pong', usage: { inputTokens: 10, outputTokens: 2 }, model: 'm', requestId: 'x' });
  usageReply: GatewayUsage = { ok: true, usage: { requests: 0, tokens: 0, requestCap: 300, tokenCap: 400000, month: '2026-11' } };
  run(request: AiWireRequest) {
    this.calls.push(request);
    return this.next();
  }
  async usage() {
    return this.usageReply;
  }
}

const NOTE: AiFeatureDef = { id: 'note-test', module: 'expenses', sends: 'note-text', labelKey: 'Note test', describeKey: 'x', ttlMs: 60_000, output: 'plain' };
const NARRATION: AiFeatureDef = { id: 'narration-test', module: 'dashboard', sends: 'aggregates', labelKey: 'Narration test', describeKey: 'x', ttlMs: 0, output: 'marked-text' };

describe('AiService', () => {
  let gateway: FakeGateway;
  let storage: MemoryStorage;
  let mode: ReturnType<typeof signal<string>>;

  function service(): AiService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: StorageService, useValue: storage as unknown as StorageService },
        { provide: AuthService, useValue: { mode } },
        { provide: AI_GATEWAY, useValue: gateway },
      ],
    });
    const s = TestBed.inject(AiService);
    s.register(NOTE);
    s.register(NARRATION);
    return s;
  }
  const ready = (s: AiService, ...ids: string[]) => {
    s.setEnabled(true);
    s.setModule('expenses', true);
    s.setModule('dashboard', true);
    for (const id of ['ping', ...ids]) s.acknowledge(id);
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-20T12:00:00'));
    gateway = new FakeGateway();
    storage = new MemoryStorage();
    mode = signal('signed-in');
  });
  afterEach(() => {
    vi.useRealTimers();
    window.dispatchEvent(new Event('online'));
  });

  it('with the switch OFF (the default) nothing is sent, whatever the feature', async () => {
    const s = service();
    expect(s.prefs()).toEqual(DEFAULT_AI_PREFS);
    expect(s.status()).toBe('off');
    for (const id of ['ping', 'note-test', 'narration-test']) expect(await s.run(id, { a: 1 })).toEqual({ ok: false, code: 'off' });
    expect(gateway.calls).toHaveLength(0);
  });

  it('turning it off again stops every call at once', async () => {
    const s = service();
    ready(s);
    expect((await s.run('ping', {})).ok).toBe(true);
    s.setEnabled(false);
    expect(await s.run('ping', {})).toEqual({ ok: false, code: 'off' });
    expect(gateway.calls).toHaveLength(1);
  });

  it('with no real fetch involved either: a real gateway over a spied fetch is never touched while it is off', async () => {
    const spy = vi.fn(async () => new Response('{}'));
    const persistence: SessionPersistence = { load: async () => null, save: async () => undefined, clear: async () => undefined, deviceId: async () => 'd' };
    gateway = new XMoneyAiGateway(new XMoneyApiClient('https://x/xmoney-api', persistence, spy as unknown as typeof fetch), 'https://x/xmoney-ai') as unknown as FakeGateway;
    const s = service();
    await s.run('ping', {});
    await s.run('note-test', 'Uber');
    expect(spy).not.toHaveBeenCalled();
  });

  it('a module switch is needed, and the first use asks for consent before anything is sent', async () => {
    const s = service();
    s.setEnabled(true);
    expect(await s.run('note-test', 'Uber')).toEqual({ ok: false, code: 'module-off' });
    s.setModule('expenses', true);
    expect(await s.run('note-test', 'Uber')).toEqual({ ok: false, code: 'consent-needed' });
    expect(gateway.calls).toHaveLength(0);
    s.acknowledge('note-test');
    expect((await s.run('note-test', 'Uber')).ok).toBe(true);
    expect(gateway.calls).toHaveLength(1);
    // the consent survives a restart (device only)
    expect(service().isAcknowledged('note-test')).toBe(true);
  });

  it('what the preview shows is exactly what the gateway receives (plus the requestId)', async () => {
    const s = service();
    ready(s, 'note-test');
    const preview = s.preview('note-test', 'Uber a casa');
    await s.run('note-test', 'Uber a casa');
    const { requestId, ...sent } = gateway.calls[0];
    expect(sent).toEqual(preview);
    expect(requestId).toBeTruthy();
    expect(preview.locale).toBe('en');
  });

  it('without a session or without a connection nothing is sent and the status says why', async () => {
    const s = service();
    ready(s);
    mode.set('signed-out');
    expect(s.status()).toBe('no-session');
    expect(await s.run('ping', {})).toEqual({ ok: false, code: 'no-session' });
    mode.set('local');
    expect(await s.run('ping', {})).toEqual({ ok: false, code: 'no-session' });
    mode.set('signed-in');
    window.dispatchEvent(new Event('offline'));
    expect(s.status()).toBe('offline');
    expect(await s.run('ping', {})).toEqual({ ok: false, code: 'offline' });
    window.dispatchEvent(new Event('online'));
    expect(gateway.calls).toHaveLength(0);
    expect(s.status()).toBe('ready');
  });

  it('caches by the fingerprint of the input (key order does not matter), with a TTL, and the cache can be cleared', async () => {
    const s = service();
    ready(s, 'note-test');
    gateway.next = async () => ({ ok: true, output: 'Transport', usage: { inputTokens: 5, outputTokens: 1 }, model: 'm', requestId: 'x' });
    const a = await s.run('note-test', { b: 2, a: 1 });
    const b = await s.run('note-test', { a: 1, b: 2 });
    expect(a).toMatchObject({ ok: true, fromCache: false });
    expect(b).toMatchObject({ ok: true, fromCache: true, text: 'Transport' });
    expect(gateway.calls).toHaveLength(1);
    await s.run('note-test', { a: 9 });
    expect(gateway.calls).toHaveLength(2);
    vi.setSystemTime(new Date('2026-11-20T12:02:00')); // past the 60 s TTL
    expect(await s.run('note-test', { a: 1, b: 2 })).toMatchObject({ fromCache: false });
    expect(gateway.calls).toHaveLength(3);
    // persisted on the device, and clearable
    expect(service().run('note-test', { a: 1, b: 2 })).resolves.toMatchObject({ fromCache: true });
    const again = service();
    again.clearCache();
    expect(await again.run('note-test', { a: 1, b: 2 })).toMatchObject({ fromCache: false });
  });

  it('the same request in flight is shared: two simultaneous calls travel once', async () => {
    const s = service();
    ready(s, 'note-test');
    let release!: () => void;
    gateway.next = () => new Promise((r) => (release = () => r({ ok: true, output: 'Food', usage: { inputTokens: 1, outputTokens: 1 }, model: 'm', requestId: 'x' })));
    const first = s.run('note-test', 'Super');
    const second = s.run('note-test', 'Super');
    release();
    expect(await first).toEqual(await second);
    expect(gateway.calls).toHaveLength(1);
  });

  it('the daily limit of this device (30) stops the 31st call without touching the network', async () => {
    const s = service();
    ready(s, 'note-test');
    for (let i = 0; i < CLIENT_DAILY_LIMIT; i++) expect((await s.run('note-test', `n${i}`)).ok).toBe(true);
    expect(await s.run('note-test', 'one more')).toEqual({ ok: false, code: 'client-limit' });
    expect(gateway.calls).toHaveLength(CLIENT_DAILY_LIMIT);
    vi.setSystemTime(new Date('2026-11-21T12:00:00')); // a new day
    expect((await s.run('note-test', 'tomorrow')).ok).toBe(true);
  });

  it('server failures come back as codes, and the monthly quota blocks further calls without a request until it is refreshed', async () => {
    const s = service();
    ready(s, 'note-test');
    for (const code of ['unauthorized', 'rate_limited', 'timeout', 'provider_error', 'bad_request'] as const) {
      gateway.next = async () => ({ ok: false, code });
      expect(await s.run('note-test', code)).toEqual({ ok: false, code });
    }
    gateway.next = async () => ({ ok: false, code: 'quota' });
    expect(await s.run('note-test', 'q')).toEqual({ ok: false, code: 'quota' });
    const calls = gateway.calls.length;
    expect(await s.run('note-test', 'q2')).toEqual({ ok: false, code: 'limit' });
    expect(gateway.calls).toHaveLength(calls);
    expect(s.status()).toBe('limit');
    expect(s.usageLevel()).toBe('full');
    expect(s.messageOf('limit')).toContain('the normal functions keep working');
    // a new month on the server: refreshing the use lifts the block
    gateway.usageReply = { ok: true, usage: { requests: 1, tokens: 10, requestCap: 300, tokenCap: 400000, month: '2026-12' } };
    expect(await s.refreshUsage()).toBe(true);
    expect(s.status()).toBe('ready');
  });

  it('warns at 80 % of the month (by requests or by tokens) and blocks at 100 %', async () => {
    const s = service();
    ready(s);
    expect(s.usageLevel()).toBe('ok');
    gateway.usageReply = { ok: true, usage: { requests: 240, tokens: 0, requestCap: 300, tokenCap: 400000, month: '2026-11' } };
    await s.refreshUsage();
    expect(s.usagePercent()).toBe(80);
    expect(s.usageLevel()).toBe('warn');
    expect(s.status()).toBe('ready');
    gateway.usageReply = { ok: true, usage: { requests: 10, tokens: 400000, requestCap: 300, tokenCap: 400000, month: '2026-11' } };
    await s.refreshUsage();
    expect(s.usageLevel()).toBe('full');
    expect(await s.run('ping', {})).toEqual({ ok: false, code: 'limit' });
  });

  it('counts requests and tokens on the device and resets them with the month', async () => {
    const s = service();
    ready(s, 'note-test');
    await s.run('note-test', 'a');
    await s.run('note-test', 'b');
    expect(s.used()).toEqual({ requests: 2, tokens: 24 });
    expect(s.dayRequests()).toBe(2);
    vi.setSystemTime(new Date('2026-12-02T12:00:00'));
    expect(s.used()).toEqual({ requests: 0, tokens: 0 });
  });

  it('marked-text: the figures are substituted from the device, and text with figures of the model is never shown', async () => {
    const s = service();
    ready(s, 'narration-test');
    gateway.next = async () => ({ ok: true, output: 'Tu ingreso del mes fue {{income_month}}.', usage: { inputTokens: 1, outputTokens: 1 }, model: 'm', requestId: 'x' });
    expect(await s.run('narration-test', { n: 1 }, { values: { income_month: 'RD$52,000.00' } })).toMatchObject({ ok: true, text: 'Tu ingreso del mes fue RD$52,000.00.' });
    for (const bad of ['Tu ingreso fue RD$52,000', 'Subió 15%', 'Dice {{inventado}}', 'Fueron 12345']) {
      gateway.next = async () => ({ ok: true, output: bad, usage: { inputTokens: 1, outputTokens: 1 }, model: 'm', requestId: 'x' });
      expect(await s.run('narration-test', { n: bad }, { values: { income_month: 'RD$1.00' } })).toEqual({ ok: false, code: 'invalid-output' });
    }
    expect(s.messageOf('invalid-output')).toContain('calculated summary');
  });

  it('an unknown function is refused, and the second switch (documents) is only on with its recorded consent', async () => {
    const s = service();
    expect(await s.run('nothing', {})).toEqual({ ok: false, code: 'unknown-feature' });
    storage.set('ai-prefs', { ...DEFAULT_AI_PREFS, enabled: true, documentsEnabled: true });
    expect(service().prefs().documentsEnabled).toBe(false); // a saved flag with no consent date does not count
    storage.set('ai-prefs', { ...DEFAULT_AI_PREFS, enabled: true, documentsEnabled: true, documentsConsentAt: '2026-11-04T10:00:00.000Z' });
    expect(service().prefs().documentsEnabled).toBe(true);
    expect(service().prefs().enabled).toBe(true);
  });

  it('every failure has a bilingual-ready message and the preferences are device-only (never synced, never in a backup)', () => {
    const s = service();
    for (const code of ['off', 'module-off', 'consent-needed', 'no-session', 'offline', 'client-limit', 'limit', 'quota', 'rate_limited', 'timeout', 'provider_error', 'bad_request', 'unauthorized', 'invalid-output', 'unknown-feature', 'documents-off', 'capture-limit', 'daily_limit', 'invalid_output'] as const) expect(s.messageOf(code).length).toBeGreaterThan(10);
    for (const k of ['ai-prefs', 'ai-cache', 'capture-queue', 'capture-originals', 'capture-prefs']) {
      expect(DEVICE_ONLY_KEYS).toContain(k);
      expect(isSyncedKey(k)).toBe(false);
      expect((BACKUP_KEYS as readonly string[]).includes(k)).toBe(false);
    }
  });
});
