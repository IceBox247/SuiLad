import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { logger } from '../logger.js';

/**
 * Renders a shareable PnL "flex card" PNG (BonkBot / Photon style) for a
 * position. Uses @resvg/resvg-wasm (pure WASM, Vercel-safe) to rasterize an
 * SVG. The WASM ships with the package; the font is fetched once at cold start
 * and cached in memory.
 */

export interface PnlCardData {
  symbol: string;
  chainLabel: string;
  side: 'BUY' | 'SELL' | 'POSITION';
  /** Return as a percentage (e.g. 36.12 or -81.54). */
  returnPct: number;
  /** "Initial" value line, e.g. "5.00 USDC". */
  initial: string;
  /** "Worth" value line, e.g. "5.23 USDC". */
  worth: string;
  /** Avg entry price line, e.g. "$3.7e-9". */
  avgEntry?: string;
  referralCode?: string;
  botUsername?: string;
}

const FONT_URL = 'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf';

let wasmReady: Promise<void> | null = null;
let fontBuffer: Uint8Array | null = null;

async function ensureReady(fetchImpl: typeof fetch): Promise<void> {
  if (!wasmReady) {
    wasmReady = (async () => {
      const { initWasm } = await import('@resvg/resvg-wasm');
      const require = createRequire(import.meta.url);
      const wasmPath = require.resolve('@resvg/resvg-wasm/index_bg.wasm');
      await initWasm(readFileSync(wasmPath));
    })();
  }
  await wasmReady;
  if (!fontBuffer) {
    const res = await fetchImpl(FONT_URL, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`font fetch failed (${res.status})`);
    fontBuffer = new Uint8Array(await res.arrayBuffer());
  }
}

/** Render the card. Returns a PNG buffer, or null if rendering isn't available. */
export async function renderPnlCard(data: PnlCardData, fetchImpl: typeof fetch = fetch): Promise<Buffer | null> {
  try {
    await ensureReady(fetchImpl);
    const { Resvg } = await import('@resvg/resvg-wasm');
    const svg = buildSvg(data);
    const r = new Resvg(svg, {
      fitTo: { mode: 'width', value: 1200 },
      font: { fontBuffers: [fontBuffer!], defaultFontFamily: 'DejaVu Sans', loadSystemFonts: false },
      background: 'rgba(0,0,0,0)',
    });
    return Buffer.from(r.render().asPng());
  } catch (err) {
    logger.warn('pnl card render failed', { e: (err as Error).message });
    return null;
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildSvg(d: PnlCardData): string {
  const up = d.returnPct >= 0;
  const accent = up ? '#22e6a4' : '#ff5470';
  const pct = `${up ? '+' : ''}${d.returnPct.toFixed(2)}%`;
  const W = 1200;
  const H = 628;

  // Decorative dots.
  let dots = '';
  const rng = mulberry32(Math.floor(Math.abs(d.returnPct) * 1000) + d.symbol.length * 7 + 1);
  for (let i = 0; i < 46; i++) {
    const x = 640 + rng() * 540;
    const y = 40 + rng() * 548;
    const rr = 1 + rng() * 2.6;
    const op = 0.12 + rng() * 0.5;
    const col = rng() > 0.6 ? accent : '#3d5a8a';
    dots += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${rr.toFixed(1)}" fill="${col}" opacity="${op.toFixed(2)}"/>`;
  }

  const ref = d.referralCode ? esc(d.referralCode) : '';
  const bot = d.botUsername ? '@' + esc(d.botUsername) : '@Kros';

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0b1220"/>
      <stop offset="0.55" stop-color="#0a0f1c"/>
      <stop offset="1" stop-color="#070b14"/>
    </linearGradient>
    <linearGradient id="glow" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.9"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0.15"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" rx="28" fill="url(#bg)"/>
  <rect x="0" y="0" width="10" height="${H}" fill="url(#glow)"/>
  ${dots}
  <circle cx="1090" cy="96" r="52" fill="none" stroke="${accent}" stroke-opacity="0.5" stroke-width="3"/>
  <text x="1090" y="112" font-family="DejaVu Sans" font-size="46" fill="${accent}" text-anchor="middle">$</text>

  <text x="64" y="118" font-family="DejaVu Sans" font-size="40" fill="#e8eefc">Kros</text>
  <text x="64" y="162" font-family="DejaVu Sans" font-size="26" fill="#7f93b8">${esc(d.chainLabel)} · ${esc(d.side)}</text>

  <text x="64" y="248" font-family="DejaVu Sans" font-size="46" fill="#c7d4ee">$${esc(d.symbol)}</text>

  <text x="60" y="410" font-family="DejaVu Sans" font-size="168" fill="${accent}">${pct}</text>

  <text x="64" y="486" font-family="DejaVu Sans" font-size="30" fill="#7f93b8">Initial</text>
  <text x="360" y="486" font-family="DejaVu Sans" font-size="30" fill="#e8eefc">${esc(d.initial)}</text>
  <text x="64" y="532" font-family="DejaVu Sans" font-size="30" fill="#7f93b8">Worth</text>
  <text x="360" y="532" font-family="DejaVu Sans" font-size="30" fill="#e8eefc">${esc(d.worth)}</text>
  ${d.avgEntry ? `<text x="64" y="578" font-family="DejaVu Sans" font-size="30" fill="#7f93b8">Avg Entry</text>
  <text x="360" y="578" font-family="DejaVu Sans" font-size="30" fill="#e8eefc">${esc(d.avgEntry)}</text>` : ''}

  ${ref ? `<text x="760" y="556" font-family="DejaVu Sans" font-size="24" fill="#7f93b8">Referral · earn 20%</text>
  <text x="760" y="592" font-family="DejaVu Sans" font-size="30" fill="${accent}">${bot} · ${ref}</text>` : `<text x="760" y="592" font-family="DejaVu Sans" font-size="28" fill="${accent}">${bot}</text>`}
</svg>`;
}

/** Tiny seeded PRNG for deterministic decorative dots. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
