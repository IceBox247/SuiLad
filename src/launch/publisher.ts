import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Transaction } from '@mysten/sui/transactions';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { SuiService } from '../sui/service.js';
import type { Repo } from '../storage/repo.js';
import { deriveIdentifiers, generateCoinModule, generateMoveToml, validateLaunchParams } from './template.js';
import { patchCoinBytecode } from './patcher.js';
import type { LaunchParams, LaunchResult } from './types.js';
import { logger } from '../logger.js';

const execFileAsync = promisify(execFile);

export interface CompiledPackage {
  modules: string[]; // base64
  dependencies: string[]; // object ids / addresses
}

export interface LaunchServiceOptions {
  /** Path/command for the Sui CLI (used for the compile-based path). */
  suiCliPath?: string;
  /** Path to a file containing the base64 of the compiled reference coin template. */
  coinTemplatePath?: string;
}

/**
 * Publishes new coins to Sui. Two strategies, tried in order:
 *  1. Template bytecode patching (no compiler) — when `coinTemplatePath` is set.
 *  2. Sui CLI compilation — when the `sui` CLI is available.
 */
export class LaunchService {
  constructor(
    private readonly sui: SuiService,
    private readonly repo: Repo,
    private readonly options: LaunchServiceOptions = {},
  ) {}

  /** Preview the Move source that will be published (compile-based path). */
  previewSource(params: LaunchParams): { moveToml: string; source: string } {
    validateLaunchParams(params);
    const { moduleName } = deriveIdentifiers(params.symbol);
    return {
      moveToml: generateMoveToml(moduleName),
      source: generateCoinModule(params),
    };
  }

  /** Compile a coin package to publishable modules using the strategy available. */
  async compile(params: LaunchParams): Promise<CompiledPackage> {
    validateLaunchParams(params);
    if (this.options.coinTemplatePath) {
      return this.compileFromTemplate(params);
    }
    return this.compileWithCli(params);
  }

  private async compileFromTemplate(params: LaunchParams): Promise<CompiledPackage> {
    const b64 = (await readFile(this.options.coinTemplatePath!, 'utf8')).trim();
    const templateBytes = Uint8Array.from(Buffer.from(b64, 'base64'));
    const patched = await patchCoinBytecode(templateBytes, {
      symbol: params.symbol,
      name: params.name,
      decimals: params.decimals,
      description: params.description,
    });
    return {
      modules: [Buffer.from(patched).toString('base64')],
      // std (0x1) + sui (0x2) framework dependencies.
      dependencies: ['0x0000000000000000000000000000000000000000000000000000000000000001', '0x0000000000000000000000000000000000000000000000000000000000000002'],
    };
  }

  private async compileWithCli(params: LaunchParams): Promise<CompiledPackage> {
    const cli = this.options.suiCliPath || 'sui';
    const { moduleName } = deriveIdentifiers(params.symbol);
    const dir = await mkdtemp(join(tmpdir(), 'suipad-coin-'));
    try {
      await mkdir(join(dir, 'sources'), { recursive: true });
      await writeFile(join(dir, 'Move.toml'), generateMoveToml(moduleName), 'utf8');
      await writeFile(join(dir, 'sources', `${moduleName}.move`), generateCoinModule(params), 'utf8');
      const { stdout } = await execFileAsync(
        cli,
        ['move', 'build', '--dump-bytecode-as-base64', '--path', dir],
        { maxBuffer: 32 * 1024 * 1024 },
      );
      const parsed = JSON.parse(lastJsonLine(stdout)) as CompiledPackage;
      if (!parsed.modules?.length) throw new Error('Sui CLI returned no modules.');
      return parsed;
    } catch (err) {
      const msg = (err as Error).message;
      if (/ENOENT/.test(msg)) {
        throw new Error(
          'Sui CLI not found. Install it (https://docs.sui.io/references/cli) or set COIN_TEMPLATE_PATH to use compiler-free launching.',
        );
      }
      throw new Error(`Move build failed: ${msg}`);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** Compile + publish a new coin, recording the launch and returning key ids. */
  async launch(params: {
    telegramId: string;
    signer: Ed25519Keypair;
    coin: LaunchParams;
  }): Promise<LaunchResult> {
    const { telegramId, signer, coin } = params;
    const launchId = randomUUID();
    await this.repo.withUser(telegramId, (u) => {
      u.launches.unshift({
        id: launchId,
        name: coin.name,
        symbol: coin.symbol,
        decimals: coin.decimals,
        status: 'submitted',
        createdAt: new Date().toISOString(),
      });
    });

    try {
      const pkg = await this.compile(coin);
      const tx = new Transaction();
      tx.setSender(signer.toSuiAddress());
      // publish returns the package's UpgradeCap; transfer it to the creator.
      const upgradeCap = tx.publish({ modules: pkg.modules, dependencies: pkg.dependencies });
      tx.transferObjects([upgradeCap], signer.toSuiAddress());

      const res = await this.sui.executeFull(signer, tx);
      const parsed = parsePublish(res.objectChanges ?? []);
      const result: LaunchResult = { digest: res.digest, ...parsed };

      await this.repo.withUser(telegramId, (u) => {
        const l = u.launches.find((x) => x.id === launchId);
        if (l) {
          l.status = 'success';
          l.digest = res.digest;
          l.packageId = result.packageId;
          l.coinType = result.coinType;
          l.treasuryCapId = result.treasuryCapId;
        }
      });
      return result;
    } catch (err) {
      logger.error('launch failed', { error: (err as Error).message });
      await this.repo.withUser(telegramId, (u) => {
        const l = u.launches.find((x) => x.id === launchId);
        if (l) {
          l.status = 'failed';
          l.error = (err as Error).message;
        }
      }).catch(() => {});
      throw err;
    }
  }
}

interface ObjectChangeLike {
  type: string;
  packageId?: string;
  objectId?: string;
  objectType?: string;
}

/** Extract package id, coin type, TreasuryCap and CoinMetadata ids from object changes. */
export function parsePublish(changes: ObjectChangeLike[]): {
  packageId: string;
  coinType: string;
  treasuryCapId?: string;
  metadataId?: string;
} {
  let packageId = '';
  let treasuryCapId: string | undefined;
  let metadataId: string | undefined;
  let coinType = '';

  for (const c of changes) {
    if (c.type === 'published' && c.packageId) {
      packageId = c.packageId;
    }
    const t = c.objectType ?? '';
    const treasuryMatch = t.match(/::coin::TreasuryCap<(.+)>$/);
    if (treasuryMatch) {
      treasuryCapId = c.objectId;
      coinType = treasuryMatch[1]!;
    }
    const metaMatch = t.match(/::coin::CoinMetadata<(.+)>$/);
    if (metaMatch) {
      metadataId = c.objectId;
      if (!coinType) coinType = metaMatch[1]!;
    }
  }
  if (!packageId) throw new Error('Publish succeeded but no package id was found in the result.');
  return { packageId, coinType, treasuryCapId, metadataId };
}

function lastJsonLine(stdout: string): string {
  // The CLI may print warnings before the JSON; take the last {...} block.
  const trimmed = stdout.trim();
  const start = trimmed.lastIndexOf('{');
  const startArr = trimmed.lastIndexOf('[');
  const idx = Math.max(start, startArr);
  return idx >= 0 ? trimmed.slice(idx) : trimmed;
}
