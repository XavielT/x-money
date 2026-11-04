// Gmail implementation of MailProvider: OAuth 2.0 authorization code + PKCE, scope gmail.readonly
// (nothing can be sent, changed or deleted). Plain fetch. The client secret and every token only
// live in this function; errors never carry provider text.
import { fromBase64Url, toBase64Url } from '../../xmoney-api/lib/crypto.ts';
import { htmlToText } from './mail-text.ts';
import type { MailMessage, MailProvider } from './provider.ts';

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const REVOKE = 'https://oauth2.googleapis.com/revoke';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
export const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const MAX_PDF_BYTES = 5 * 1024 * 1024;

interface Part {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: Part[];
}

function collect(part: Part | undefined, out: { plain: string[]; html: string[]; pdf?: { name: string; id?: string; data?: string; size: number } }): void {
  if (!part) return;
  const type = (part.mimeType ?? '').toLowerCase();
  if (type === 'text/plain' && part.body?.data) out.plain.push(new TextDecoder().decode(fromBase64Url(part.body.data)));
  else if (type === 'text/html' && part.body?.data) out.html.push(new TextDecoder().decode(fromBase64Url(part.body.data)));
  else if (type === 'application/pdf' && !out.pdf) out.pdf = { name: part.filename || 'document.pdf', id: part.body?.attachmentId, data: part.body?.data, size: part.body?.size ?? 0 };
  for (const p of part.parts ?? []) collect(p, out);
}

export function createGmailProvider(cfg: { clientId: string; clientSecret: string }, fetchFn: typeof fetch = (...a) => fetch(...a)): MailProvider {
  const form = (data: Record<string, string>) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(data).toString() });
  const getJson = async <T>(url: string, token: string): Promise<T | null> => {
    const res = await fetchFn(url, { headers: { authorization: `Bearer ${token}` } });
    return res.ok ? ((await res.json()) as T) : null;
  };

  return {
    name: 'gmail',
    authUrl({ redirectUri, state, challenge }) {
      const q = new URLSearchParams({
        client_id: cfg.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPE,
        access_type: 'offline',
        prompt: 'consent',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      });
      return `${AUTH}?${q.toString()}`;
    },
    async exchange({ code, verifier, redirectUri }) {
      const res = await fetchFn(TOKEN, form({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier }));
      if (!res.ok) return null;
      const data = (await res.json()) as { refresh_token?: string; id_token?: string };
      if (!data.refresh_token) return null;
      let email: string | undefined;
      try {
        const payload = JSON.parse(new TextDecoder().decode(fromBase64Url((data.id_token ?? '').split('.')[1] ?? '')));
        email = typeof payload.email === 'string' ? payload.email : undefined;
      } catch {
        email = undefined;
      }
      return { refreshToken: data.refresh_token, email };
    },
    async accessToken(refreshToken) {
      const res = await fetchFn(TOKEN, form({ client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }));
      if (!res.ok) return null;
      const data = (await res.json()) as { access_token?: string };
      return data.access_token ?? null;
    },
    async list(accessToken, query, max) {
      const url = `${API}/messages?${new URLSearchParams({ q: query, maxResults: String(Math.min(30, Math.max(1, max))) }).toString()}`;
      const data = await getJson<{ messages?: { id: string }[] }>(url, accessToken);
      return (data?.messages ?? []).map((m) => m.id);
    },
    async get(accessToken, id, includePdf) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
      const data = await getJson<{ id: string; internalDate?: string; payload?: Part & { headers?: { name: string; value: string }[] } }>(`${API}/messages/${id}?format=full`, accessToken);
      if (!data?.payload) return null;
      const header = (n: string) => data.payload?.headers?.find((h) => h.name.toLowerCase() === n)?.value ?? '';
      const found: { plain: string[]; html: string[]; pdf?: { name: string; id?: string; data?: string; size: number } } = { plain: [], html: [] };
      collect(data.payload, found);
      const text = found.plain.length ? found.plain.join('\n') : htmlToText(found.html.join('\n'));
      const internalDateMs = Number(data.internalDate ?? 0);
      const msg: MailMessage = { id: data.id, from: header('from'), subject: header('subject'), date: new Date(internalDateMs || Date.now()).toISOString(), internalDateMs, text };
      if (includePdf && found.pdf && found.pdf.size <= MAX_PDF_BYTES) {
        let b64 = found.pdf.data;
        if (!b64 && found.pdf.id) b64 = (await getJson<{ data?: string }>(`${API}/messages/${id}/attachments/${found.pdf.id}`, accessToken))?.data;
        if (b64) msg.pdf = { name: found.pdf.name.slice(0, 80), base64: toBase64Standard(b64) };
      }
      return msg;
    },
    async revoke(refreshToken) {
      await fetchFn(REVOKE, form({ token: refreshToken })).catch(() => undefined);
    },
  };
}

// Gmail returns base64url; the AI function wants standard base64
const toBase64Standard = (b64url: string): string => b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4);
