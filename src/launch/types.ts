export interface LaunchParams {
  /** Display name, e.g. "My Coin". */
  name: string;
  /** Ticker symbol, e.g. "MYC". */
  symbol: string;
  /** Number of decimal places (0-18 typical; SUI uses 9). */
  decimals: number;
  /** Human description. */
  description: string;
  /** Total initial supply in whole tokens (minted to the creator). 0 = none. */
  initialSupply: bigint;
  /** Optional icon URL. */
  iconUrl?: string;
  /**
   * If true, the TreasuryCap is transferred to the creator (they can mint more).
   * If false, minting is disabled after the initial supply (cap is destroyed).
   */
  keepMintAuthority: boolean;
}

export interface LaunchResult {
  digest: string;
  packageId: string;
  coinType: string;
  treasuryCapId?: string;
  metadataId?: string;
}
