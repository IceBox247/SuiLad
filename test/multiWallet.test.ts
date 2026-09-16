import { describe, it, expect, beforeEach } from 'vitest';
import { MultiWalletService } from '../src/services/multiWallet.js';
import { makeRepo } from './helpers.js';
import type { Repo } from '../src/storage/repo.js';
import type { ChainAdapter, GeneratedWallet } from '../src/chains/types.js';

const KEY = 'test-master-key-test-master-key-01';

/** A tiny fake adapter that mints deterministic wallets. */
function fakeAdapter(prefix: string): ChainAdapter {
  let n = 0;
  const mk = (secret?: string): GeneratedWallet => {
    const idx = secret ?? `${prefix}-${++n}`;
    return { address: `${prefix}addr-${idx}`, secretKey: `${prefix}secret-${idx}`, scheme: 'ED25519' };
  };
  return {
    meta: { id: 'solana', name: 'Solana', icon: '◎', nativeSymbol: 'SOL', nativeDecimals: 9, nativeAddress: 'x', dexScreenerChain: 'solana', family: 'solana' },
    createWallet: async () => mk(),
    importWallet: async (secret: string) => ({ address: `${prefix}addr-imported`, secretKey: secret, scheme: 'ED25519' }),
    isValidSecret: () => true,
    isValidAddress: () => true,
    getNativeBalance: async () => 0n,
    getTokenBalance: async () => 0n,
    getTokenMeta: async () => ({ address: 'x', symbol: 'X', name: 'X', decimals: 9 }),
    quote: async () => { throw new Error('n/a'); },
    swap: async () => ({ digest: 'x' }),
    explorerTx: (h) => h,
    explorerAddress: (a) => a,
  };
}

let repo: Repo;
beforeEach(async () => {
  repo = makeRepo();
  await repo.createUser('u1', { address: '0xSUI', encryptedSecretKey: 'enc-sui', keyScheme: 'ED25519' });
});

describe('MultiWalletService', () => {
  it('defaults active chain to sui and can switch', async () => {
    const svc = new MultiWalletService(repo, KEY, { solana: fakeAdapter('sol') });
    expect(await svc.getActiveChain('u1')).toBe('sui');
    await svc.setActiveChain('u1', 'solana');
    expect(await svc.getActiveChain('u1')).toBe('solana');
  });

  it('returns the top-level Sui address for chain=sui', async () => {
    const svc = new MultiWalletService(repo, KEY, {});
    expect(await svc.getAddress('u1', 'sui')).toBe('0xSUI');
  });

  it('lazily creates a Solana wallet and persists it encrypted', async () => {
    const svc = new MultiWalletService(repo, KEY, { solana: fakeAdapter('sol') });
    expect(await svc.getAddress('u1', 'solana')).toBeUndefined();
    const addr = await svc.ensureWallet('u1', 'solana');
    expect(addr).toContain('soladdr');
    // Persisted and stable across calls.
    expect(await svc.ensureWallet('u1', 'solana')).toBe(addr);
    // Secret is decryptable and never stored in plaintext.
    const secret = await svc.getSecret('u1', 'solana');
    expect(secret).toContain('solsecret');
    const stored = (await repo.getUser('u1'))!.wallets!.solana!.encryptedSecretKey;
    expect(stored).not.toContain('solsecret');
  });

  it('imports a Solana wallet from a secret', async () => {
    const svc = new MultiWalletService(repo, KEY, { solana: fakeAdapter('sol') });
    const addr = await svc.importWallet('u1', 'solana', 'my-imported-secret');
    expect(addr).toBe('soladdr-imported');
    expect(await svc.getSecret('u1', 'solana')).toBe('my-imported-secret');
  });

  it('lists all wallets including Sui', async () => {
    const svc = new MultiWalletService(repo, KEY, { solana: fakeAdapter('sol') });
    await svc.ensureWallet('u1', 'solana');
    const list = await svc.listWallets('u1');
    expect(list.find((w) => w.chain === 'sui')?.address).toBe('0xSUI');
    expect(list.find((w) => w.chain === 'solana')?.address).toContain('soladdr');
  });

  it('rejects unsupported chains', async () => {
    const svc = new MultiWalletService(repo, KEY, {});
    await expect(svc.ensureWallet('u1', 'tron')).rejects.toThrow(/not supported/);
  });
});
