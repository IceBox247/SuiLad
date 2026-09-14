/**
 * Build the reference coin template once and dump its compiled bytecode as
 * base64 to `assets/coin-template.b64`. Run this a single time on a machine
 * that has the Sui CLI installed; afterwards the bot can launch coins with no
 * compiler by setting COIN_TEMPLATE_PATH=assets/coin-template.b64.
 *
 *   npx tsx scripts/build-coin-template.ts
 *
 * The source below MUST match the constants in src/launch/patcher.ts
 * (REFERENCE_TEMPLATE), because patching replaces those exact values.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const MOVE_TOML = `[package]
name = "template"
edition = "2024.beta"

[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "framework/mainnet" }

[addresses]
template = "0x0"
`;

const SOURCE = `module template::template;

use sui::coin;

public struct TEMPLATE has drop {}

const DECIMALS: u8 = 6;
const SYMBOL: vector<u8> = b"TMPL";
const NAME: vector<u8> = b"Template Coin";
const DESCRIPTION: vector<u8> = b"Template Coin Description";

fun init(witness: TEMPLATE, ctx: &mut TxContext) {
    let (treasury, metadata) = coin::create_currency(
        witness, DECIMALS, SYMBOL, NAME, DESCRIPTION, option::none(), ctx,
    );
    transfer::public_transfer(treasury, ctx.sender());
    transfer::public_freeze_object(metadata);
}
`;

async function main() {
  const cli = process.env.SUI_CLI_PATH || 'sui';
  const dir = await mkdtemp(join(tmpdir(), 'suipad-template-'));
  try {
    await mkdir(join(dir, 'sources'), { recursive: true });
    await writeFile(join(dir, 'Move.toml'), MOVE_TOML, 'utf8');
    await writeFile(join(dir, 'sources', 'template.move'), SOURCE, 'utf8');
    const { stdout } = await execFileAsync(
      cli,
      ['move', 'build', '--dump-bytecode-as-base64', '--path', dir],
      { maxBuffer: 32 * 1024 * 1024 },
    );
    const idx = Math.max(stdout.lastIndexOf('{'), stdout.lastIndexOf('['));
    const parsed = JSON.parse(stdout.slice(idx)) as { modules: string[] };
    const b64 = parsed.modules[0];
    if (!b64) throw new Error('No module produced.');
    await mkdir('assets', { recursive: true });
    await writeFile('assets/coin-template.b64', b64, 'utf8');
    console.log('Wrote assets/coin-template.b64 (' + b64.length + ' base64 chars).');
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
