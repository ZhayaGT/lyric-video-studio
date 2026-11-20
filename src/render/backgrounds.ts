import type { BackgroundSpec } from '../types.js';
import type { Assets } from './assets.js';
import type { Ctx2D } from './text.js';
import { clamp, withAlpha } from './math.js';

function drawSolid(ctx: Ctx2D, color: string, w: number, h: number): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
}

function drawGradient(
  ctx: Ctx2D,
  bg: Extract<BackgroundSpec, { kind: 'gradient' }>,
  w: number,
  h: number,
  t: number,
): void {
  const rad = (bg.angle * Math.PI) / 180;
  const half = Math.hypot(w, h) / 2;
  const cx = w / 2;
  const cy = h / 2;
  const grad = ctx.createLinearGradient(
    cx - Math.cos(rad) * half,
    cy - Math.sin(rad) * half,
    cx + Math.cos(rad) * half,
    cy + Math.sin(rad) * half,
  );
  const shift = bg.animate ? 0.5 * Math.sin((2 * Math.PI * t) / 12) : 0;
  grad.addColorStop(0, bg.from);
  grad.addColorStop(clamp(0.5 + shift * 0.5, 0.02, 0.98), bg.to);
  grad.addColorStop(1, bg.from);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

function drawImage(
  ctx: Ctx2D,
  bg: Extract<BackgroundSpec, { kind: 'image' }>,
  w: number,
  h: number,
  t: number,
  assets: Assets,
): void {
  const img = assets.images.get(bg.file);
  if (!img) {
    drawSolid(ctx, '#0b0f17', w, h);
    return;
  }
  const zoom = 1 + bg.zoom * clamp(t / Math.max(assets.duration, 1));
  const scale = Math.max(w / img.width, h / img.height) * zoom;
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.save();
  if (bg.blur > 0) ctx.filter = `blur(${bg.blur}px)`;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  ctx.restore();
}

function drawMesh(
  ctx: Ctx2D,
  bg: Extract<BackgroundSpec, { kind: 'mesh' }>,
  w: number,
  h: number,
  t: number,
  beatPhase: number,
): void {
  drawSolid(ctx, bg.palette[0], w, h);
  const pulse = bg.pulseOnBeat ? 1 + 0.06 * Math.sin(2 * Math.PI * beatPhase) : 1;
  const radius = 0.55 * Math.min(w, h) * pulse;
  const centres: [number, number][] = [
    [0.5 + 0.28 * Math.sin(bg.speed * t * 0.7), 0.42 + 0.24 * Math.cos(bg.speed * t * 0.55)],
    [0.5 + 0.3 * Math.sin(bg.speed * t * 0.45 + 2.1), 0.6 + 0.22 * Math.cos(bg.speed * t * 0.8 + 1.3)],
    [0.5 + 0.24 * Math.sin(bg.speed * t * 0.6 + 4.2), 0.5 + 0.3 * Math.cos(bg.speed * t * 0.5 + 3.4)],
  ];

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  centres.forEach(([nx, ny], i) => {
    const color = bg.palette[i % bg.palette.length] ?? bg.palette[0];
    const cx = nx * w;
    const cy = ny * h;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, withAlpha(color, 0.9));
    grad.addColorStop(0.55, withAlpha(color, 0.35));
    grad.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  });
  ctx.restore();
}

export function drawBackground(
  ctx: Ctx2D,
  bg: BackgroundSpec,
  w: number,
  h: number,
  t: number,
  assets: Assets,
  beatPhase: number,
): void {
  switch (bg.kind) {
    case 'solid':
      drawSolid(ctx, bg.color, w, h);
      break;
    case 'gradient':
      drawGradient(ctx, bg, w, h, t);
      break;
    case 'image':
      drawImage(ctx, bg, w, h, t, assets);
      break;
    case 'mesh':
      drawMesh(ctx, bg, w, h, t, beatPhase);
      break;
  }
}
