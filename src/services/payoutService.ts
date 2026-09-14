import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { Repo } from '../storage/repo.js';
import type { SuiService } from '../sui/service.js';
import { SUI_TYPE } from '../sui/service.js';
import { keypairFromSecret, importWallet } from '../sui/wallet.js';
import { logger } from '../logger.js';

export interface ClaimResult {
  amountMist: bigint;
  digest: string;
}

/**
 * Pays out referral earnings on-chain from the fee wallet.
 *
 * Safety model: the claim amount is *reserved* (deducted under the per-user
 * lock) BEFORE the transfer, and *refunded* if the transfer fails — so a failed
 * or crashed payout never loses a user's balance and can't be double-claimed by
 * concurrent taps.
 */
export class PayoutService {
  private readonly feeKeypair: Ed25519Keypair;

  constructor(
    private readonly repo: Repo,
    private readonly sui: SuiService,
    feeWalletSecret: string,
    private readonly minClaimMist: bigint,
  ) {
    this.feeKeypair = keypairFromSecret(normalizeSecret(feeWalletSecret));
  }

  /** The fee wallet's address (payouts are sent from here). */
  get feeAddress(): string {
    return this.feeKeypair.toSuiAddress();
  }

  /**
   * Claim and pay a user's unclaimed referral earnings to their wallet.
   * Returns null if there is nothing above the minimum to claim.
   */
  async claim(userId: string): Promise<ClaimResult | null> {
    // Reserve under lock: capture the amount + address and zero the balance.
    let amount = 0n;
    let address = '';
    await this.repo.withUser(userId, (u) => {
      const unclaimed = BigInt(u.referral.unclaimedMist);
      if (unclaimed < this.minClaimMist) return; // leave as-is
      amount = unclaimed;
      address = u.address;
      u.referral.unclaimedMist = '0';
    });
    if (amount <= 0n) return null;

    try {
      const { digest } = await this.sui.transfer({
        signer: this.feeKeypair,
        recipient: address,
        coinType: SUI_TYPE,
        amount,
      });
      return { amountMist: amount, digest };
    } catch (err) {
      // Refund the reserved amount so nothing is lost on a failed payout.
      await this.repo
        .withUser(userId, (u) => {
          u.referral.unclaimedMist = (BigInt(u.referral.unclaimedMist) + amount).toString();
        })
        .catch((e) => logger.error('payout refund failed', { userId, e: (e as Error).message }));
      throw err;
    }
  }
}

/** Accept either a bech32 `suiprivkey…` or a raw hex secret for the fee wallet. */
function normalizeSecret(secret: string): string {
  const s = secret.trim();
  if (s.startsWith('suiprivkey')) return s;
  // importWallet accepts hex too; round-trip to a canonical bech32 secret.
  return importWallet(s).secretKey;
}
