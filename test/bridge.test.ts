import { describe, it, expect } from 'vitest';
import { MockBridgeProvider } from '../src/bridge/mock.js';
import { parseBridgeQuote } from '../src/bridge/http.js';
import type { BridgeQuoteRequest } from '../src/bridge/types.js';

const req: BridgeQuoteRequest = {
  fromChain: 'sui',
  toChain: 'ethereum',
  fromToken: 'USDC',
  toToken: 'USDC',
  amount: '100',
  toAddress: '0xdead',
};

describe('bridging', () => {
  it('mock provider quotes with a fee', async () => {
    const p = new MockBridgeProvider(0.001);
    const q = await p.quote(req);
    expect(Number(q.estAmountOut)).toBeCloseTo(99.9, 5);
    expect(q.fromChain).toBe('sui');
    expect(q.toChain).toBe('ethereum');
  });

  it('mock rejects same-chain and unsupported', async () => {
    const p = new MockBridgeProvider();
    await expect(p.quote({ ...req, toChain: 'sui' })).rejects.toThrow();
  });

  it('parses various aggregator response shapes', () => {
    const a = parseBridgeQuote({ estimation: { dstAmount: '98.5', feeUsd: '1.5', etaSeconds: 90 } }, req, 'debridge');
    expect(a.estAmountOut).toBe('98.5');
    expect(a.feeUsd).toBe('1.5');
    expect(a.etaSeconds).toBe(90);

    const b = parseBridgeQuote({ toAmount: '97', estimatedTransferTime: 120 }, req, 'mayan');
    expect(b.estAmountOut).toBe('97');
    expect(b.etaSeconds).toBe(120);

    const c = parseBridgeQuote({ estimation: { dstChainTokenOut: { amount: '96' } } }, req, 'debridge');
    expect(c.estAmountOut).toBe('96');
  });

  it('throws when no output amount present', () => {
    expect(() => parseBridgeQuote({ estimation: {} }, req, 'debridge')).toThrow(/output amount/);
  });
});
