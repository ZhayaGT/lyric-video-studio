import type { LyricLine, Motion, Style } from '../types.js';
import type { Ctx2D, TextLayout, TokenBox } from './text.js';
import { applyFont, layoutLine, lineOpacity, wordTimings } from './text.js';
import { clamp, easeInCubic, easeOutBack, easeOutCubic } from './math.js';
import { drawKinetic, resolveKinetic } from './kinetic.js';

export type BeatPhase = number;

export const DEFAULT_MOTION: Motion = {
  cameraZoom: 0.04,
  breathe: 0.012,
  drift: 6,
  blur: 4,
  exitLift: 1,
};

/** Fill in motion defaults so projects saved before `motion` existed still animate. */
export function resolveMotion(style: Style): Motion {
  return { ...DEFAULT_MOTION, ...(style.motion ?? {}) };
}

/**
 * Which clock drives a word's entrance. Only pop-word is truly word-by-word;
 * everything else (including mask-reveal, whose wipe should sweep the whole line
 * as one gesture) enters on the line clock with a short stagger.
 */
function usesWordClock(preset: Style['preset']): boolean {
  return preset === 'pop-word';
}

/** Everything a preset needs to place one word at time `t`. */
type WordFx = {
  alpha: number;
  dx: number;
  dy: number;
  scale: number;
  /** Vertical reveal, 0 = hidden, 1 = fully drawn (bottom-up wipe). */
  wipe: number;
  blur: number;
};

type LineEnv = {
  line: LyricLine;
  style: Style;
  motion: Motion;
  t: number;
  beatPhase: number;
  inDur: number;
  outDur: number;
  lineProgress: number;
  holdSeconds: number;
};

function applyShadow(ctx: Ctx2D, style: Style, size: number): void {
  if (style.colors.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = size * 0.16;
    ctx.shadowOffsetY = size * 0.04;
  } else {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }
}

/**
 * Per-word motion for one preset. `p` is the word's entrance progress, `q` its
 * exit progress (staggered in reverse), `hold` the seconds spent holding.
 */
function wordFx(env: LineEnv, index: number, count: number, wordStart: number): WordFx {
  const { style, motion, t, inDur, outDur, holdSeconds } = env;
  // A full stagger reads as "one word at a time" and looks broken on line
  // starts, so only word-centric presets use it at full strength; the rest get
  // a subtle ripple that still finishes inside the entrance window.
  const perWord = style.preset === 'pop-word' ? 1 : style.preset === 'mask-reveal' ? 0 : 0.25;
  const stagger = Math.min(style.timing.stagger * perWord, inDur / Math.max(count, 1));
  const exitDelay = (count - 1 - index) * stagger * 0.35;
  const p = clamp((t - (wordStart + index * stagger)) / inDur);
  const q = clamp((t - (env.line.end - outDur + exitDelay)) / outDur);
  const pe = easeOutCubic(p);
  // Exit: linear alpha so the fade is visible through the whole window, but
  // accelerating travel so the text "leaves" instead of sliding at a crawl.
  const qe = easeInCubic(q);
  const fadeOut = q;
  const lift = qe * motion.exitLift;

  switch (style.preset) {
    case 'fade-rise':
      return {
        alpha: pe * (1 - fadeOut),
        dx: 0,
        dy: 26 * (1 - pe) - motion.drift * holdSeconds - 22 * lift,
        scale: 1,
        wipe: 1,
        blur: motion.blur * ((1 - pe) * 0.5 + qe * 1.5),
      };

    case 'slide-left':
      return {
        alpha: pe * (1 - fadeOut),
        dx: 70 * (1 - pe) - 45 * lift,
        dy: -motion.drift * holdSeconds * 0.5,
        scale: 1,
        wipe: 1,
        blur: motion.blur * (1 - pe) * 0.4,
      };

    case 'pop-word':
      return {
        alpha: clamp(p * 2.5) * (1 - fadeOut),
        dx: 0,
        dy: -motion.drift * holdSeconds * 0.6 - 10 * lift,
        scale: (1 + 0.38 * (1 - easeOutBack(p))) * (1 - 0.12 * qe),
        wipe: 1,
        blur: motion.blur * qe,
      };

    case 'mask-reveal':
      // drawMaskReveal owns the reveal; keep the word layer plain.
      return { alpha: 1 - fadeOut, dx: 0, dy: 0, scale: 1, wipe: 1, blur: 0 };

    case 'glow-beat':
      return {
        alpha: pe * (1 - fadeOut),
        dx: 0,
        dy: -motion.drift * holdSeconds * 0.5 - 12 * lift,
        scale: 1,
        wipe: 1,
        blur: motion.blur * qe,
      };

    case 'cinematic':
      return {
        alpha: pe * (1 - fadeOut),
        dx: 0,
        dy: -motion.drift * holdSeconds * 0.35 - 10 * lift,
        scale: 1,
        wipe: 1,
        blur: motion.blur * (1 - pe) * 0.8 + motion.blur * qe,
      };

    default:
      return { alpha: pe * (1 - fadeOut), dx: 0, dy: 0, scale: 1, wipe: 1, blur: 0 };
  }
}

