import type { LyricLine, Style } from '../types.js';
import { clamp, easeOutCubic } from './math.js';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A laid-out word: text, measured width, and x offset from the block centre. */
export type TokenBox = { text: string; width: number; x: number };

export type TextLayout = {
  size: number;
  lineHeight: number;
  rows: TokenBox[][];
  rowWidths: number[];
  blockWidth: number;
  totalHeight: number;
  /** Text as rendered (uppercased when style demands it). */
  text: string;
};

export const MIN_FONT_SIZE = 28;

export function applyFont(ctx: Ctx2D, style: Style, size: number): void {
  ctx.font = `${style.font.weight} ${size}px "${style.font.family}"`;
  ctx.textBaseline = 'alphabetic';
  const withSpacing = ctx as Ctx2D & { letterSpacing?: string };
  if ('letterSpacing' in withSpacing) withSpacing.letterSpacing = `${style.font.letterSpacing}px`;
}

export function measureToken(ctx: Ctx2D, text: string): number {
  return ctx.measureText(text).width;
}

/** Greedy word wrap; every returned row is a list of positioned tokens. */
export function wrapWords(ctx: Ctx2D, tokens: string[], maxWidth: number): TokenBox[][] {
  const rows: TokenBox[][] = [];
  let row: TokenBox[] = [];
  let rowWidth = 0;
  const space = measureToken(ctx, ' ');

  for (const token of tokens) {
    const width = measureToken(ctx, token);
    const added = row.length === 0 ? width : rowWidth + space + width;
    if (row.length > 0 && added > maxWidth) {
      rows.push(row);
      row = [{ text: token, width, x: 0 }];
      rowWidth = width;
    } else {
      row.push({ text: token, width, x: 0 });
      rowWidth = added;
    }
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

/**
 * Largest size (step 2px, floor MIN_FONT_SIZE) where `text` wraps into at most
 * `maxLines` rows and the widest row fits `maxWidthPct * w`.
 */
export function autofitSize(
  ctx: Ctx2D,
  text: string,
  style: Style,
  w: number,
  maxWidthPct: number,
  maxLines: number,
): number {
  const maxWidth = maxWidthPct * w;
  const tokens = text.split(/\s+/).filter(Boolean);
  for (let size = style.font.size; size >= MIN_FONT_SIZE; size -= 2) {
    applyFont(ctx, style, size);
    const rows = wrapWords(ctx, tokens, maxWidth);
    if (rows.length > maxLines) continue;
    const space = measureToken(ctx, ' ');
    const widest = rows.reduce(
      (max, row) => Math.max(max, row.reduce((sum, t, i) => sum + t.width + (i > 0 ? space : 0), 0)),
      0,
    );
    if (widest <= maxWidth) return size;
  }
  return MIN_FONT_SIZE;
}

const layoutCache = new Map<string, TextLayout>();

function cacheKey(text: string, style: Style, w: number): string {
  const f = style.font;
  return [
    text,
    f.family,
    f.weight,
    f.size,
    f.letterSpacing,
    f.lineHeight,
    f.uppercase ? 1 : 0,
    style.layout.maxWidthPct,
    style.layout.maxLines,
    style.layout.align,
    w,
  ].join('|');
}

/** Layout a single lyric line, memoised per (text, font, width) combination. */
export function layoutLine(ctx: Ctx2D, text: string, style: Style, w: number): TextLayout {
  const key = cacheKey(text, style, w);
  const cached = layoutCache.get(key);
  if (cached) return cached;

  const content = style.font.uppercase ? text.toUpperCase() : text;
  const maxWidth = style.layout.maxWidthPct * w;
  const size = autofitSize(ctx, content, style, w, style.layout.maxWidthPct, style.layout.maxLines);
  applyFont(ctx, style, size);
  const tokens = content.split(/\s+/).filter(Boolean);
  const rows = wrapWords(ctx, tokens, maxWidth);
  const space = measureToken(ctx, ' ');
  const rowWidths = rows.map((row) => row.reduce((sum, t, i) => sum + t.width + (i > 0 ? space : 0), 0));
  const blockWidth = Math.max(0, ...rowWidths);

  rows.forEach((row, rowIndex) => {
    let x = style.layout.align === 'center' ? -rowWidths[rowIndex] / 2 : -blockWidth / 2;
    row.forEach((token) => {
      token.x = x;
      x += token.width + space;
    });
  });

  const lineHeight = size * style.font.lineHeight;
  const layout: TextLayout = {
    size,
    lineHeight,
    rows,
    rowWidths,
    blockWidth,
    totalHeight: rows.length * lineHeight,
    text: content,
  };
  if (layoutCache.size > 256) layoutCache.clear();
  layoutCache.set(key, layout);
  return layout;
}

/**
 * Entrance envelope for a line. Deliberately has no fade-out: each preset owns
 * its exit (and staggers it word by word), so fading here as well would dim the
 * line before its own animation finished.
 */
export function lineEntranceOpacity(
  t: number,
  line: LyricLine,
  timing: Style['timing'],
  transition: Style['transition'],
): number {
  const pad = transition === 'crossfade' ? 0.25 : 0;
  return clamp(easeOutCubic(clamp((t - (line.start - pad)) / Math.max(timing.inDur, 0.01))));
}

/** Word timings from the project, else proportional character distribution. */
export function wordTimings(line: LyricLine): { text: string; start: number; end: number }[] {
  const tokens = line.text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  if (line.words && line.words.length === tokens.length) return line.words;
  const span = Math.max(line.end - line.start, 0.2);
  const weights = tokens.map((token) => token.length + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let cursor = line.start;
  return tokens.map((text, i) => {
    const dur = (weights[i] / total) * span;
    const start = cursor;
    cursor += dur;
    return { text, start, end: start + dur };
  });
}
