import type { Context } from 'grammy';
import type { AppConfig } from '../config.js';
import type { Repo } from '../storage/repo.js';
import type { SuiService } from '../sui/service.js';
import type { WalletService } from '../services/walletService.js';
import type { TradeService } from '../trade/tradeService.js';
import type { ReferralService } from '../services/referralService.js';
import type { PayoutService } from '../services/payoutService.js';
import type { SecurityService } from '../services/security.js';
import type { OrderEngine } from '../services/orderEngine.js';
import type { CopyTradeService } from '../services/copyTrade.js';
import type { SniperService } from '../services/sniperService.js';
import type { WatchlistService } from '../services/watchlistService.js';
import type { BundleService } from '../services/bundleService.js';
import type { LaunchService } from '../launch/publisher.js';
import type { LaunchpadClient } from '../launch/launchpadClient.js';
import type { BridgeService } from '../bridge/index.js';
import type { PriceOracle } from '../trade/priceOracle.js';
import type { DexScreener } from '../services/dexscreener.js';
import type { ChartService } from '../services/chart.js';
import type { MultiWalletService } from '../services/multiWallet.js';
import type { ChainAdapter, ChainId } from '../chains/types.js';
import type { SessionStore } from './session.js';

export interface Services {
  config: AppConfig;
  repo: Repo;
  sui: SuiService;
  oracle: PriceOracle;
  dex: DexScreener;
  chart: ChartService;
  wallet: WalletService;
  trade: TradeService;
  referral: ReferralService;
  /** On-chain referral payouts; present only when FEE_WALLET_SECRET is set. */
  payout?: PayoutService;
  security: SecurityService;
  orders: OrderEngine;
  copy: CopyTradeService;
  sniper: SniperService;
  watchlist: WatchlistService;
  bundle: BundleService;
  launch: LaunchService;
  launchpad: LaunchpadClient;
  bridge: BridgeService;
  /** Per-chain wallets for the multi-chain platform. */
  multiWallet: MultiWalletService;
  /** Non-Sui chain adapters, keyed by ChainId. */
  adapters: Partial<Record<ChainId, ChainAdapter>>;
  sessions: SessionStore;
  /** Short-lived cache for objects (prepared quotes, launch params). */
  pending: Map<string, unknown>;
}

export type BotContext = Context & { services: Services };
