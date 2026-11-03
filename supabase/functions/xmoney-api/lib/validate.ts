export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200;
export const MAX_RECORD_BYTES = 256 * 1024;
export const MAX_BATCH_OPS = 500;
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const COLLECTION_RE = /^[a-z][a-z0-9_]{0,39}$/;
const ID_RE = /^[A-Za-z0-9_.:~-]{1,128}$/;
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const CONTROL_CHARS_RE = /[\u0000-\u001f]/g;

// trimmed, lower case, NFKC (so a full-width address and its plain form are one account)
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.normalize('NFKC').trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

export function isStrongEnough(password: unknown): password is string {
  return (
    typeof password === 'string' &&
    password.length >= MIN_PASSWORD_LENGTH &&
    password.length <= MAX_PASSWORD_LENGTH
  );
}

export const isCollection = (v: unknown): v is string => typeof v === 'string' && COLLECTION_RE.test(v);
export const isRecordId = (v: unknown): v is string => typeof v === 'string' && ID_RE.test(v);
export const isDeviceId = (v: unknown): v is string => typeof v === 'string' && DEVICE_ID_RE.test(v);

export function cleanLabel(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(CONTROL_CHARS_RE, '').trim().slice(0, 60) : '';
}

export function normalizeRecoveryCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  return /^[A-Z2-7]{32}$/.test(code) ? code : null;
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// 160 random bits as 32 base32 chars, grouped for humans: XXXX-XXXX-...
export function newRecoveryCode(random: Uint8Array): { code: string; display: string } {
  let code = '';
  for (let i = 0; i < 32; i++) code += B32[random[i] % 32];
  return { code, display: code.match(/.{4}/g)!.join('-') };
}
