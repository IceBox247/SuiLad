import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/storage/store.js';
import { WalletService } from '../src/services/walletService.js';

const KEY = 'k'.repeat(64);
let dir: string;
let store: Store;
let svc: WalletService;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'suipad-ws-'));
  store = new Store(join(dir, 'db.json'), { slippageBps: 100 });
  await store.init();
  svc = new WalletService(store, KEY);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('WalletService', () => {
  it('creates a wallet and stores the key encrypted', async () => {
    const { address } = await svc.create('1');
    expect(address).toMatch(/^0x[0-9a-f]{64}$/);
    const stored = store.getUser('1')!;
    // The stored secret must be ciphertext, not the plaintext key.
    expect(stored.encryptedSecretKey).toMatch(/^v1\./);
    expect(stored.encryptedSecretKey).not.toContain('suiprivkey');
  });

  it('reconstructs the signing keypair for the same address', async () => {
    const { address } = await svc.create('1');
    const kp = svc.getKeypair('1');
    expect(kp.toSuiAddress()).toBe(address);
  });

  it('exports the original secret key', async () => {
    await svc.create('1');
    const secret = svc.exportSecret('1');
    expect(secret).toMatch(/^suiprivkey/);
    // Importing the exported secret yields the same address.
    const addr = svc.getAddress('1');
    const imported = await svc.import('2', secret);
    expect(imported.address).toBe(addr);
  });

  it('throws for a user without a wallet', () => {
    expect(() => svc.getKeypair('missing')).toThrow();
  });
});
