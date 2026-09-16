import { describe, it, expect, vi } from 'vitest';
import { renderPnlCard } from '../src/services/pnlCard.js';

describe('renderPnlCard', () => {
  it('returns null gracefully when the font cannot be fetched', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const png = await renderPnlCard(
      { symbol: 'TEST', chainLabel: 'Sui', side: 'BUY', returnPct: 12.3, initial: '1 SUI', worth: '1.12 SUI' },
      fetchImpl,
    );
    expect(png).toBeNull();
  });
});
