import { bcs } from '@mysten/bcs';
import init, {
  deserialize,
  serialize,
  update_constants,
  update_identifiers,
} from '@mysten/move-bytecode-template';
import { deriveIdentifiers } from './template.js';

/**
 * Defaults describing the reference coin template documented by
 * `@mysten/move-bytecode-template` (module `template`, witness `TEMPLATE`).
 * These are the values that get replaced when patching a compiled template.
 */
export interface TemplateDefaults {
  witness: string; // "TEMPLATE"
  moduleName: string; // "template"
  decimals: number; // 6
  symbol: string; // "TMPL"
  name: string; // "Template Coin"
  description: string; // "Template Coin Description"
}

export const REFERENCE_TEMPLATE: TemplateDefaults = {
  witness: 'TEMPLATE',
  moduleName: 'template',
  decimals: 6,
  symbol: 'TMPL',
  name: 'Template Coin',
  description: 'Template Coin Description',
};

export interface PatchInput {
  symbol: string;
  name: string;
  decimals: number;
  description: string;
}

let wasmReady: Promise<void> | null = null;
function ensureWasm(): Promise<void> {
  if (!wasmReady) wasmReady = Promise.resolve(init()).then(() => undefined);
  return wasmReady;
}

/**
 * Patch a compiled coin template's bytecode with new identifiers and metadata
 * constants, producing publishable module bytecode — no Move compiler required.
 *
 * `templateBytes` must be the compiled bytecode of the reference template
 * (see scripts/build-coin-template.ts for how to produce it).
 */
export async function patchCoinBytecode(
  templateBytes: Uint8Array,
  input: PatchInput,
  defaults: TemplateDefaults = REFERENCE_TEMPLATE,
): Promise<Uint8Array> {
  await ensureWasm();
  const { moduleName, witness } = deriveIdentifiers(input.symbol);

  let bytecode = update_identifiers(templateBytes, {
    [defaults.witness]: witness,
    [defaults.moduleName]: moduleName,
  });

  // DECIMALS (U8)
  bytecode = update_constants(
    bytecode,
    bcs.u8().serialize(input.decimals).toBytes(),
    bcs.u8().serialize(defaults.decimals).toBytes(),
    'U8',
  );
  // SYMBOL (vector<u8>)
  bytecode = update_constants(
    bytecode,
    bcs.string().serialize(input.symbol).toBytes(),
    bcs.string().serialize(defaults.symbol).toBytes(),
    'Vector(U8)',
  );
  // NAME (vector<u8>)
  bytecode = update_constants(
    bytecode,
    bcs.string().serialize(input.name).toBytes(),
    bcs.string().serialize(defaults.name).toBytes(),
    'Vector(U8)',
  );
  // DESCRIPTION (vector<u8>)
  bytecode = update_constants(
    bytecode,
    bcs.string().serialize(input.description).toBytes(),
    bcs.string().serialize(defaults.description).toBytes(),
    'Vector(U8)',
  );

  // Round-trip through (de)serialize to validate the patched module is well-formed.
  const json = deserialize(bytecode);
  return serialize(json);
}
