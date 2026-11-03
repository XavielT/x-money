import { fromBase64Url, timingSafeEqual, toBase64Url } from './crypto.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

export const ACCESS_TTL_SECONDS = 30 * 60;
export const MIN_SECRET_BYTES = 32;

export interface AccessClaims {
  sub: string; // account id
  sid: string; // session id
  exp: number; // epoch seconds
}

async function sign(secret: string, data: string): Promise<Uint8Array> {
  if (enc.encode(secret).length < MIN_SECRET_BYTES) throw new Error('token secret too short');
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export async function signAccessToken(
  claims: { sub: string; sid: string },
  secret: string,
  nowMs: number
): Promise<string> {
  const header = toBase64Url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = toBase64Url(
    enc.encode(JSON.stringify({ ...claims, exp: Math.floor(nowMs / 1000) + ACCESS_TTL_SECONDS }))
  );
  const signature = toBase64Url(await sign(secret, `${header}.${payload}`));
  return `${header}.${payload}.${signature}`;
}

// Returns the claims, or null for any malformed, forged or expired token
export async function verifyAccessToken(
  token: string,
  secret: string,
  nowMs: number
): Promise<AccessClaims | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts;
    const head = JSON.parse(dec.decode(fromBase64Url(header)));
    if (head.alg !== 'HS256') return null; // never let the header pick the algorithm
    const expected = await sign(secret, `${header}.${payload}`);
    if (!timingSafeEqual(expected, fromBase64Url(signature))) return null;
    const claims = JSON.parse(dec.decode(fromBase64Url(payload))) as AccessClaims;
    if (typeof claims.sub !== 'string' || typeof claims.sid !== 'string') return null;
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= nowMs) return null;
    return claims;
  } catch {
    return null;
  }
}
