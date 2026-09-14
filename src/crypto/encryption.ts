import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Authenticated symmetric encryption for secrets at rest (private keys).
 *
 * Format (all base64url, joined by "."):
 *   v1.<salt>.<iv>.<authTag>.<ciphertext>
 *
 * A fresh random salt derives a per-record 256-bit key from the master key via
 * scrypt, and a fresh random 96-bit IV is used per record. AES-256-GCM provides
 * confidentiality + integrity (tampering fails decryption).
 */

const VERSION = 'v1';
const KEY_LEN = 32; // AES-256
const IV_LEN = 12; // GCM standard nonce
const SALT_LEN = 16;
const SCRYPT_COST = 16384; // N (CPU/memory cost)

function deriveKey(masterKey: string, salt: Buffer): Buffer {
  return scryptSync(masterKey, salt, KEY_LEN, { N: SCRYPT_COST, r: 8, p: 1 });
}

function b64(buf: Buffer): string {
  return buf.toString('base64url');
}

function fromB64(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

/** Encrypt `plaintext` with a master key, returning a self-describing token. */
export function encryptSecret(plaintext: string, masterKey: string): string {
  if (!masterKey) throw new Error('masterKey is required');
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(masterKey, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, b64(salt), b64(iv), b64(tag), b64(ciphertext)].join('.');
}

/** Decrypt a token produced by {@link encryptSecret}. Throws on tampering or wrong key. */
export function decryptSecret(token: string, masterKey: string): string {
  if (!masterKey) throw new Error('masterKey is required');
  const parts = token.split('.');
  if (parts.length !== 5 || parts[0] !== VERSION) {
    throw new Error('Malformed or unsupported ciphertext token');
  }
  const [, saltB64, ivB64, tagB64, dataB64] = parts as [string, string, string, string, string];
  const salt = fromB64(saltB64);
  const iv = fromB64(ivB64);
  const tag = fromB64(tagB64);
  const data = fromB64(dataB64);
  const key = deriveKey(masterKey, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** Constant-time equality for comparing secrets/tokens. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
