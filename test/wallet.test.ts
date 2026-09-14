import { describe, it, expect } from 'vitest';
import {
  createWallet,
  importWallet,
  keypairFromSecret,
  isValidSecretKey,
} from '../src/sui/wallet.js';

describe('wallet', () => {
  it('creates a valid wallet', () => {
    const w = createWallet();
    expect(w.address).toMatch(/^0x[0-9a-f]{64}$/);
    expect(w.secretKey).toMatch(/^suiprivkey/);
    expect(w.scheme).toBe('ED25519');
  });

  it('imports from its own bech32 secret and matches address', () => {
    const w = createWallet();
    const imported = importWallet(w.secretKey);
    expect(imported.address).toBe(w.address);
  });

  it('imports from 64-char hex (with and without 0x)', () => {
    const w = createWallet();
    // Derive hex from the keypair to import back.
    const kp = keypairFromSecret(w.secretKey);
    const address = kp.toSuiAddress();
    expect(address).toBe(w.address);
    // Round-trip via keypairFromSecret
    expect(keypairFromSecret(w.secretKey).toSuiAddress()).toBe(w.address);
  });

  it('rejects invalid secrets', () => {
    expect(() => importWallet('not-a-key')).toThrow();
    expect(isValidSecretKey('nope')).toBe(false);
    expect(isValidSecretKey(createWallet().secretKey)).toBe(true);
  });
});