/** Draw one word with its transform, optional blur and bottom-up wipe. */
function drawToken(
  ctx: Ctx2D,
  token: TokenBox,
  x: number,
  y: number,
  size: number,
  fx: WordFx,
  color: string,
): void {
  if (fx.alpha <= 0.004 || fx.wipe <= 0.01) return;
  ctx.save();
  ctx.globalAlpha *= fx.alpha;
  if (fx.blur > 0.2) ctx.filter = `blur(${fx.blur.toFixed(2)}px)`;
  const cx = x + token.width / 2;
  const cy = y - size * 0.32;
  ctx.translate(cx + fx.dx, cy + fx.dy);
  if (fx.scale !== 1) ctx.scale(fx.scale, fx.scale);
  ctx.translate(-token.width / 2, size * 0.32);
  if (fx.wipe < 1) {
    ctx.beginPath();
    ctx.rect(0, -size * fx.wipe, token.width + 2, size * fx.wipe);
    ctx.clip();
  }
  ctx.fillStyle = color;
  ctx.fillText(token.text, 0, 0);
  ctx.restore();
}

/** Karaoke: base text, then an accent fill clipped to the sung portion. */
function drawKaraoke(
  ctx: Ctx2D,
  env: LineEnv,
  layout: TextLayout,
  originX: number,
  baseline: (row: number) => number,
  timings: { start: number; end: number }[],
): void {
  const { style, t } = env;
  const all = layout.rows.flat();
  const total = Math.max(all.length, 1);
  let flat = 0;

  layout.rows.forEach((row, rowIndex) => {
    row.forEach((token) => {
      const timing = timings[flat] ?? { start: env.line.start, end: env.line.end };
      const fx = wordFx(env, flat, total, timing.start);
      flat += 1;

      const x = originX + token.x;
      const y = baseline(rowIndex);
      const sung = clamp((t - timing.start) / Math.max(timing.end - timing.start, 0.001));
      const active = t >= timing.start && t < timing.end + 0.12;
      // Karaoke shows the whole line from the start; only the accent fill tracks
      // the vocal, so the base text keeps the line-level entrance envelope.
      const lineIn = clamp((t - env.line.start) / env.inDur);
      const exitQ = clamp((t - (env.line.end - env.outDur)) / env.outDur);

      ctx.save();
      ctx.globalAlpha *= clamp(lineIn) * (1 - exitQ);
      if (fx.blur > 0.2) ctx.filter = `blur(${fx.blur.toFixed(2)}px)`;
      const cx = x + token.width / 2;
      const cy = y - layout.size * 0.32;
      ctx.translate(cx + fx.dx, cy + fx.dy);
      const scale = fx.scale * (active ? 1.05 : 1);
      if (scale !== 1) ctx.scale(scale, scale);
      ctx.translate(-token.width / 2, layout.size * 0.32);
      if (fx.wipe < 1) {
        ctx.beginPath();
        ctx.rect(0, -layout.size * fx.wipe, token.width + 2, layout.size * fx.wipe);
        ctx.clip();
      }

      ctx.fillStyle = style.colors.text;
      ctx.fillText(token.text, 0, 0);
      if (sung > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, -layout.size, token.width * sung, layout.size * 1.4);
        ctx.clip();
        ctx.fillStyle = style.colors.accent;
        ctx.fillText(token.text, 0, 0);
        ctx.restore();
      }
      ctx.restore();
    });
  });
}

