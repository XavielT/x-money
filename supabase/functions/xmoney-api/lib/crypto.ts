// WebCrypto only (works in Deno and Node), no dependencies.
const enc = new TextEncoder();

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const bin = atob(padded);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function randomToken(bytes = 32): string {
  return toBase64Url(randomBytes(bytes));
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time comparison (all inputs are fixed-size digests, so length is not secret)
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function timingSafeEqualText(a: string, b: string): boolean {
  return timingSafeEqual(enc.encode(a), enc.encode(b));
}

export interface KdfParams {
  alg: 'PBKDF2-SHA256';
  iterations: number;
}

// OWASP asks for 600k for PBKDF2-SHA256; 310k keeps one hash around 100-200 ms of CPU
// so login (which also hashes a decoy for unknown emails) stays well inside the
// edge function CPU limit. kdf_params is stored per account to raise it later.
export const DEFAULT_KDF: KdfParams = { alg: 'PBKDF2-SHA256', iterations: 310_000 };

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    256
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, kdf: KdfParams = DEFAULT_KDF) {
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, salt, kdf.iterations);
  return { hash: toBase64Url(hash), salt: toBase64Url(salt), kdf };
}

export async function verifyPassword(
  password: string,
  hash: string,
  salt: string,
  kdf: KdfParams
): Promise<boolean> {
  const derived = await pbkdf2(password, fromBase64Url(salt), kdf.iterations);
  return timingSafeEqual(derived, fromBase64Url(hash));
}
