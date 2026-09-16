import { describe, it, expect, beforeEach } from 'vitest';
import { WalletService } from '../src/services/walletService.js';
import { makeRepo } from './helpers.js';
import type { Repo } from '../src/storage/repo.js';

const KEY = 'k'.repeat(64);
let repo: Repo;
let svc: WalletService;

beforeEach(() => {
  repo = makeRepo();
  svc = new WalletService(repo, KEY, 5);
});

describe('WalletService', () => {
  it('creates a wallet and stores the key encrypted', async () => {
    const { address } = await svc.create('1');
    expect(address).toMatch(/^0x[0-9a-f]{64}$/);
    const stored = (await repo.getUser('1'))!;
    expect(stored.encryptedSecretKey).toMatch(/^v1\./);
    expect(stored.encryptedSecretKey).not.toContain('suiprivkey');
    expect(stored.referral.code).toMatch(/^[0-9A-F]+$/);
  });

  it('reconstructs the signing keypair for the same address', async () => {
    const { address } = await svc.create('1');
    const kp = await svc.getKeypair('1');
    expect(kp.toSuiAddress()).toBe(address);
  });

  it('exports the original secret and re-imports to the same address', async () => {
    await svc.create('1');
    const addr = await svc.getAddress('1');
    const secret = await svc.exportSecret('1');
    expect(secret).toMatch(/^suiprivkey/);
    const imported = await svc.import('2', secret);
    expect(imported.address).toBe(addr);
  });

  it('records the referrer when creating with one', async () => {
    await svc.create('boss');
    const boss = await repo.getUser('boss');
    await svc.create('minion', 'boss');
    const minion = await repo.getUser('minion');
    expect(minion?.referral.referrerId).toBe('boss');
    expect(boss).toBeDefined();
  });

  it('manages sub-wallets up to the max', async () => {
    await svc.create('1');
    const w1 = await svc.addSubWallet('1', 'Trader');
    expect(w1.address).toMatch(/^0x/);
    const all = await svc.allWallets('1');
    expect(all).toHaveLength(2);
    expect(all[0]!.isMain).toBe(true);
    const kp = await svc.keypairFor('1', w1.id);
    expect(kp.toSuiAddress()).toBe(w1.address);
  });

  it('enforces the sub-wallet cap', async () => {
    await svc.create('1');
    for (let i = 0; i < 5; i++) await svc.addSubWallet('1');
    await expect(svc.addSubWallet('1')).rejects.toThrow(/at most/);
  });

  it('throws for a user without a wallet', async () => {
    await expect(svc.getKeypair('missing')).rejects.toThrow();
  });
});
