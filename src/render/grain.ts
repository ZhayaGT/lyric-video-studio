import type { Ctx2D } from './text.js';

const TILE = 160;
let tile: OffscreenCanvas | null = null;

/** Seeded PRNG so the grain tile is identical in preview and export. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noiseTile(): OffscreenCanvas | null {
  if (tile) return tile;
  if (typeof OffscreenCanvas === 'undefined') return null;
  const canvas = new OffscreenCanvas(TILE, TILE);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const image = ctx.createImageData(TILE, TILE);
  const random = mulberry32(0x5eed);
  for (let i = 0; i < image.data.length; i += 4) {
    const value = Math.floor(random() * 255);
    image.data[i] = value;
    image.data[i + 1] = value;
    image.data[i + 2] = value;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  tile = canvas;
  return tile;
}

/**
 * Film grain: a cached noise tile drawn with `overlay` blending and a per-frame
 * offset. Cheap (one fillRect) and fully deterministic for a given `t`, so
 * exports match the preview.
 */
export function drawGrain(ctx: Ctx2D, strength: number, t: number): void {
  if (strength <= 0.001) return;
  const withPattern = ctx as Ctx2D & { createPattern?: Ctx2D['createPattern'] };
  if (typeof withPattern.createPattern !== 'function') return;
  const source = noiseTile();
  if (!source) return;

  const pattern = withPattern.createPattern(source, 'repeat');
  if (!pattern) return;

  ctx.save();
  ctx.globalAlpha = Math.min(0.4, strength);
  ctx.globalCompositeOperation = 'overlay';
  // Slow drift keeps the grain alive without flickering every frame.
  const offsetX = Math.floor((t * 37) % TILE);
  const offsetY = Math.floor((t * 53) % TILE);
  ctx.translate(-offsetX, -offsetY);
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, ctx.canvas.width + TILE, ctx.canvas.height + TILE);
  ctx.restore();
}
