import type { Kinetic, LyricLine, Style } from '../types.js';
import type { Ctx2D } from './text.js';
import { applyFont, measureToken, wordTimings } from './text.js';
import { clamp, easeInCubic, easeOutBack, easeOutCubic, withAlpha } from './math.js';

export const DEFAULT_KINETIC: Kinetic = {
  emphasisScale: 0.85,
  swatchCount: 1,
  swatchColor: '',
  rotate: 4,
  baselineJitter: 14,
  smear: 3,
  smearDistance: 26,
  stretch: 0.55,
  wordsPerBurst: 3,
};

export function resolveKinetic(style: Style): Kinetic {
  return { ...DEFAULT_KINETIC, ...(style.kinetic ?? {}) };
}

type TimedWord = { text: string; start: number; end: number };

type PlacedWord = {
  text: string;
  size: number;
  width: number;
  /** Centre X relative to the burst origin. */
  cx: number;
  /** Baseline offset from the burst baseline. */
  dy: number;
  rotate: number;
  emphasised: boolean;
  start: number;
  end: number;
  index: number;
};

type BurstLayout = {
  words: PlacedWord[];
  size: number;
  start: number;
  end: number;
};

/** Deterministic pseudo-random in [-1, 1] so every frame renders identically. */
function hash(index: number, salt: number): number {
  const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/**
 * Pack words into bursts at a *target* size instead of a fixed word count, so a
 * burst always looks big. A burst takes as many words as fit at that size (at
 * least one), which is what makes the reference read as giant type rather than
 * a sentence shrunk to fit.
 */
function packBursts(
  ctx: Ctx2D,
  words: TimedWord[],
  style: Style,
  w: number,
  kinetic: Kinetic,
  targetSize: number,
): TimedWord[][] {
  const maxWidth = style.layout.maxWidthPct * w;
  const maxPerBurst = Math.max(1, Math.round(kinetic.wordsPerBurst));

  const burstWidth = (burst: TimedWord[]): number => {
    let total = 0;
    burst.forEach((word, index) => {
      const isEmphasis = index === emphasisOf(burst);
      const size = Math.round(targetSize * (isEmphasis ? 1 + kinetic.emphasisScale : 1));
      applyFont(ctx, style, size);
      total += measureToken(ctx, style.font.uppercase ? word.text.toUpperCase() : word.text);
      total += size * (isEmphasis ? 0.6 : 0.22);
    });
    return total;
  };

  const bursts: TimedWord[][] = [];
  let current: TimedWord[] = [];

  for (const word of words) {
    const candidate = [...current, word];
    const tooWide = burstWidth(candidate) > maxWidth;
    const tooMany = candidate.length > maxPerBurst;
    const endsClause = /[,.!?;:…]$/.test(current[current.length - 1]?.text ?? '');

    if (current.length > 0 && (tooWide || tooMany || endsClause)) {
      bursts.push(current);
      current = [word];
    } else {
      current = candidate;
    }
  }
  if (current.length) bursts.push(current);
  return bursts;
}

/** Index of the word that gets the paint swatch: the longest, never the only one. */
function emphasisOf(burst: TimedWord[]): number {
  if (burst.length < 2) return -1;
  let best = -1;
  let bestLength = 0;
  burst.forEach((word, index) => {
    if (word.text.length > bestLength) {
      bestLength = word.text.length;
      best = index;
    }
  });
  return best;
}

/**
 * Lay one burst out at the largest size that fits, centred on the anchor. The
 * entrance is driven by the burst start so the whole lockup lands together and
 * never leaves a hole where a later word will appear.
 */
function layoutBurst(
  ctx: Ctx2D,
  burst: TimedWord[],
  style: Style,
  w: number,
  kinetic: Kinetic,
  targetSize: number,
  baseOffset: number,
): BurstLayout {
  const maxWidth = style.layout.maxWidthPct * w;
  const content = burst.map((word) => (style.font.uppercase ? word.text.toUpperCase() : word.text));
  const emphasisIndex = emphasisOf(burst);

  let chosen: { size: number; widths: number[]; sizes: number[]; pads: number[]; total: number } | null = null;

  // Start well above the target and walk down until the burst fits: short bursts
  // then fill the frame instead of looking like a smaller version of long ones.
  for (let size = Math.round(targetSize * 1.9); size >= 22; size -= 2) {
    const widths: number[] = [];
    const sizes: number[] = [];
    const pads: number[] = [];
    content.forEach((text, index) => {
      const wordSize = index === emphasisIndex ? Math.round(size * (1 + kinetic.emphasisScale * 0.55)) : size;
      applyFont(ctx, style, wordSize);
      widths.push(measureToken(ctx, text));
      sizes.push(wordSize);
      pads.push(index === emphasisIndex ? wordSize * 0.3 : 0);
    });

    let total = 0;
    widths.forEach((width, index) => {
      total += width + pads[index] * 2;
      if (index > 0) total += sizes[index] * 0.22;
    });
    if (total <= maxWidth) {
      chosen = { size, widths, sizes, pads, total };
      break;
    }
  }

  if (!chosen) {
    const size = 22;
    const widths = content.map((text) => {
      applyFont(ctx, style, size);
      return measureToken(ctx, text);
    });
    chosen = { size, widths, sizes: content.map(() => size), pads: content.map(() => 0), total: widths.reduce((a, b) => a + b, 0) };
  }

  const { widths, sizes, pads, total } = chosen;
  let cursor = -total / 2;
  const placed: PlacedWord[] = content.map((text, index) => {
    if (index > 0) cursor += sizes[index] * 0.22;
    cursor += pads[index];
    const cx = cursor + widths[index] / 2;
    cursor += widths[index] + pads[index];
    return {
      text,
      size: sizes[index],
      width: widths[index],
      cx,
      dy: hash(index + baseOffset, 1) * kinetic.baselineJitter,
      rotate: hash(index + baseOffset, 2) * kinetic.rotate,
      emphasised: index === emphasisIndex,
      start: burst[0].start,
      end: burst[burst.length - 1].end,
      index: index + baseOffset,
    };
  });

  return { words: placed, size: chosen.size, start: burst[0].start, end: burst[burst.length - 1].end };
}

/** Paint swatch: three offset slabs give a brushed edge without any asset. */
function drawSwatch(
  ctx: Ctx2D,
  word: PlacedWord,
  color: string,
  centreX: number,
  baselineY: number,
  reveal: number,
  alpha: number,
): void {
  if (reveal <= 0.01 || alpha <= 0.01) return;
  const padX = word.size * 0.16;
  const height = word.size * 0.86;
  const width = (word.width + padX * 2) * reveal;
  const skew = word.size * 0.05;

  ctx.save();
  ctx.translate(centreX, baselineY - word.size * 0.32);
  ctx.rotate((word.rotate * Math.PI) / 180);
  for (let i = 0; i < 3; i++) {
    const wobble = hash(word.index + i, 7) * (word.size * 0.04);
    // Paint fades in with its word; the extra slabs only extend the brushed edge.
    ctx.globalAlpha = alpha * (i === 0 ? 1 : 0.35);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-width / 2 + wobble, -height / 2 + skew);
    ctx.lineTo(width / 2 + wobble, -height / 2 - skew);
    ctx.lineTo(width / 2 - wobble, height / 2 + skew);
    ctx.lineTo(-width / 2 - wobble, height / 2 - skew);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Kinetic typography: a few words at a time, huge, landing one by one with
 * squash-and-stretch overshoot, rotation and smear trails, plus a paint swatch
 * behind the key word. This is the motion-graphics look, not a fade.
 */
export function drawKinetic(
  ctx: Ctx2D,
  line: LyricLine,
  t: number,
  style: Style,
  kinetic: Kinetic,
  beatPhase: number,
  master: number,
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const timings = wordTimings(line);
  if (timings.length === 0) return;

  // Target size: a fraction of frame height, so words are enormous at any
  // resolution instead of being tied to font.size.
  const targetSize = Math.round(h * 0.22);
  const bursts = packBursts(ctx, timings, style, w, kinetic, targetSize);
  const inDur = Math.max(style.timing.inDur, 0.01);
  const outDur = Math.max(style.timing.outDur, 0.01);
  const swatchColor = kinetic.swatchColor || style.colors.accent;
  const originX = style.layout.x * w;
  const baselineY = style.layout.y * h;

  let offset = 0;
  for (const burst of bursts) {
    const layout = layoutBurst(ctx, burst, style, w, kinetic, targetSize, offset);
    offset += burst.length;

    // Only the burst whose window contains t is on screen.
    const pad = 0.2;
    if (t < layout.start - pad || t > layout.end + outDur + 0.1) continue;

    layout.words.forEach((word, index) => {
      const enterP = clamp((t - layout.start) / inDur);
      const exitDelay = (layout.words.length - 1 - index) * (style.timing.stagger * 0.5);
      const exitP = clamp((t - (layout.end - outDur + exitDelay)) / outDur);
      if (enterP <= 0.001 || exitP >= 0.999) return;

      const overshoot = easeOutBack(enterP);
      const scaleY = (1 + kinetic.stretch * (1 - overshoot) * 0.9) * (1 - 0.55 * exitP);
      const scaleX = (1 - kinetic.stretch * (1 - overshoot) * 0.45) * (1 + 0.2 * exitP);
      const alpha = clamp(enterP * 2.2) * (1 - easeInCubic(exitP));
      const rot = ((word.rotate + (1 - overshoot) * word.rotate * 2.5) * Math.PI) / 180;
      const punch = 1 + 0.014 * Math.sin(2 * Math.PI * beatPhase);
      const cx = originX + word.cx;
      const y = baselineY + word.dy - exitP * word.size * 0.35;

      if (word.emphasised) {
        drawSwatch(
          ctx,
          word,
          withAlpha(swatchColor, 1),
          cx,
          y,
          easeOutCubic(clamp(enterP * 1.8)),
          master * alpha,
        );
      }

      // Smear trails stretched back along the entry direction.
      for (let s = kinetic.smear; s >= 1; s--) {
        const trail = (s / Math.max(kinetic.smear, 1)) * (1 - enterP);
        if (trail <= 0.01) continue;
        ctx.save();
        ctx.globalAlpha = master * alpha * 0.18 * (1 - trail);
        ctx.translate(cx - kinetic.smearDistance * trail, y);
        ctx.rotate(rot);
        ctx.scale(scaleX * (1 + trail * 0.35), scaleY * (1 + trail * 0.55));
        applyFont(ctx, style, word.size);
        ctx.textAlign = 'center';
        ctx.fillStyle = style.colors.text;
        ctx.fillText(word.text, 0, 0);
        ctx.restore();
      }

      ctx.save();
      ctx.globalAlpha = master * alpha;
      if (style.colors.shadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = word.size * 0.1;
        ctx.shadowOffsetY = word.size * 0.045;
      }
      ctx.translate(cx, y);
      ctx.rotate(rot);
      ctx.scale(scaleX * punch, scaleY * punch);
      applyFont(ctx, style, word.size);
      ctx.textAlign = 'center';
      ctx.fillStyle = style.colors.text;
      ctx.fillText(word.text, 0, 0);
      ctx.restore();
    });
  }
}