/**
 * Mask reveal: each row rises out of its own line box. Clipping per row (rather
 * than slicing the whole block) keeps every glyph intact — a horizontal cut
 * through the middle of letters reads as a rendering bug, not an animation.
 */
function drawMaskReveal(
  ctx: Ctx2D,
  env: LineEnv,
  layout: TextLayout,
  originX: number,
  baseline: (row: number) => number,
): void {
  const { line, style, t, inDur, outDur, motion } = env;
  const sweep = Math.max(inDur * 1.3, 0.55);
  const rowCount = Math.max(layout.rows.length, 1);
  const exitQ = clamp((t - (line.end - outDur)) / outDur);

  layout.rows.forEach((row, rowIndex) => {
    const delay = (rowIndex / rowCount) * sweep * 0.45;
    const raw = clamp((t - line.start - delay) / sweep);
    const p = raw * raw * (3 - 2 * raw);
    if (p <= 0.001) return;

    const size = layout.size;
    const boxTop = baseline(rowIndex) - size * 1.02;
    const boxHeight = size * layout.lineHeight * 1.08;
    const rise = (1 - p) * size * 0.9;

    ctx.save();
    ctx.globalAlpha *= (1 - exitQ) * clamp(p * 2);
    if (motion.blur * exitQ > 0.2) ctx.filter = `blur(${(motion.blur * exitQ).toFixed(2)}px)`;
    ctx.beginPath();
    ctx.rect(originX - layout.blockWidth / 2 - 8, boxTop, layout.blockWidth + 16, boxHeight);
    ctx.clip();
    ctx.fillStyle = style.colors.text;
    row.forEach((token) => {
      ctx.fillText(token.text, originX + token.x, baseline(rowIndex) + rise);
    });
    ctx.restore();
  });
}

/** Typewriter: reveal characters left-to-right with a blinking caret. */
function drawTypewriter(
  ctx: Ctx2D,
  env: LineEnv,
  layout: TextLayout,
  originX: number,
  baseline: (row: number) => number,
): void {
  const { line, t, style } = env;
  const span = Math.max(line.end - line.start, 0.05);
  const reveal = clamp((t - line.start) / Math.max(0.6 * span, 0.05));
  const visible = Math.floor(layout.text.length * reveal);
  const typing = visible < layout.text.length;
  const caretOn = typing || Math.sin(t * 6) > -0.2;
  let consumed = 0;

  layout.rows.forEach((row, rowIndex) => {
    const rowText = row.map((token) => token.text).join(' ');
    const rowStart = consumed;
    const rowEnd = rowStart + rowText.length;
    consumed = rowEnd + 1;
    if (visible <= rowStart) return;
    const sliceEnd = Math.min(visible, rowEnd) - rowStart;
    const caret = caretOn && visible > rowStart && visible <= rowEnd ? '▍' : '';
    ctx.fillStyle = style.colors.text;
    ctx.fillText(rowText.slice(0, sliceEnd) + caret, originX + row[0].x, baseline(rowIndex));
  });
}

/**
 * Draw one lyric line at time `t`. Pure: identical inputs always produce
 * identical pixels, which is what keeps preview and export frame-identical.
 *
 * Structure: a block-level transform carries the slow camera push and the
 * beat breathing; per-word motion (staggered entrance, hold drift, staggered
 * exit) is applied inside it.
 */
