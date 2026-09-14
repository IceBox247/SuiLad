import { SuiClient } from '@mysten/sui/client';

/**
 * Build a SuiClient for the given RPC URL.
 *
 * Note: public Sui full nodes have deprecated parts of the JSON-RPC surface for
 * mainnet. For production/mainnet use a dedicated RPC provider or your own node
 * (set SUI_RPC_URL). Testnet/devnet public endpoints work out of the box.
 */
export function createSuiClient(rpcUrl: string): SuiClient {
  return new SuiClient({ url: rpcUrl });
}

export type { SuiClient };
