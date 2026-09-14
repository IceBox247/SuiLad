import { describe, it, expect } from 'vitest';
import { parsePublish } from '../src/launch/publisher.js';

describe('parsePublish', () => {
  it('extracts package, coin type, treasury cap and metadata', () => {
    const coinType = '0xpkg::myc::MYC';
    const changes = [
      { type: 'published', packageId: '0xpkg' },
      {
        type: 'created',
        objectId: '0xtreasury',
        objectType: `0x2::coin::TreasuryCap<${coinType}>`,
      },
      {
        type: 'created',
        objectId: '0xmeta',
        objectType: `0x2::coin::CoinMetadata<${coinType}>`,
      },
      { type: 'created', objectId: '0xcap', objectType: '0x2::package::UpgradeCap' },
    ];
    const res = parsePublish(changes);
    expect(res.packageId).toBe('0xpkg');
    expect(res.coinType).toBe(coinType);
    expect(res.treasuryCapId).toBe('0xtreasury');
    expect(res.metadataId).toBe('0xmeta');
  });

  it('throws when no package id present', () => {
    expect(() => parsePublish([{ type: 'created', objectId: '0x1' }])).toThrow(/package id/);
  });
});