export function drawLine(
  ctx: Ctx2D,
  line: LyricLine,
  t: number,
  style: Style,
  beatPhase: BeatPhase,
): void {
  const master = lineOpacity(t, line, style.timing, style.transition);
  if (master <= 0.002) return;

  // Kinetic typography owns its own layout (mixed sizes, uneven baseline), so it
  // bypasses the uniform word layout used by every other preset.
  if (style.preset === 'kinetic') {
    drawKinetic(ctx, line, t, style, resolveKinetic(style), beatPhase, master);
    return;
  }

  const motion = resolveMotion(style);
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const layout = layoutLine(ctx, line.text, style, w);
  const originX = style.layout.x * w;
  const blockTop = style.layout.y * h - layout.totalHeight / 2;
  const inDur = Math.max(style.timing.inDur, 0.01);
  const outDur = Math.max(style.timing.outDur, 0.01);
  const span = Math.max(line.end - line.start, 0.01);

  const lineIn = easeOutCubic(clamp((t - line.start) / inDur));
  const lineProgress = clamp((t - line.start) / span);
  const holdSeconds = clamp(t - line.start - inDur, 0, span);
  const breathe = 1 + motion.breathe * Math.sin(2 * Math.PI * beatPhase) * lineIn;

  // Block scale: camera push + breathing + preset-specific entrance scale.
  const cinematic = style.preset === 'cinematic';
  const blockScale = (1 + motion.cameraZoom * lineProgress) * breathe * (cinematic ? 1.06 - 0.06 * lineIn : 1);
  const blockScaleX = cinematic ? 1 + 0.035 * (1 - lineIn) : 1;

  const env: LineEnv = { line, style, motion, t, beatPhase, inDur, outDur, lineProgress, holdSeconds };
  const timings = wordTimings(line);
  const baseline = (rowIndex: number) => blockTop + layout.size * 0.8 + rowIndex * layout.lineHeight;

  ctx.save();
  ctx.globalAlpha = master;
  applyFont(ctx, style, layout.size);
  applyShadow(ctx, style, layout.size);
  ctx.textAlign = 'left';

  if (style.preset === 'glow-beat') {
    ctx.shadowColor = style.colors.accent;
    ctx.shadowBlur = 18 + 22 * Math.sin(2 * Math.PI * beatPhase);
    ctx.shadowOffsetY = 0;
  }
  if (cinematic) {
    const blur = motion.blur * (1 - lineIn);
    if (blur > 0.2) ctx.filter = `blur(${blur.toFixed(2)}px)`;
  }

  // Scale around the text anchor, not the canvas corner.
  const anchorY = style.layout.y * h;
  ctx.translate(originX, anchorY);
  ctx.scale(blockScale * blockScaleX, blockScale);
  ctx.translate(-originX, -anchorY);

  if (style.preset === 'mask-reveal') {
    drawMaskReveal(ctx, env, layout, originX, baseline);
  } else if (style.preset === 'karaoke') {
    drawKaraoke(ctx, env, layout, originX, baseline, timings);
  } else if (style.preset === 'typewriter') {
    drawTypewriter(ctx, env, layout, originX, baseline);
  } else {
    const total = Math.max(layout.rows.flat().length, 1);
    const wordClock = usesWordClock(style.preset);
    let flat = 0;
    layout.rows.forEach((row, rowIndex) => {
      row.forEach((token) => {
        const timing = timings[flat] ?? { start: line.start, end: line.end };
        const fx = wordFx(env, flat, total, wordClock ? timing.start : line.start);
        flat += 1;
        drawToken(ctx, token, originX + token.x, baseline(rowIndex), layout.size, fx, style.colors.text);
      });
    });
  }

  ctx.restore();
}

/** Dev-only guides: title-safe rectangle plus rule-of-thirds lines. */
export function drawSafeArea(ctx: Ctx2D): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = Math.max(1, w / 900);
  ctx.setLineDash([w / 90, w / 90]);
  ctx.strokeRect(w * 0.05, h * 0.05, w * 0.9, h * 0.9);
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.beginPath();
  ctx.moveTo(w / 3, 0);
  ctx.lineTo(w / 3, h);
  ctx.moveTo((2 * w) / 3, 0);
  ctx.lineTo((2 * w) / 3, h);
  ctx.moveTo(0, h / 3);
  ctx.lineTo(w, h / 3);
  ctx.moveTo(0, (2 * h) / 3);
  ctx.lineTo(w, (2 * h) / 3);
  ctx.stroke();
  ctx.restore();
}
