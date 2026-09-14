import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decryptSecret, encryptSecret } from '../crypto/encryption.js';
import { createWallet, importWallet, keypairFromSecret } from '../sui/wallet.js';
import type { Store } from '../storage/store.js';
import type { UserRecord } from '../storage/types.js';

/**
 * Owns wallet lifecycle: creating/importing wallets, encrypting keys at rest,
 * and reconstructing signing keypairs on demand. Plaintext secret keys never
 * touch the store.
 */
export class WalletService {
  constructor(
    private readonly store: Store,
    private readonly encryptionKey: string,
  ) {}

  hasWallet(telegramId: string): boolean {
    return this.store.hasUser(telegramId);
  }

  getAddress(telegramId: string): string | undefined {
    return this.store.getUser(telegramId)?.address;
  }

  /** Create a fresh wallet for the user, persisting the encrypted secret. */
  async create(telegramId: string): Promise<{ address: string }> {
    const wallet = createWallet();
    await this.persist(telegramId, wallet);
    return { address: wallet.address };
  }

  /** Import a wallet from a user-provided secret key (bech32 or hex). */
  async import(telegramId: string, secret: string): Promise<{ address: string }> {
    const wallet = importWallet(secret);
    await this.persist(telegramId, wallet);
    return { address: wallet.address };
  }

  /** Reconstruct the signing keypair (decrypts the stored secret). */
  getKeypair(telegramId: string): Ed25519Keypair {
    const user = this.requireUser(telegramId);
    const secret = decryptSecret(user.encryptedSecretKey, this.encryptionKey);
    return keypairFromSecret(secret);
  }

  /** Decrypt and return the raw secret key for the user (for export). Handle with care. */
  exportSecret(telegramId: string): string {
    const user = this.requireUser(telegramId);
    return decryptSecret(user.encryptedSecretKey, this.encryptionKey);
  }

  private async persist(
    telegramId: string,
    wallet: { address: string; secretKey: string; scheme: string },
  ): Promise<void> {
    const encryptedSecretKey = encryptSecret(wallet.secretKey, this.encryptionKey);
    await this.store.upsertUser(telegramId, {
      address: wallet.address,
      encryptedSecretKey,
      keyScheme: wallet.scheme,
    });
  }

  private requireUser(telegramId: string): UserRecord {
    const user = this.store.getUser(telegramId);
    if (!user) throw new Error('You have no wallet yet. Use /start to create one.');
    return user;
  }
}
