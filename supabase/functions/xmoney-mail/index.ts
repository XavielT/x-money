// xmoney-mail: read-only Gmail connector of smart capture. Deployed with JWT verification OFF
// (--no-verify-jwt), like xmoney-api: X Money has its own accounts and tokens (see xmoney-ai/lib/authn.ts).
// Secrets (docs/SETUP-CAPTURA.md): XMONEY_MAIL_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
// XMONEY_MAIL_REDIRECT (the URL of this function + /callback). None of them ever reaches the client.
import postgres from 'npm:postgres@3.4.5';
import { PgDb, type Exec, type Row } from '../xmoney-api/lib/pg-db.ts';
import { createAuthenticator } from '../xmoney-ai/lib/authn.ts';
import { allowedOrigins, corsHeaders } from '../xmoney-ai/lib/cors.ts';
import { createGmailProvider } from './lib/gmail.ts';
import { createMail } from './lib/handler.ts';
import { PgMailStore } from './lib/store.ts';

const tokenSecret = Deno.env.get('XMONEY_TOKEN_SECRET') ?? '';
const mailKey = Deno.env.get('XMONEY_MAIL_KEY') ?? '';
const clientId = Deno.env.get('GOOGLE_CLIENT_ID') ?? '';
const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';
const redirectUri = Deno.env.get('XMONEY_MAIL_REDIRECT') ?? '';
const origins = allowedOrigins(Deno.env.get('XMONEY_ALLOWED_ORIGINS'));
// where the person lands after Google: pages of the X Money site (docs/SETUP-CAPTURA.md); override with XMONEY_MAIL_DONE_URL
const doneBase = (Deno.env.get('XMONEY_MAIL_DONE_URL') ?? 'https://x-money-site-xavielts-projects.vercel.app').replace(/\/+$/, '');

const sql = postgres(Deno.env.get('SUPABASE_DB_URL') ?? '', { max: 2, prepare: false, idle_timeout: 20, connect_timeout: 10 });
const exec: Exec = (text, params) => sql.unsafe(text, params as never[]) as unknown as Promise<Row[]>;
const db = new PgDb(exec, (fn) => sql.begin((tx) => fn((text, params) => tx.unsafe(text, params as never[]) as unknown as Promise<Row[]>)) as never);

const mail =
  tokenSecret.length >= 32
    ? createMail({
        authenticate: async (header) => {
          const p = await createAuthenticator({ db, tokenSecret, now: () => Date.now(), loadCaps: async () => ({ requestCap: null, tokenCap: null }) })(header);
          return p ? { accountId: p.accountId } : null;
        },
        store: new PgMailStore(exec),
        provider: clientId && clientSecret && redirectUri ? createGmailProvider({ clientId, clientSecret }) : null,
        mailKey,
        redirectUri,
        now: () => Date.now(),
      })
    : null;

Deno.serve(async (req) => {
  const headers = corsHeaders(req.headers.get('origin'), origins);
  const url = new URL(req.url);
  const marker = '/xmoney-mail/';
  const at = url.pathname.indexOf(marker);
  const action = at < 0 ? '' : url.pathname.slice(at + marker.length).replace(/\/+$/, '');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (!mail) return new Response(JSON.stringify({ ok: false, code: 'server_misconfigured' }), { status: 500, headers });
  if (action !== 'callback' && req.method !== 'POST') return new Response(JSON.stringify({ ok: false, code: 'method_not_allowed' }), { status: 405, headers });

  let body: Record<string, unknown> = {};
  if (req.method === 'POST') {
    const text = await req.text();
    if (text.length > 16 * 1024) return new Response(JSON.stringify({ ok: false, code: 'too_large' }), { status: 413, headers });
    try {
      const parsed = text ? JSON.parse(text) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed;
    } catch {
      return new Response(JSON.stringify({ ok: false, code: 'bad_request' }), { status: 400, headers });
    }
  }
  const result = await mail.handle({ action, body, query: url.searchParams, authorization: req.headers.get('authorization') });
  // the log keeps the action and the outcome only: never a message, a token or a key
  console.log(`xmoney-mail ${action} ${result.status} ${String(result.body?.['code'] ?? 'ok')}`);
  if (result.outcome) return new Response(null, { status: 302, headers: { Location: `${doneBase}/mail-${result.outcome}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  if (result.html) return new Response(result.html, { status: result.status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'Referrer-Policy': 'no-referrer' } });
  return new Response(JSON.stringify(result.body), { status: result.status, headers });
});
