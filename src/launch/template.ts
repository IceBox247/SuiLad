import { isMoveIdentifier } from '../util/validate.js';
import type { LaunchParams } from './types.js';

/**
 * Derive the on-chain identifiers for a coin from its symbol.
 * - module name: lowercased, sanitized symbol (Move module identifier)
 * - witness (OTW): the uppercased module name (must equal the module name upper)
 */
export function deriveIdentifiers(symbol: string): { moduleName: string; witness: string } {
  const cleaned = symbol.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
  let moduleName = cleaned.replace(/^[^a-z_]+/, '');
  if (moduleName === '') moduleName = 'coin';
  if (!isMoveIdentifier(moduleName)) throw new Error(`Cannot derive a valid module name from "${symbol}"`);
  return { moduleName, witness: moduleName.toUpperCase() };
}

/** Escape a string for inclusion in a Move byte-string literal `b"..."`. */
export function escapeMoveByteString(value: string): string {
  // Move byte strings are ASCII. Reject non-ASCII to avoid producing invalid Move.
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (code > 0x7f) throw new Error('Only ASCII characters are allowed in name/symbol/description.');
  }
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/** Validate launch parameters, throwing a user-friendly error on the first problem. */
export function validateLaunchParams(p: LaunchParams): void {
  if (!p.name.trim()) throw new Error('Token name is required.');
  if (p.name.length > 32) throw new Error('Token name must be at most 32 characters.');
  if (!p.symbol.trim()) throw new Error('Token symbol is required.');
  if (p.symbol.length > 10) throw new Error('Token symbol must be at most 10 characters.');
  if (!Number.isInteger(p.decimals) || p.decimals < 0 || p.decimals > 18) {
    throw new Error('Decimals must be an integer between 0 and 18.');
  }
  if (p.description.length > 256) throw new Error('Description must be at most 256 characters.');
  if (p.initialSupply < 0n) throw new Error('Initial supply cannot be negative.');
  if (p.iconUrl && !/^https?:\/\//.test(p.iconUrl)) {
    throw new Error('Icon URL must start with http:// or https://');
  }
  // Ensure identifiers are derivable.
  deriveIdentifiers(p.symbol);
}

/**
 * Generate the Move source for a coin module (Move 2024 edition). The creator
 * receives the initial supply (if any); the TreasuryCap is either transferred to
 * the creator (mint authority kept) or frozen (fixed supply). The CoinMetadata
 * is frozen so wallets can read it.
 */
export function generateCoinModule(p: LaunchParams): string {
  validateLaunchParams(p);
  const { moduleName, witness } = deriveIdentifiers(p.symbol);
  const name = escapeMoveByteString(p.name);
  const symbol = escapeMoveByteString(p.symbol);
  const description = escapeMoveByteString(p.description);

  const iconExpr = p.iconUrl
    ? `option::some(sui::url::new_unsafe_from_bytes(b"${escapeMoveByteString(p.iconUrl)}"))`
    : 'option::none()';

  // Initial supply is expressed in base units = whole tokens * 10^decimals.
  const baseUnits = p.initialSupply * 10n ** BigInt(p.decimals);

  const mintBlock =
    p.initialSupply > 0n
      ? `        coin::mint_and_transfer(&mut treasury, ${baseUnits}u64, ctx.sender(), ctx);\n`
      : '';

  const treasuryDisposition = p.keepMintAuthority
    ? '        transfer::public_transfer(treasury, ctx.sender());'
    : `        // Fixed supply: destroy the mint authority so no more can ever be minted.\n        transfer::public_freeze_object(treasury);`;

  const mutTreasury = p.initialSupply > 0n ? 'mut ' : '';

  return `module ${moduleName}::${moduleName};

use sui::coin;

/// One-Time-Witness for the coin. Its name must match the module name (uppercased).
public struct ${witness} has drop {}

fun init(witness: ${witness}, ctx: &mut TxContext) {
    let (${mutTreasury}treasury, metadata) = coin::create_currency(
        witness,
        ${p.decimals},
        b"${symbol}",
        b"${name}",
        b"${description}",
        ${iconExpr},
        ctx,
    );
${mintBlock}    transfer::public_freeze_object(metadata);
${treasuryDisposition}
}
`;
}

/** Generate a Move.toml for the coin package. */
export function generateMoveToml(packageName: string): string {
  const name = packageName.replace(/[^A-Za-z0-9_]/g, '_') || 'coin';
  return `[package]
name = "${name}"
edition = "2024.beta"

[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "framework/mainnet" }

[addresses]
${name} = "0x0"
`;
}
