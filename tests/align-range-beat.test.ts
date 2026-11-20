import { describe, expect, it } from 'vitest';
import { alignWordsToLines, groupWordsIntoLines } from '../src/lyrics/align.js';
import { parseRange } from '../server/lib/range.js';
import { beatPhase } from '../src/render/beat.js';
import type { LyricLine } from '../src/types.js';

const words = [
  { text: 'kasih', start: 1.0, end: 1.4 },
  { text: 'setia', start: 1.4, end: 1.9 },
  { text: 'Tuhan', start: 1.9, end: 2.4 },
  { text: 'selamanya', start: 3.4, end: 4.0 },
  { text: 'amin', start: 4.0, end: 4.3 },
];

describe('groupWordsIntoLines', () => {
  it('breaks on long pauses and keeps word timings', () => {
    const lines = groupWordsIntoLines(words);
    expect(lines).toHaveLength(2);
    expect(lines[0].text).toBe('kasih setia Tuhan');
    expect(lines[0].start).toBeCloseTo(1.0, 3);
    expect(lines[0].end).toBeCloseTo(2.4, 3);
    expect(lines[0].words).toHaveLength(3);
    expect(lines[1].text).toBe('selamanya amin');
  });

  it('splits after sentence punctuation', () => {
    const lines = groupWordsIntoLines([
      { text: 'Tuhan.', start: 0, end: 0.4 },
      { text: 'baik', start: 0.45, end: 0.8 },
    ]);
    expect(lines.map((l) => l.text)).toEqual(['Tuhan.', 'baik']);
  });

  it('caps a line at seven words', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ text: `w${i}`, start: i * 0.3, end: i * 0.3 + 0.2 }));
    const lines = groupWordsIntoLines(many);
    expect(lines[0].words).toHaveLength(7);
    expect(lines.length).toBeGreaterThan(1);
  });

  it('returns nothing for empty input', () => {
    expect(groupWordsIntoLines([])).toEqual([]);
  });
});

describe('alignWordsToLines', () => {
  const lines: LyricLine[] = [
    { id: 'a', text: 'kasih setia Tuhan', start: 10, end: 12 },
    { id: 'b', text: 'selamanya amin', start: 12, end: 14 },
  ];

  it('retimes matched lines from ASR words', () => {
    const out = alignWordsToLines(words, lines);
    expect(out[0].start).toBeCloseTo(1.0, 3);
    expect(out[0].end).toBeCloseTo(2.4, 3);
    expect(out[1].start).toBeCloseTo(3.4, 3);
    expect(out[0].words?.map((w) => w.text)).toEqual(['kasih', 'setia', 'Tuhan']);
  });

  it('keeps existing per-word timings untouched', () => {
    const existing: LyricLine[] = [
      {
        id: 'a',
        text: 'kasih setia Tuhan',
        start: 10,
        end: 12,
        words: [
          { text: 'kasih', start: 10, end: 10.5 },
          { text: 'setia', start: 10.5, end: 11 },
          { text: 'Tuhan', start: 11, end: 12 },
        ],
      },
    ];
    const out = alignWordsToLines(words, existing);
    expect(out[0].words).toEqual(existing[0].words);
    expect(out[0].start).toBe(10);
  });

  it('falls back to proportional words when nothing matches', () => {
    const out = alignWordsToLines([{ text: 'zzz', start: 1, end: 2 }], lines);
    expect(out[0].start).toBe(10);
    expect(out[0].words).toHaveLength(3);
    expect(out[0].words?.[0].start).toBeCloseTo(10, 3);
  });
});

describe('parseRange', () => {
  it('parses a closed range', () => {
    expect(parseRange('bytes=0-1023', 5000)).toEqual({ start: 0, end: 1023 });
  });

  it('clamps an open-ended range to the file size', () => {
    expect(parseRange('bytes=4000-', 5000)).toEqual({ start: 4000, end: 4999 });
  });

  it('parses a suffix range', () => {
    expect(parseRange('bytes=-500', 5000)).toEqual({ start: 4500, end: 4999 });
  });

  it('clamps a range that overshoots the file size', () => {
    expect(parseRange('bytes=4990-9999', 5000)).toEqual({ start: 4990, end: 4999 });
  });

  it('rejects malformed and unsatisfiable ranges', () => {
    expect(parseRange(undefined, 5000)).toBeNull();
    expect(parseRange('bytes=abc', 5000)).toBe('invalid');
    expect(parseRange('bytes=-', 5000)).toBe('invalid');
    expect(parseRange('bytes=5000-', 5000)).toBe('invalid');
    expect(parseRange('bytes=10-5', 5000)).toBe('invalid');
  });
});

describe('beatPhase', () => {
  const grid = { value: 120, offset: 0, beats: null };

  it('wraps at the beat frequency without a detected grid', () => {
    expect(beatPhase(0, grid)).toBeCloseTo(0, 5);
    expect(beatPhase(0.25, grid)).toBeCloseTo(0.5, 5);
    expect(beatPhase(0.5, grid)).toBeCloseTo(0, 5);
  });

  it('returns 0 when no tempo is known', () => {
    expect(beatPhase(3.7, { value: 0, offset: 0, beats: null })).toBe(0);
  });

  it('interpolates between detected beats', () => {
    const detected = { value: 0, offset: 0, beats: [1, 1.5, 2] };
    expect(beatPhase(1.25, detected)).toBeCloseTo(0.5, 5);
    expect(beatPhase(1.75, detected)).toBeCloseTo(0.5, 5);
    expect(beatPhase(0.5, detected)).toBe(0);
  });
});
