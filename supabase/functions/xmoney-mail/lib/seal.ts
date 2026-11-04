// AES-GCM sealing of the refresh token and of the OAuth state (WebCrypto only). The key is the
// XMONEY_MAIL_KEY secret (32 random bytes, base64url). A sealed value is "v1.<iv>.<ciphertext>": any
// change to it, or another key, makes opening fail (GCM authenticates), and nothing is ever logged.
import { fromBase64Url, toBase64Url } from '../../xmoney-api/lib/crypto.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

async function keyOf(secret: string): Promise<CryptoKey> {
  const raw = fromBase64Url(secret);
  if (raw.length !== 32) throw new Error('mail_key_invalid');
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function seal(plain: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, await keyOf(secret), enc.encode(plain)));
  return `v1.${toBase64Url(iv)}.${toBase64Url(cipher)}`;
}

// null = it does not open (wrong key, tampered, malformed)
export async function open(sealed: string, secret: string): Promise<string | null> {
  const [v, iv, cipher] = sealed.split('.');
  if (v !== 'v1' || !iv || !cipher) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(iv) as BufferSource }, await keyOf(secret), fromBase64Url(cipher) as BufferSource);
    return dec.decode(plain);
  } catch {
    return null;
  }
}

// PKCE (RFC 7636): a random verifier and its S256 challenge
export function newVerifier(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(48)));
}

export async function challengeOf(verifier: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(verifier))));
}
