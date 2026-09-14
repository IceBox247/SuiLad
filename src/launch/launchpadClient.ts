import { Transaction } from '@mysten/sui/transactions';
import type { SuiClient } from '@mysten/sui/client';

/**
 * Client for the deployed SuiPad launchpad package (see move/launchpad).
 * Builds transactions to create a bonding curve and to buy/sell against it.
 * Requires LAUNCHPAD_PACKAGE_ID to be set to a deployed package.
 */
export class LaunchpadClient {
  constructor(
    private readonly client: SuiClient,
    private readonly packageId: string,
  ) {}

  get isConfigured(): boolean {
    return Boolean(this.packageId);
  }

  private target(fn: string): `${string}::${string}::${string}` {
    if (!this.packageId) throw new Error('Launchpad is not configured (set LAUNCHPAD_PACKAGE_ID).');
    return `${this.packageId}::launchpad::${fn}`;
  }

  /** Create a bonding curve from a coin's TreasuryCap. */
  buildCreate(params: {
    coinType: string;
    treasuryCapId: string;
    curveSupply: bigint;
    virtualSui: bigint;
    migrateThreshold: bigint;
    feeBps: number;
    sender: string;
  }): Transaction {
    const tx = new Transaction();
    tx.setSender(params.sender);
    tx.moveCall({
      target: this.target('create'),
      typeArguments: [params.coinType],
      arguments: [
        tx.object(params.treasuryCapId),
        tx.pure.u64(params.curveSupply),
        tx.pure.u64(params.virtualSui),
        tx.pure.u64(params.migrateThreshold),
        tx.pure.u64(BigInt(params.feeBps)),
      ],
    });
    return tx;
  }

  /** Buy tokens from a curve with SUI. */
  buildBuy(params: {
    coinType: string;
    curveId: string;
    suiIn: bigint;
    minOut: bigint;
    sender: string;
  }): Transaction {
    const tx = new Transaction();
    tx.setSender(params.sender);
    const [payment] = tx.splitCoins(tx.gas, [params.suiIn]);
    const out = tx.moveCall({
      target: this.target('buy'),
      typeArguments: [params.coinType],
      arguments: [tx.object(params.curveId), payment, tx.pure.u64(params.minOut)],
    });
    tx.transferObjects([out], params.sender);
    return tx;
  }

  /** Sell tokens back to a curve for SUI. */
  async buildSell(params: {
    coinType: string;
    curveId: string;
    tokenIn: bigint;
    minSuiOut: bigint;
    sender: string;
  }): Promise<Transaction> {
    const tx = new Transaction();
    tx.setSender(params.sender);
    const coins = await this.client.getCoins({ owner: params.sender, coinType: params.coinType });
    if (coins.data.length === 0) throw new Error('No tokens to sell.');
    const primary = coins.data[0]!.coinObjectId;
    if (coins.data.length > 1) {
      tx.mergeCoins(tx.object(primary), coins.data.slice(1).map((c) => tx.object(c.coinObjectId)));
    }
    const [tokens] = tx.splitCoins(tx.object(primary), [params.tokenIn]);
    const suiOut = tx.moveCall({
      target: this.target('sell'),
      typeArguments: [params.coinType],
      arguments: [tx.object(params.curveId), tokens, tx.pure.u64(params.minSuiOut)],
    });
    tx.transferObjects([suiOut], params.sender);
    return tx;
  }
}
