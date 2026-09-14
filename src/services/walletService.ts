import { randomUUID } from 'node:crypto';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decryptSecret, encryptSecret } from '../crypto/encryption.js';
import { createWallet, importWallet, keypairFromSecret, type GeneratedWallet } from '../sui/wallet.js';
import type { Repo } from '../storage/repo.js';
import type { SubWallet } from '../storage/types.js';

/**
 * Owns wallet lifecycle: creating/importing the main wallet and any bundling
 * sub-wallets, encrypting keys at rest, and reconstructing signing keypairs on
 * demand. Plaintext secret keys never touch the store.
 */
export class WalletService {
  constructor(
    private readonly repo: Repo,
    private readonly encryptionKey: string,
    private readonly maxSubWallets = 10,
  ) {}

  async hasWallet(id: string): Promise<boolean> {
    return this.repo.hasUser(id);
  }

  async getAddress(id: string): Promise<string | undefined> {
    return (await this.repo.getUser(id))?.address;
  }

  /** Create a fresh wallet + user record. `referrerId` sets the L1 upline. */
  async create(id: string, referrerId?: string): Promise<{ address: string }> {
    const wallet = createWallet();
    await this.repo.createUser(id, {
      address: wallet.address,
      encryptedSecretKey: this.enc(wallet.secretKey),
      keyScheme: wallet.scheme,
      referrerId,
    });
    return { address: wallet.address };
  }

  /** Import a wallet from a secret key. Creates the user if needed. */
  async import(id: string, secret: string, referrerId?: string): Promise<{ address: string }> {
    const wallet = importWallet(secret);
    if (await this.repo.hasUser(id)) {
      await this.repo.setWallet(id, {
        address: wallet.address,
        encryptedSecretKey: this.enc(wallet.secretKey),
        keyScheme: wallet.scheme,
      });
    } else {
      await this.repo.createUser(id, {
        address: wallet.address,
        encryptedSecretKey: this.enc(wallet.secretKey),
        keyScheme: wallet.scheme,
        referrerId,
      });
    }
    return { address: wallet.address };
  }

  async getKeypair(id: string): Promise<Ed25519Keypair> {
    const u = await this.repo.getUser(id);
    if (!u) throw new Error('No wallet yet. Use /start to create one.');
    return keypairFromSecret(decryptSecret(u.encryptedSecretKey, this.encryptionKey));
  }

  async exportSecret(id: string): Promise<string> {
    const u = await this.repo.getUser(id);
    if (!u) throw new Error('No wallet yet. Use /start to create one.');
    return decryptSecret(u.encryptedSecretKey, this.encryptionKey);
  }

  // --- Sub-wallets (for bundling) --------------------------------------------

  async listSubWallets(id: string): Promise<SubWallet[]> {
    return (await this.repo.getUser(id))?.subWallets ?? [];
  }

  /** Create a new bundling sub-wallet, up to the configured maximum. */
  async addSubWallet(id: string, label?: string): Promise<SubWallet> {
    const wallet = createWallet();
    let created!: SubWallet;
    await this.repo.withUser(id, (u) => {
      if (u.subWallets.length >= this.maxSubWallets) {
        throw new Error(`You can have at most ${this.maxSubWallets} sub-wallets.`);
      }
      created = {
        id: randomUUID(),
        address: wallet.address,
        encryptedSecretKey: this.enc(wallet.secretKey),
        label: label || `Wallet ${u.subWallets.length + 2}`,
        createdAt: new Date().toISOString(),
      };
      u.subWallets.push(created);
    });
    return created;
  }

  async removeSubWallet(id: string, subId: string): Promise<void> {
    await this.repo.withUser(id, (u) => {
      u.subWallets = u.subWallets.filter((w) => w.id !== subId);
    });
  }

  /** Keypair for a specific sub-wallet. */
  async getSubWalletKeypair(id: string, subId: string): Promise<Ed25519Keypair> {
    const u = await this.repo.getUser(id);
    const w = u?.subWallets.find((s) => s.id === subId);
    if (!w) throw new Error('Sub-wallet not found.');
    return keypairFromSecret(decryptSecret(w.encryptedSecretKey, this.encryptionKey));
  }

  /** All signing wallets (main + subs) with labels, for bundling UIs. */
  async allWallets(id: string): Promise<{ id: string; address: string; label: string; isMain: boolean }[]> {
    const u = await this.repo.getUser(id);
    if (!u) return [];
    return [
      { id: 'main', address: u.address, label: 'Main', isMain: true },
      ...u.subWallets.map((w) => ({ id: w.id, address: w.address, label: w.label, isMain: false })),
    ];
  }

  /** Resolve a wallet id ('main' or subId) to a keypair. */
  async keypairFor(id: string, walletId: string): Promise<Ed25519Keypair> {
    return walletId === 'main' ? this.getKeypair(id) : this.getSubWalletKeypair(id, walletId);
  }

  private enc(secret: string): string {
    return encryptSecret(secret, this.encryptionKey);
  }

  /** Expose a generated wallet's fields for callers that need the raw material once. */
  static describe(wallet: GeneratedWallet): GeneratedWallet {
    return wallet;
  }
}
