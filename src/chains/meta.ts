import type { ChainId, ChainMeta } from './types.js';

/** Native "coin" sentinels used when quoting a native<->token swap. */
export const NATIVE = {
  sui: '0x2::sui::SUI',
  solana: 'So11111111111111111111111111111111111111112', // wrapped SOL mint
  evm: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // aggregator native sentinel
  tron: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb', // wrapped TRX (WTRX)
} as const;

export const CHAINS: Record<ChainId, ChainMeta> = {
  sui: {
    id: 'sui', name: 'Sui', icon: '🌊', nativeSymbol: 'SUI', nativeDecimals: 9,
    nativeAddress: NATIVE.sui, dexScreenerChain: 'sui', family: 'sui',
  },
  solana: {
    id: 'solana', name: 'Solana', icon: '◎', nativeSymbol: 'SOL', nativeDecimals: 9,
    nativeAddress: NATIVE.solana, dexScreenerChain: 'solana', family: 'solana',
  },
  ethereum: {
    id: 'ethereum', name: 'Ethereum', icon: 'Ξ', nativeSymbol: 'ETH', nativeDecimals: 18,
    nativeAddress: NATIVE.evm, dexScreenerChain: 'ethereum', family: 'evm',
  },
  base: {
    id: 'base', name: 'Base', icon: '🔵', nativeSymbol: 'ETH', nativeDecimals: 18,
    nativeAddress: NATIVE.evm, dexScreenerChain: 'base', family: 'evm',
  },
  arbitrum: {
    id: 'arbitrum', name: 'Arbitrum', icon: '🔷', nativeSymbol: 'ETH', nativeDecimals: 18,
    nativeAddress: NATIVE.evm, dexScreenerChain: 'arbitrum', family: 'evm',
  },
  polygon: {
    id: 'polygon', name: 'Polygon', icon: '🟣', nativeSymbol: 'POL', nativeDecimals: 18,
    nativeAddress: NATIVE.evm, dexScreenerChain: 'polygon', family: 'evm',
  },
  bsc: {
    id: 'bsc', name: 'BNB Chain', icon: '🟡', nativeSymbol: 'BNB', nativeDecimals: 18,
    nativeAddress: NATIVE.evm, dexScreenerChain: 'bsc', family: 'evm',
  },
  tron: {
    id: 'tron', name: 'Tron', icon: '🔺', nativeSymbol: 'TRX', nativeDecimals: 6,
    nativeAddress: NATIVE.tron, dexScreenerChain: 'tron', family: 'tron',
  },
};

export const ALL_CHAINS: ChainId[] = Object.keys(CHAINS) as ChainId[];

/** EVM numeric chain ids, for aggregator/RPC selection. */
export const EVM_CHAIN_ID: Partial<Record<ChainId, number>> = {
  ethereum: 1,
  base: 8453,
  arbitrum: 42161,
  polygon: 137,
  bsc: 56,
};

/** Public RPC + explorer defaults per EVM chain (override RPC via config). */
export const EVM_DEFAULTS: Partial<Record<ChainId, { rpc: string; explorer: string; lifiChain: string }>> = {
  ethereum: { rpc: 'https://eth.llamarpc.com', explorer: 'https://etherscan.io', lifiChain: 'ETH' },
  base: { rpc: 'https://mainnet.base.org', explorer: 'https://basescan.org', lifiChain: 'BAS' },
  arbitrum: { rpc: 'https://arb1.arbitrum.io/rpc', explorer: 'https://arbiscan.io', lifiChain: 'ARB' },
  polygon: { rpc: 'https://polygon-rpc.com', explorer: 'https://polygonscan.com', lifiChain: 'POL' },
  bsc: { rpc: 'https://bsc-dataseed.binance.org', explorer: 'https://bscscan.com', lifiChain: 'BSC' },
};

export function isChainId(x: string): x is ChainId {
  return x in CHAINS;
}
