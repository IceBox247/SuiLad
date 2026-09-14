import type { Context } from 'grammy';
import type { AppConfig } from '../config.js';
import type { Store } from '../storage/store.js';
import type { SuiService } from '../sui/service.js';
import type { WalletService } from '../services/walletService.js';
import type { TradeService } from '../trade/tradeService.js';
import type { LaunchService } from '../launch/publisher.js';
import type { SessionStore } from './session.js';

export interface Services {
  config: AppConfig;
  store: Store;
  sui: SuiService;
  wallet: WalletService;
  trade: TradeService;
  launch: LaunchService;
  sessions: SessionStore;
  /** Short-lived cache for objects (prepared quotes, launch params) keyed by `${id}:${kind}`. */
  pending: Map<string, unknown>;
}

export type BotContext = Context & { services: Services };
