import type { Context } from 'grammy';
import type { AppConfig } from '../config.js';
import type { Repo } from '../storage/repo.js';
import type { SuiService } from '../sui/service.js';
import type { WalletService } from '../services/walletService.js';
import type { TradeService } from '../trade/tradeService.js';
import type { ReferralService } from '../services/referralService.js';
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
import type { SessionStore } from './session.js';

export interface Services {
  config: AppConfig;
  repo: Repo;
  sui: SuiService;
  oracle: PriceOracle;
  wallet: WalletService;
  trade: TradeService;
  referral: ReferralService;
  security: SecurityService;
  orders: OrderEngine;
  copy: CopyTradeService;
  sniper: SniperService;
  watchlist: WatchlistService;
  bundle: BundleService;
  launch: LaunchService;
  launchpad: LaunchpadClient;
  bridge: BridgeService;
  sessions: SessionStore;
  /** Short-lived cache for objects (prepared quotes, launch params). */
  pending: Map<string, unknown>;
}

export type BotContext = Context & { services: Services };
