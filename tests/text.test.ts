import { describe, expect, it } from 'vitest';
import { autofitSize, layoutLine, wrapWords, wordTimings } from '../src/render/text.js';
import { DEFAULT_STYLE } from '../src/project.js';
import { fakeCtx } from './fakeCtx.js';
import type { Style } from '../src/types.js';

const style: Style = structuredClone(DEFAULT_STYLE);

describe('wrapWords', () => {
  it('keeps every row within maxWidth', () => {
    const ctx = fakeCtx();
    ctx.font = '600 64px "Inter"';
    const tokens = 'sungguh indah kasih setia tuhan selamanya bagi kita semua'.split(' ');
    const rows = wrapWords(ctx, tokens, 600);
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      const text = row.map((t) => t.text).join(' ');
      expect(ctx.measureText(text).width).toBeLessThanOrEqual(600);
    }
    expect(rows.flat().map((t) => t.text)).toEqual(tokens);
  });

  it('keeps a single overlong token on its own row', () => {
    const ctx = fakeCtx();
    ctx.font = '600 64px "Inter"';
    const rows = wrapWords(ctx, ['pendek', 'x'.repeat(80), 'pendek'], 200);
    expect(rows).toHaveLength(3);
  });
});

describe('autofitSize', () => {
  it('shrinks a 120-char line to fit 3 rows at 82% of 1280', () => {
    const ctx = fakeCtx();
    const text =
      'kasih yang tak pernah berkesudahan menyertai langkah kita di sepanjang perjalanan hidup yang penuh dengan ujian dan harapan';
    expect(text.length).toBeGreaterThan(110);
    const size = autofitSize(ctx, text, style, 1280, 0.82, 3);
    expect(size).toBeLessThan(style.font.size);
    expect(size).toBeGreaterThanOrEqual(28);
    const layout = layoutLine(ctx, text, style, 1280);
    expect(layout.rows.length).toBeLessThanOrEqual(3);
    expect(layout.blockWidth).toBeLessThanOrEqual(0.82 * 1280);
  });

  it('keeps the requested size for short text', () => {
    const ctx = fakeCtx();
    expect(autofitSize(ctx, 'Tuhan baik', style, 1280, 0.82, 3)).toBe(style.font.size);
  });

  it('never drops below the 28px floor', () => {
    const ctx = fakeCtx();
    const size = autofitSize(ctx, 'kata '.repeat(80), style, 1280, 0.82, 1);
    expect(size).toBe(28);
  });
});

describe('wordTimings', () => {
  it('uses provided word timings when the count matches', () => {
    const words = [
      { text: 'a', start: 1, end: 1.4 },
      { text: 'b', start: 1.4, end: 2 },
    ];
    const timings = wordTimings({ id: 'x', text: 'a b', start: 1, end: 2, words });
    expect(timings).toEqual(words);
  });

  it('distributes proportionally across the line when absent', () => {
    const timings = wordTimings({ id: 'x', text: 'satu dua tiga', start: 10, end: 13 });
    expect(timings).toHaveLength(3);
    expect(timings[0].start).toBeCloseTo(10, 5);
    expect(timings[2].end).toBeCloseTo(13, 5);
    expect(timings[0].end).toBeCloseTo(timings[1].start, 5);
  });
});
