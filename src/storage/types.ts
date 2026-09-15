/** Persisted data model. All secret material is stored encrypted. */

export interface UserSettings {
  /** Slippage tolerance in basis points (100 = 1%). */
  slippageBps: number;
  /** MEV-aware execution (tight min-out, no early broadcast, priority gas). */
  mevProtection: boolean;
  /** Extra gas budget in MIST to prioritize inclusion (0 = default). */
  priorityGasMist: string;
  /** Quick-buy presets, in SUI (e.g. ["0.1","0.5","1"]). */
  quickBuySui: string[];
  /** Auto-buy: instantly buy `autoBuySui` when a coin type is pasted. */
  autoBuy: boolean;
  autoBuySui: string;
}

export function defaultSettings(slippageBps: number): UserSettings {
  return {
    slippageBps,
    mevProtection: true,
    priorityGasMist: '0',
    quickBuySui: ['0.1', '0.5', '1', '5'],
    autoBuy: false,
    autoBuySui: '1',
  };
}

/** A per-chain wallet (for the multi-chain rollout). Secrets stored encrypted. */
export interface ChainWallet {
  address: string;
  encryptedSecretKey: string;
  scheme: string;
  createdAt: string;
}

export interface SubWallet {
  id: string;
  address: string;
  encryptedSecretKey: string;
  label: string;
  createdAt: string;
}

export interface ReferralInfo {
  /** This user's own referral code. */
  code: string;
  /** The user who referred them (their upline L1), if any. */
  referrerId?: string;
  /** Unclaimed referral earnings, in MIST. */
  unclaimedMist: string;
  /** Lifetime referral earnings, in MIST. */
  totalEarnedMist: string;
  /** Downline counts per level [L1..L5]. */
  levelCounts: [number, number, number, number, number];
}

export function defaultReferral(code: string, referrerId?: string): ReferralInfo {
  return {
    code,
    referrerId,
    unclaimedMist: '0',
    totalEarnedMist: '0',
    levelCounts: [0, 0, 0, 0, 0],
  };
}

/** A tracked position for PnL, TP/SL. Amounts in base units; cost in MIST. */
export interface Position {
  coinType: string;
  symbol: string;
  decimals: number;
  /** Token amount currently held (base units), as tracked by the bot. */
  amount: string;
  /** Total SUI (MIST) spent acquiring the current amount. */
  costMist: string;
  /** Realized PnL in MIST across closed portions. */
  realizedPnlMist: string;
  updatedAt: string;
}

/** A tracked position on a non-Sui chain (for cross-chain PnL). */
export interface ChainPosition {
  token: string;
  symbol: string;
  decimals: number;
  /** Token amount currently held (base units), as tracked by the bot. */
  amount: string;
  /** Total native token (base units) spent acquiring the current amount. */
  costNative: string;
  /** Realized PnL in native base units across closed portions. */
  realizedNative: string;
  updatedAt: string;
}

export type OrderKind = 'limit_buy' | 'limit_sell' | 'take_profit' | 'stop_loss' | 'dca';

export interface Order {
  id: string;
  kind: OrderKind;
  coinType: string;
  /** Trigger price in SUI-per-token (18-dp fixed string). Omitted for pure DCA. */
  triggerPrice?: string;
  /** For limit_buy: SUI (human) to spend when triggered. */
  amountSui?: string;
  /** For sells/TP/SL: percentage (1-100) of holdings to sell when triggered. */
  sellPercent?: number;
  /** DCA schedule. */
  dca?: { intervalSec: number; totalBuys: number; completed: number; amountSui: string; nextRunAt: string };
  status: 'active' | 'done' | 'cancelled' | 'failed';
  createdAt: string;
  lastRunAt?: string;
  error?: string;
}

export interface CopyConfig {
  id: string;
  leaderAddress: string;
  /** Fraction of the leader's trade to mirror, in bps of your maxSui budget. */
  ratioBps: number;
  /** Max SUI to spend per mirrored buy. */
  maxSui: string;
  active: boolean;
  createdAt: string;
}

export interface SnipeConfig {
  id: string;
  /** Snipe a specific coin type once it becomes tradeable, or a launchpad token. */
  coinType?: string;
  launchId?: string;
  amountSui: string;
  /** Max slippage tolerated for the snipe (bps). */
  maxSlippageBps: number;
  active: boolean;
  createdAt: string;
}

export interface WatchItem {
  coinType: string;
  symbol: string;
  /** Optional price alert: notify when price crosses this (SUI per token). */
  alertPrice?: string;
  direction?: 'above' | 'below';
  addedAt: string;
}

export interface TradeRecord {
  id: string;
  kind: 'buy' | 'sell' | 'swap' | 'copy' | 'snipe' | 'bundle' | 'dca' | 'order';
  inputType: string;
  outputType: string;
  inputAmount: string;
  expectedOutput: string;
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
  curveId?: string;
  digest?: string;
  status: 'submitted' | 'success' | 'failed';
  createdAt: string;
  error?: string;
}

export interface UserRecord {
  telegramId: string;
  address: string;
  encryptedSecretKey: string;
  keyScheme: string;
  settings: UserSettings;
  referral: ReferralInfo;
  subWallets: SubWallet[];
  positions: Position[];
  orders: Order[];
  copies: CopyConfig[];
  snipes: SnipeConfig[];
  watchlist: WatchItem[];
  trades: TradeRecord[];
  launches: LaunchRecord[];
  /** Cashback ledger — a rebate of the user's own trading fees (MIST). */
  cashback?: { unclaimedMist: string; totalMist: string };
  /**
   * Per-chain positions for non-Sui chains, keyed by `${chain}:${token}`.
   * Amounts are base units; `costNative`/`realizedNative` are in the chain's
   * native token base units. Kept separate from `positions` (which is Sui-only)
   * so the Sui trading path is untouched.
   */
  chainPositions?: Record<string, ChainPosition>;
  /** Per-chain wallets keyed by ChainId (Sui also lives in the top-level fields). */
  wallets?: Record<string, ChainWallet>;
  /** The chain the user is currently trading on (defaults to "sui"). */
  activeChain?: string;
  /** Optional ban timestamp (ISO) — set by anti-abuse controls. */
  bannedUntil?: string;
  createdAt: string;
  updatedAt: string;
}

/** Index keys used to bound cron scans and resolve referral codes. */
export const IDX = {
  refCode: (code: string) => `refcode:${code}`,
  user: (id: string) => `u:${id}`,
  ordersActive: 'idx:orders',
  copyActive: 'idx:copy',
  snipeActive: 'idx:snipe',
  alertsActive: 'idx:alerts',
  leaderFollowers: (leader: string) => `idx:leader:${leader.toLowerCase()}`,
} as const;
