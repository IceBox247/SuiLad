import type { SuiClient } from '@mysten/sui/client';

export interface FakeClientConfig {
  balances?: Record<string, string>; // coinType -> totalBalance
  metadata?: Record<string, { decimals: number; symbol: string; name: string } | null>;
  coins?: Record<string, string[]>; // coinType -> objectIds
  executeResult?: {
    digest?: string;
    status?: 'success' | 'failure';
    error?: string;
    objectChanges?: unknown[];
  };
}

/** Records of calls made to the fake, for assertions. */
export interface FakeClientCalls {
  executed: number;
  waited: string[];
  lastTransaction?: unknown;
}

/** Build a structurally-typed fake SuiClient covering the methods SuiService uses. */
export function makeFakeClient(cfg: FakeClientConfig = {}): {
  client: SuiClient;
  calls: FakeClientCalls;
} {
  const calls: FakeClientCalls = { executed: 0, waited: [] };
  const client = {
    async getBalance({ coinType }: { owner: string; coinType: string }) {
      return { totalBalance: cfg.balances?.[coinType] ?? '0', coinType };
    },
    async getAllBalances({}: { owner: string }) {
      return Object.entries(cfg.balances ?? {}).map(([coinType, totalBalance]) => ({
        coinType,
        totalBalance,
      }));
    },
    async getCoinMetadata({ coinType }: { coinType: string }) {
      return cfg.metadata?.[coinType] ?? null;
    },
    async getCoins({ coinType }: { owner: string; coinType: string }) {
      const ids = cfg.coins?.[coinType] ?? [];
      return { data: ids.map((coinObjectId) => ({ coinObjectId })), hasNextPage: false };
    },
    async signAndExecuteTransaction({ transaction }: { transaction: unknown }) {
      calls.executed += 1;
      calls.lastTransaction = transaction;
      const r = cfg.executeResult ?? {};
      return {
        digest: r.digest ?? 'DIGEST_TEST',
        effects: { status: { status: r.status ?? 'success', error: r.error } },
        objectChanges: r.objectChanges ?? [],
      };
    },
    async waitForTransaction({ digest }: { digest: string }) {
      calls.waited.push(digest);
      return { digest };
    },
  } as unknown as SuiClient;
  return { client, calls };
}
