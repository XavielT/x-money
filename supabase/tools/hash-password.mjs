// Prints the SQL to set a new password for an X Money account (lost recovery code).
// Usage:  node supabase/tools/hash-password.mjs "the new password" you@example.com
// Run it on your own machine and paste the output in the Supabase SQL editor.
// Same algorithm as the xmoney-api function: PBKDF2-HMAC-SHA256, random 16-byte salt.
import { webcrypto as crypto } from 'node:crypto';

const [password, email] = process.argv.slice(2);
if (!password || password.length < 10 || !email) {
  console.error('Usage: node hash-password.mjs "<password, 10+ chars>" <email>');
  process.exit(1);
}

const ITERATIONS = 310_000;
const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256);
const normalized = email.normalize('NFKC').trim().toLowerCase();

console.log(`-- X Money: new password for ${normalized}. Also revokes every session.
update xmoney.accounts
   set password_hash = '${b64u(new Uint8Array(bits))}',
       password_salt = '${b64u(salt)}',
       kdf_params = '{"alg":"PBKDF2-SHA256","iterations":${ITERATIONS}}'::jsonb,
       failed_attempts = 0,
       locked_until = null
 where email = '${normalized.replace(/'/g, "''")}';
update xmoney.sessions set revoked_at = now()
 where revoked_at is null and account_id = (select id from xmoney.accounts where email = '${normalized.replace(/'/g, "''")}');`);
