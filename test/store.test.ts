import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/storage/store.js';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'suipad-store-'));
  file = join(dir, 'db.json');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('Store', () => {
  it('creates, reads, and persists users', async () => {
    const store = new Store(file, { slippageBps: 100 });
    await store.init();
    expect(store.hasUser('1')).toBe(false);

    await store.upsertUser('1', { address: '0xabc', encryptedSecretKey: 'enc', keyScheme: 'ED25519' });
    expect(store.hasUser('1')).toBe(true);
    expect(store.getUser('1')?.settings.slippageBps).toBe(100);

    // Reload from disk into a fresh Store.
    const store2 = new Store(file, { slippageBps: 100 });
    await store2.init();
    expect(store2.getUser('1')?.address).toBe('0xabc');
  });

  it('updates settings', async () => {
    const store = new Store(file, { slippageBps: 100 });
    await store.init();
    await store.upsertUser('1', { address: '0xabc', encryptedSecretKey: 'e', keyScheme: 'ED25519' });
    await store.updateSettings('1', { slippageBps: 250 });
    expect(store.getUser('1')?.settings.slippageBps).toBe(250);
  });

  it('records trades and launches with a cap', async () => {
    const store = new Store(file, { slippageBps: 100 });
    await store.init();
    await store.upsertUser('1', { address: '0xabc', encryptedSecretKey: 'e', keyScheme: 'ED25519' });
    await store.addTrade('1', {
      id: 't1', kind: 'buy', inputType: 'a', outputType: 'b',
      inputAmount: '1', expectedOutput: '2', status: 'submitted', createdAt: 'now',
    });
    await store.updateTrade('1', 't1', { status: 'success', digest: 'D' });
    expect(store.getUser('1')?.trades[0]?.status).toBe('success');
    expect(store.getUser('1')?.trades[0]?.digest).toBe('D');

    await store.addLaunch('1', {
      id: 'l1', name: 'X', symbol: 'X', decimals: 9, status: 'submitted', createdAt: 'now',
    });
    await store.updateLaunch('1', 'l1', { status: 'success', packageId: '0xpkg' });
    expect(store.getUser('1')?.launches[0]?.packageId).toBe('0xpkg');
  });

  it('throws updating a non-existent user', async () => {
    const store = new Store(file, { slippageBps: 100 });
    await store.init();
    await expect(store.updateSettings('nope', { slippageBps: 1 })).rejects.toThrow();
  });
});
