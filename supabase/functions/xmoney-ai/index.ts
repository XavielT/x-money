// xmoney-ai: the only door from X Money to an AI provider. Deployed with JWT verification OFF
// (--no-verify-jwt), like xmoney-api: X Money has its own accounts and tokens, checked inside by
// the same rules (see lib/authn.ts). The provider key lives ONLY in the secrets of this function.
import postgres from 'npm:postgres@3.4.5';
import { PgDb, type Exec, type Row } from '../xmoney-api/lib/pg-db.ts';
import { createAnthropicProvider } from './lib/anthropic.ts';
import { createAuthenticator } from './lib/authn.ts';
import { allowedOrigins, corsHeaders } from './lib/cors.ts';
import { createAi } from './lib/handler.ts';
import { MAX_BODY_BYTES } from './lib/limits.ts';
import type { Provider } from './lib/provider.ts';
import { PgAiStore } from './lib/store.ts';

const tokenSecret = Deno.env.get('XMONEY_TOKEN_SECRET') ?? '';
const origins = allowedOrigins(Deno.env.get('XMONEY_ALLOWED_ORIGINS'));

const sql = postgres(Deno.env.get('SUPABASE_DB_URL') ?? '', { max: 3, prepare: false, idle_timeout: 20, connect_timeout: 10 });
const exec: Exec = (text, params) => sql.unsafe(text, params as never[]) as unknown as Promise<Row[]>;
const db = new PgDb(exec, (fn) => sql.begin((tx) => fn((text, params) => tx.unsafe(text, params as never[]) as unknown as Promise<Row[]>)) as never);
const store = new PgAiStore(exec, db);

// Adding another provider: write a `Provider` in lib/ and add its name here (docs/SETUP-XCORE.md)
function providerFor(name: string): Provider | null {
  if (name === 'anthropic') {
    const key = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
    return key ? createAnthropicProvider(key) : null;
  }
  return null;
}

const ai =
  tokenSecret.length >= 32
    ? createAi({
        authenticate: createAuthenticator({ db, tokenSecret, now: () => Date.now(), loadCaps: (id) => store.caps(id) }),
        store,
        provider: providerFor(Deno.env.get('XMONEY_AI_PROVIDER') ?? 'anthropic'),
        models: { fast: Deno.env.get('XMONEY_MODEL_FAST') || null, smart: Deno.env.get('XMONEY_MODEL_SMART') || null },
        now: () => Date.now(),
      })
    : null;

Deno.serve(async (req) => {
  const headers = corsHeaders(req.headers.get('origin'), origins);
  const send = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return send(405, { ok: false, code: 'bad_request', message: 'method_not_allowed' });
  if (!ai) return send(500, { ok: false, code: 'provider_error', message: 'server_misconfigured' });

  const path = new URL(req.url).pathname;
  const marker = '/xmoney-ai/';
  const at = path.indexOf(marker);
  if (at < 0) return send(404, { ok: false, code: 'bad_request', message: 'not_found' });
  const action = path.slice(at + marker.length).replace(/\/+$/, '');

  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return send(413, { ok: false, code: 'bad_request', message: 'too_large' });
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return send(413, { ok: false, code: 'bad_request', message: 'too_large' });

  let body: Record<string, unknown> = {};
  if (text) {
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return send(400, { ok: false, code: 'bad_request', message: 'bad_request' });
      body = parsed;
    } catch {
      return send(400, { ok: false, code: 'bad_request', message: 'bad_request' });
    }
  }

  const result = await ai.handle({ action, body, authorization: req.headers.get('authorization') });
  // Log the action and the outcome only: never the input, the answer, tokens or keys
  console.log(`xmoney-ai ${action} ${result.status} ${String(result.body['code'] ?? 'ok')}`);
  return send(result.status, result.body);
});
