import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

export interface GeneratedWallet {
  address: string;
  /** Bech32-encoded secret key (`suiprivkey1...`). Store encrypted only. */
  secretKey: string;
  publicKeyBase64: string;
  scheme: string;
}

/** Create a brand new Ed25519 wallet. */
export function createWallet(): GeneratedWallet {
  const keypair = Ed25519Keypair.generate();
  return describe(keypair);
}

/**
 * Import a wallet from a secret key. Accepts either the Bech32 form
 * (`suiprivkey1...`) or a 32/64-char hex string (with or without 0x).
 */
export function importWallet(secret: string): GeneratedWallet {
  const trimmed = secret.trim();
  if (trimmed.startsWith('suiprivkey')) {
    const keypair = Ed25519Keypair.fromSecretKey(trimmed);
    return describe(keypair);
  }
  const hex = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('Private key must be a `suiprivkey1...` string or 64 hex characters.');
  }
  const bytes = Uint8Array.from(Buffer.from(hex, 'hex'));
  const keypair = Ed25519Keypair.fromSecretKey(bytes);
  return describe(keypair);
}

/** Reconstruct a signing keypair from a stored Bech32 secret key. */
export function keypairFromSecret(secretKey: string): Ed25519Keypair {
  return Ed25519Keypair.fromSecretKey(secretKey.trim());
}

/** True if the string is a decodable Sui secret key (bech32 or hex). */
export function isValidSecretKey(secret: string): boolean {
  try {
    importWallet(secret);
    return true;
  } catch {
    return false;
  }
}

function describe(keypair: Ed25519Keypair): GeneratedWallet {
  return {
    address: keypair.toSuiAddress(),
    secretKey: keypair.getSecretKey(),
    publicKeyBase64: keypair.getPublicKey().toBase64(),
    scheme: 'ED25519',
  };
}
