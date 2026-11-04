// xmoney-mail: the contract of the mail connector. Pure logic (no Deno imports): the provider, the
// store and the authenticator are injected, so the tests run with no network and no database.
//
//   start      (POST, session)  { }                      -> { ok, url }          the Google consent URL (PKCE)
//   callback   (GET, from Google) ?code&state            -> an HTML page         stores the encrypted refresh token
//   status     (POST, session)  { }                      -> { ok, connected, email, lastReadAt }
//   scan       (POST, session)  { filter, includePdf }   -> { ok, messages[], skipped }   reduced text, no storage
//   disconnect (POST, session)  { }                      -> { ok }               revokes at Google and deletes the token
//
// The function READS mail and hands back reduced text; the drafts are made on the device through the
// same AI gate as every other capture. It never stores a message and logs only the action + outcome.
import { open, seal, challengeOf, newVerifier } from './seal.ts';
import { buildQuery, cleanFilter, reduceBody, senderMatches } from './mail-text.ts';
import type { MailProvider } from './provider.ts';
import type { MailStore } from './store.ts';

export interface MailPrincipal {
  accountId: string;
}

export interface MailDeps {
  authenticate: (authorization: string | null) => Promise<MailPrincipal | null>;
  store: MailStore;
  provider: MailProvider | null; // null = not configured (no Google secrets yet)
  mailKey: string; // XMONEY_MAIL_KEY
  redirectUri: string;
  now: () => number;
}

export interface MailRequest {
  action: string;
  body: Record<string, unknown>;
  query: URLSearchParams;
  authorization: string | null;
}

export interface MailResponse {
  status: number;
  body?: Record<string, unknown>;
  html?: string;
}

export const MAX_SCAN = 30;
export const STATE_TTL_MS = 10 * 60 * 1000;

const fail = (status: number, code: string): MailResponse => ({ status, body: { ok: false, code } });

const page = (title: string, text: string): MailResponse => ({
  status: 200,
  html: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:system-ui;max-width:28rem;margin:3rem auto;padding:0 1rem"><h1 style="font-size:1.2rem">${title}</h1><p>${text}</p></body>`,
});

export function createMail(deps: MailDeps) {
  async function start(p: MailPrincipal): Promise<MailResponse> {
    if (!deps.provider || deps.mailKey.length < 32) return fail(501, 'not_configured');
    const verifier = newVerifier();
    const state = await seal(JSON.stringify({ a: p.accountId, v: verifier, e: deps.now() + STATE_TTL_MS }), deps.mailKey);
    return { status: 200, body: { ok: true, url: deps.provider.authUrl({ redirectUri: deps.redirectUri, state, challenge: await challengeOf(verifier) }) } };
  }

  async function callback(query: URLSearchParams): Promise<MailResponse> {
    if (!deps.provider) return page('Not configured', 'Mail reading is not configured on the server.');
    if (query.get('error')) return page('Not connected', 'Access was not granted. You can close this page and go back to X Money.');
    const code = query.get('code') ?? '';
    const raw = await open(query.get('state') ?? '', deps.mailKey);
    let state: { a?: string; v?: string; e?: number } = {};
    try {
      state = raw ? JSON.parse(raw) : {};
    } catch {
      state = {};
    }
    if (!code || !state.a || !state.v || !state.e || state.e < deps.now()) return page('Link expired', 'This link is not valid anymore. Go back to X Money and connect again.');
    const got = await deps.provider.exchange({ code, verifier: state.v, redirectUri: deps.redirectUri });
    if (!got) return page('Not connected', 'Google did not accept the connection. Go back to X Money and try again.');
    await deps.store.upsert({ accountId: state.a, provider: 'gmail', email: got.email ?? null, refreshTokenEnc: await seal(got.refreshToken, deps.mailKey) }, deps.now());
    return page('Connected', 'Your mail is connected (read only). You can close this page and go back to X Money.');
  }

  async function status(p: MailPrincipal): Promise<MailResponse> {
    const c = await deps.store.get(p.accountId);
    // the encrypted token never leaves the function: only yes/no, the address and the last read
    return { status: 200, body: { ok: true, configured: !!deps.provider, connected: !!c, email: c?.email ?? null, lastReadAt: c?.lastReadAt ?? null } };
  }

  async function scan(p: MailPrincipal, body: Record<string, unknown>): Promise<MailResponse> {
    if (!deps.provider) return fail(501, 'not_configured');
    const c = await deps.store.get(p.accountId);
    if (!c) return fail(409, 'not_connected');
    const filter = cleanFilter(body['filter']);
    const afterMs = Math.max(c.connectedAt, c.cursorMs);
    const query = buildQuery(filter, Math.floor(afterMs / 1000) + 1);
    if (!query) return fail(400, 'empty_filter'); // no sender listed = nothing is read
    const refresh = await open(c.refreshTokenEnc, deps.mailKey);
    const access = refresh ? await deps.provider.accessToken(refresh) : null;
    if (!access) return fail(409, 'reconnect'); // revoked, expired (Google "testing" apps) or a changed key
    const includePdf = body['includePdf'] === true;
    const ids = await deps.provider.list(access, query, MAX_SCAN);
    const messages: Record<string, unknown>[] = [];
    let skipped = 0;
    let newest = c.cursorMs;
    for (const id of ids.slice(0, MAX_SCAN)) {
      const m = await deps.provider.get(access, id, includePdf);
      if (!m) continue;
      newest = Math.max(newest, m.internalDateMs);
      if (!senderMatches(m.from, filter)) {
        skipped++; // looks like the sender but is not: no draft (principle 2)
        continue;
      }
      messages.push({ id: m.id, from: m.from.slice(0, 120), subject: m.subject.slice(0, 120), date: m.date, text: reduceBody(m.text), ...(m.pdf ? { pdf: m.pdf } : {}) });
    }
    await deps.store.touch(p.accountId, deps.now(), newest);
    return { status: 200, body: { ok: true, messages, skipped } };
  }

  async function disconnect(p: MailPrincipal): Promise<MailResponse> {
    const c = await deps.store.get(p.accountId);
    if (c && deps.provider) {
      const refresh = await open(c.refreshTokenEnc, deps.mailKey);
      if (refresh) await deps.provider.revoke(refresh).catch(() => undefined); // Google unreachable: the token is deleted anyway
    }
    await deps.store.remove(p.accountId); // the token is deleted even if Google could not be reached
    return { status: 200, body: { ok: true } };
  }

  return {
    async handle(req: MailRequest): Promise<MailResponse> {
      if (req.action === 'callback') return callback(req.query);
      const principal = await deps.authenticate(req.authorization);
      if (!principal) return fail(401, 'unauthorized');
      switch (req.action) {
        case 'start':
          return start(principal);
        case 'status':
          return status(principal);
        case 'scan':
          return scan(principal, req.body);
        case 'disconnect':
          return disconnect(principal);
        default:
          return fail(404, 'not_found');
      }
    },
  };
}
