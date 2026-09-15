import { decryptSecret, encryptSecret } from '../crypto/encryption.js';
import type { Repo } from '../storage/repo.js';
import type { ChainWallet } from '../storage/types.js';
import type { ChainAdapter, ChainId } from '../chains/types.js';
import { isChainId } from '../chains/meta.js';

/**
 * Per-chain wallet lifecycle for the multi-chain platform. Sui remains in the
 * user's top-level address/encryptedSecretKey fields (so existing users keep
 * their wallet); every other chain gets a lazily-created wallet under
 * `user.wallets[chain]`. All secrets are encrypted at rest with the same
 * AES-256-GCM master key used elsewhere. Plaintext keys never hit the store.
 */
export class MultiWalletService {
  constructor(
    private readonly repo: Repo,
    private readonly encryptionKey: string,
    /** Non-Sui adapters, used to create/import wallets for their chain. */
    private readonly adapters: Partial<Record<ChainId, ChainAdapter>>,
  ) {}

  /** The chain the user is currently trading on. Defaults to Sui. */
  async getActiveChain(id: string): Promise<ChainId> {
    const u = await this.repo.getUser(id);
    const c = u?.activeChain;
    return c && isChainId(c) ? c : 'sui';
  }

  async setActiveChain(id: string, chain: ChainId): Promise<void> {
    await this.repo.withUser(id, (u) => {
      u.activeChain = chain;
    });
  }

  /** Address for `chain` if the user already has a wallet there. */
  async getAddress(id: string, chain: ChainId): Promise<string | undefined> {
    const u = await this.repo.getUser(id);
    if (!u) return undefined;
    if (chain === 'sui') return u.address;
    return u.wallets?.[chain]?.address;
  }

  /**
   * Ensure the user has a wallet on `chain`, creating one if needed. Sui is
   * always present (created at /start); other chains are created on first use.
   */
  async ensureWallet(id: string, chain: ChainId): Promise<string> {
    const existing = await this.getAddress(id, chain);
    if (existing) return existing;
    if (chain === 'sui') throw new Error('No Sui wallet yet. Use /start first.');

    const adapter = this.adapters[chain];
    if (!adapter) throw new Error(`${chain} is not supported yet.`);
    const w = await adapter.createWallet();
    const record: ChainWallet = {
      address: w.address,
      encryptedSecretKey: encryptSecret(w.secretKey, this.encryptionKey),
      scheme: w.scheme,
      createdAt: new Date().toISOString(),
    };
    await this.repo.withUser(id, (u) => {
      u.wallets = u.wallets ?? {};
      // Guard against a concurrent create having landed first.
      if (!u.wallets[chain]) u.wallets[chain] = record;
    });
    return (await this.getAddress(id, chain))!;
  }

  /** Import an existing wallet for `chain` from a chain-native secret. */
  async importWallet(id: string, chain: ChainId, secret: string): Promise<string> {
    if (chain === 'sui') throw new Error('Import Sui wallets via the Sui wallet menu.');
    const adapter = this.adapters[chain];
    if (!adapter) throw new Error(`${chain} is not supported yet.`);
    const w = await adapter.importWallet(secret);
    const record: ChainWallet = {
      address: w.address,
      encryptedSecretKey: encryptSecret(w.secretKey, this.encryptionKey),
      scheme: w.scheme,
      createdAt: new Date().toISOString(),
    };
    await this.repo.withUser(id, (u) => {
      u.wallets = u.wallets ?? {};
      u.wallets[chain] = record;
    });
    return w.address;
  }

  /** Decrypted chain-native secret for signing. Sui reads the top-level field. */
  async getSecret(id: string, chain: ChainId): Promise<string> {
    const u = await this.repo.getUser(id);
    if (!u) throw new Error('No wallet yet. Use /start to create one.');
    const enc = chain === 'sui' ? u.encryptedSecretKey : u.wallets?.[chain]?.encryptedSecretKey;
    if (!enc) throw new Error(`No ${chain} wallet yet.`);
    return decryptSecret(enc, this.encryptionKey);
  }

  /** All wallets the user currently has, for the wallet/chain overview. */
  async listWallets(id: string): Promise<{ chain: ChainId; address: string }[]> {
    const u = await this.repo.getUser(id);
    if (!u) return [];
    const out: { chain: ChainId; address: string }[] = [{ chain: 'sui', address: u.address }];
    for (const [chain, w] of Object.entries(u.wallets ?? {})) {
      if (isChainId(chain) && w?.address) out.push({ chain, address: w.address });
    }
    return out;
  }
}
