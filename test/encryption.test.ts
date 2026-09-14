import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret, safeEqual } from '../src/crypto/encryption.js';

const KEY = 'a'.repeat(64);

describe('encryption', () => {
  it('round-trips a secret', () => {
    const secret = 'suiprivkey1qxyz-super-secret';
    const token = encryptSecret(secret, KEY);
    expect(token).toMatch(/^v1\./);
    expect(token).not.toContain(secret);
    expect(decryptSecret(token, KEY)).toBe(secret);
  });

  it('produces different ciphertext each time (random salt+iv)', () => {
    const a = encryptSecret('same', KEY);
    const b = encryptSecret('same', KEY);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, KEY)).toBe('same');
    expect(decryptSecret(b, KEY)).toBe('same');
  });

  it('fails with the wrong key', () => {
    const token = encryptSecret('secret', KEY);
    expect(() => decryptSecret(token, 'b'.repeat(64))).toThrow();
  });

  it('detects tampering (GCM auth)', () => {
    const token = encryptSecret('secret', KEY);
    const parts = token.split('.');
    // Flip a character in the ciphertext segment.
    const tampered = parts.slice(0, 4).join('.') + '.' + 'A' + parts[4]!.slice(1);
    expect(() => decryptSecret(tampered, KEY)).toThrow();
  });

  it('rejects malformed tokens', () => {
    expect(() => decryptSecret('garbage', KEY)).toThrow(/Malformed/);
  });

  it('safeEqual works', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
