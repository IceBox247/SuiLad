/** Persisted data model. All secret material is stored encrypted. */

export interface UserSettings {
  /** Slippage tolerance in basis points (100 = 1%). */
  slippageBps: number;
}

export interface TradeRecord {
  id: string;
  kind: 'buy' | 'sell' | 'swap';
  inputType: string;
  outputType: string;
  inputAmount: string; // base units as string
  expectedOutput: string; // base units as string
  digest?: string;
  status: 'submitted' | 'success' | 'failed';
  createdAt: string;
  error?: string;
}

export interface LaunchRecord {
  id: string;
  name: string;
  symbol: string;
  decimals: number;
  coinType?: string;
  treasuryCapId?: string;
  packageId?: string;
  digest?: string;
  status: 'submitted' | 'success' | 'failed';
  createdAt: string;
  error?: string;
}

export interface UserRecord {
  telegramId: string;
  address: string;
  /** Ciphertext of the Bech32 (suiprivkey...) secret key. */
  encryptedSecretKey: string;
  keyScheme: string;
  settings: UserSettings;
  trades: TradeRecord[];
  launches: LaunchRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface DatabaseShape {
  version: number;
  users: Record<string, UserRecord>;
}

export function emptyDatabase(): DatabaseShape {
  return { version: 1, users: {} };
}
