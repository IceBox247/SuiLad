import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import type { LogLevel } from './logger.js';

loadDotenv();

/**
 * Default RPC endpoints per network.
 *
 * Sui's own public fullnodes (fullnode.<net>.sui.io) have DEPRECATED the classic
 * JSON-RPC methods this bot (and the Cetus SDK) rely on, returning
 * "Method not found". We therefore default to JSON-RPC-compatible community
 * providers. For production/mainnet, set SUI_RPC_URL to your own node or a
 * dedicated provider (e.g. an API-key endpoint) for reliability and rate limits.
 */
export const NETWORK_RPC: Record<string, string> = {
  mainnet: 'https://sui-rpc.publicnode.com',
  testnet: 'https://sui-testnet-rpc.publicnode.com',
  devnet: 'https://fullnode.devnet.sui.io',
  localnet: 'http://127.0.0.1:9000',
};

const csvIds = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const RawSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  ALLOWED_TELEGRAM_IDS: csvIds,
  SUI_NETWORK: z
    .enum(['mainnet', 'testnet', 'devnet', 'localnet', 'custom'])
    .default('testnet'),
  SUI_RPC_URL: z.string().url().optional().or(z.literal('')),
  WALLET_ENCRYPTION_KEY: z
    .string()
    .min(32, 'WALLET_ENCRYPTION_KEY must be at least 32 characters (use `openssl rand -hex 32`)'),
  SWAP_PROVIDER: z.enum(['mock', 'sevenk', 'cetus']).default('mock'),
  SWAP_API_BASE_URL: z.string().url().optional().or(z.literal('')),
  DEFAULT_SLIPPAGE_BPS: z.coerce.number().int().min(1).max(5000).default(100),
  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(500).default(0),
  PLATFORM_FEE_ADDRESS: z.string().optional().or(z.literal('')),
  DATA_FILE: z.string().default('./data/suipad.json'),
  SUI_CLI_PATH: z.string().optional().or(z.literal('')),
  COIN_TEMPLATE_PATH: z.string().optional().or(z.literal('')),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export interface AppConfig {
  telegramBotToken: string;
  allowedTelegramIds: string[];
  network: string;
  rpcUrl: string;
  walletEncryptionKey: string;
  swapProvider: 'mock' | 'sevenk' | 'cetus';
  swapApiBaseUrl: string;
  defaultSlippageBps: number;
  platformFeeBps: number;
  platformFeeAddress: string;
  dataFile: string;
  suiCliPath: string;
  coinTemplatePath: string;
  logLevel: LogLevel;
}

/**
 * Parse and validate configuration from `env` (defaults to process.env).
 * Throws a readable aggregated error when required values are missing.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = RawSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const raw = parsed.data;

  const network = raw.SUI_NETWORK;
  let rpcUrl = raw.SUI_RPC_URL || '';
  if (!rpcUrl) {
    if (network === 'custom') {
      throw new Error('SUI_NETWORK=custom requires SUI_RPC_URL to be set.');
    }
    rpcUrl = NETWORK_RPC[network]!;
  }

  if ((raw.SWAP_PROVIDER === 'sevenk' || raw.SWAP_PROVIDER === 'cetus') && !raw.SWAP_API_BASE_URL) {
    // Not fatal — providers fall back to their well-known defaults — but warn-worthy.
  }

  if (raw.PLATFORM_FEE_BPS > 0 && !raw.PLATFORM_FEE_ADDRESS) {
    throw new Error('PLATFORM_FEE_BPS > 0 requires PLATFORM_FEE_ADDRESS to be set.');
  }

  return {
    telegramBotToken: raw.TELEGRAM_BOT_TOKEN,
    allowedTelegramIds: raw.ALLOWED_TELEGRAM_IDS,
    network,
    rpcUrl,
    walletEncryptionKey: raw.WALLET_ENCRYPTION_KEY,
    swapProvider: raw.SWAP_PROVIDER,
    swapApiBaseUrl: raw.SWAP_API_BASE_URL || '',
    defaultSlippageBps: raw.DEFAULT_SLIPPAGE_BPS,
    platformFeeBps: raw.PLATFORM_FEE_BPS,
    platformFeeAddress: raw.PLATFORM_FEE_ADDRESS || '',
    dataFile: raw.DATA_FILE,
    suiCliPath: raw.SUI_CLI_PATH || '',
    coinTemplatePath: raw.COIN_TEMPLATE_PATH || '',
    logLevel: raw.LOG_LEVEL,
  };
}
