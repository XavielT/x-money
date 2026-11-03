// xmoney-api: the only door to the `xmoney` schema. Deployed with JWT verification
// OFF (--no-verify-jwt) because X Money has its own accounts and tokens, see
// docs/SETUP-XCORE.md for why that is safe and what mitigates it.
import postgres from 'npm:postgres@3.4.5';
import { createApi } from './lib/api.ts';
import { PgDb, type Exec, type Row } from './lib/pg-db.ts';
import { MAX_BODY_BYTES } from './lib/validate.ts';

const tokenSecret = Deno.env.get('XMONEY_TOKEN_SECRET') ?? '';
const signupCode = Deno.env.get('XMONEY_SIGNUP_CODE') || null; // unset = signup disabled
const allowedOrigins = new Set([
  'capacitor://localhost',
  'https://localhost',
  'http://localhost:4200',
  'http://localhost:4300',
  ...(Deno.env.get('XMONEY_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
]);

// Direct connection: the xmoney schema is not exposed through PostgREST on purpose.
const sql = postgres(Deno.env.get('SUPABASE_DB_URL') ?? '', {
  max: 3,
  prepare: false, // works behind the transaction pooler
  idle_timeout: 20,
  connect_timeout: 10,
});
const exec: Exec = (text, params) => sql.unsafe(text, params as never[]) as unknown as Promise<Row[]>;
const db = new PgDb(exec, (fn) =>
  sql.begin((tx) => fn((text, params) => tx.unsafe(text, params as never[]) as unknown as Promise<Row[]>)) as never
);

const api = tokenSecret.length >= 32 ? createApi({ db, tokenSecret, signupCode, now: () => Date.now() }) : null;

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
  if (origin && allowedOrigins.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Headers'] = 'authorization, content-type';
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Max-Age'] = '600';
  }
  return headers;
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req.headers.get('origin'));
  const send = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return send(405, { error: 'method_not_allowed' });
  if (!api) return send(500, { error: 'server_misconfigured' }); // secret missing or shorter than 32 bytes

  const path = new URL(req.url).pathname;
  const marker = '/xmoney-api/';
  const at = path.indexOf(marker);
  if (at < 0) return send(404, { error: 'not_found' });
  const action = path.slice(at + marker.length).replace(/\/+$/, '');

  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return send(413, { error: 'too_large' });
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return send(413, { error: 'too_large' });

  let body: Record<string, unknown> = {};
  if (text) {
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return send(400, { error: 'bad_request' });
      body = parsed;
    } catch {
      return send(400, { error: 'bad_request' });
    }
  }

  const ip =
    req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  const result = await api.handle({ action, body, ip, authorization: req.headers.get('authorization') });
  // Log the action and status only: never bodies, tokens, passwords or recovery codes
  console.log(`xmoney-api ${action} ${result.status}`);
  return send(result.status, result.body);
});
