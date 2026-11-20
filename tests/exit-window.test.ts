import { describe, expect, it } from 'vitest';
import { activeLines, renderFrame } from '../src/render/renderFrame.js';
import { fakeCtx } from './fakeCtx.js';
import { exitSpan, wordCount } from '../src/render/presets.js';
import { EXIT_STAGGER_RATIO } from '../src/render/math.js';
import { DEFAULT_STYLE, defaultProject } from '../src/project.js';
import type { LyricLine, Project, Style } from '../src/types.js';

function projectWith(style: Partial<Style>, lines: LyricLine[]): Project {
  const base = defaultProject('tes', 'Tes', 'X');
  return { ...base, style: { ...base.style, ...style }, lines };
}

const line = (id: string, text: string, start: number, end: number): LyricLine => ({ id, text, start, end });

describe('wordCount', () => {
  it('counts words without splitting on regexes', () => {
    expect(wordCount('Ku mau cinta Yesus selamanya')).toBe(5);
    expect(wordCount('  spasi   berlebih  ')).toBe(2);
    expect(wordCount('')).toBe(0);
    expect(wordCount('satu\ndua\ttiga')).toBe(3);
  });
});

describe('exitSpan', () => {
  it('covers the exit duration plus the stagger tail', () => {
    const style: Style = { ...structuredClone(DEFAULT_STYLE), timing: { inDur: 0.4, outDur: 0.3, stagger: 0.1 } };
    expect(exitSpan(style, 1)).toBeCloseTo(0.3, 5);
    // 5 words → tail = 4 * 0.1 * EXIT_STAGGER_RATIO
    expect(exitSpan(style, 5)).toBeCloseTo(0.3 + 4 * 0.1 * EXIT_STAGGER_RATIO, 5);
  });

  it('never returns zero for a single-word line', () => {
    const style: Style = { ...structuredClone(DEFAULT_STYLE), timing: { inDur: 0.4, outDur: 0, stagger: 0 } };
    expect(exitSpan(style, 1)).toBeGreaterThan(0);
  });
});

describe('activeLines', () => {
  it('keeps a line during its staggered exit, past the old 0.25s pad', () => {
    const style: Style = {
      ...structuredClone(DEFAULT_STYLE),
      transition: 'cut',
      timing: { inDur: 0.4, outDur: 0.35, stagger: 0.12 },
    };
    const project = projectWith(style, [line('a', 'satu dua tiga empat lima enam tujuh', 10, 20)]);
    const span = exitSpan(style, 7);
    expect(span).toBeGreaterThan(0.25);

    // Inside the exit window but beyond the old hardcoded pad: must still render.
    expect(activeLines(project, 20.3)).toHaveLength(1);
    expect(activeLines(project, 20 + span - 0.01)).toHaveLength(1);
  });

  it('drops the line once the exit is fully over', () => {
    const style: Style = { ...structuredClone(DEFAULT_STYLE), transition: 'cut' };
    const project = projectWith(style, [line('a', 'satu dua tiga', 10, 20)]);
    expect(activeLines(project, 20 + exitSpan(style, 3) + 0.05)).toHaveLength(0);
  });

  it('includes the next line during the crossfade overlap only', () => {
    const style: Style = { ...structuredClone(DEFAULT_STYLE), transition: 'crossfade' };
    const project = projectWith(style, [line('a', 'satu', 10, 20), line('b', 'dua', 20.4, 30)]);
    expect(activeLines(project, 20.2).map((l) => l.id)).toEqual(['a', 'b']);
    const cut = projectWith({ ...style, transition: 'cut' }, project.lines);
    expect(activeLines(cut, 20.2).map((l) => l.id)).toEqual(['a']);
  });

  it('ignores lines that have not started yet', () => {
    const project = projectWith({}, [line('a', 'satu', 10, 20)]);
    expect(activeLines(project, 9)).toHaveLength(0);
  });
});

describe('renderFrame exit behaviour', () => {
  const style: Style = {
    ...structuredClone(DEFAULT_STYLE),
    transition: 'cut',
    timing: { inDur: 0.3, outDur: 0.3, stagger: 0.3 },
  };
  const project = projectWith(style, [line('a', 'satu dua tiga empat lima enam', 10, 12)]);
  const assets = { images: new Map(), duration: 20 };
  const ctx = () => fakeCtx(1280, 720);

  it('still draws the line after line.end while its exit staggers', () => {
    const canvas = ctx();
    // 12.5s: past line.end (12) and past the old 0.25s pad, inside the exit tail.
    renderFrame(canvas, project, 12.5, assets);
    expect(canvas.fills.length).toBeGreaterThan(0);
  });

  it('stops drawing once the whole exit is over', () => {
    const canvas = ctx();
    renderFrame(canvas, project, 12 + exitSpan(style, 6) + 0.1, assets);
    expect(canvas.fills).toHaveLength(0);
  });

  it('does not fade the line early while it is holding', () => {
    const holding = ctx();
    renderFrame(holding, project, 11, assets);
    const count = holding.fills.length;
    expect(count).toBeGreaterThan(0);
    // Same number of glyphs mid-hold as at the start of the hold: no premature
    // fade-out from a second, line-level envelope.
    const early = ctx();
    renderFrame(early, project, 10.4, assets);
    expect(early.fills.length).toBe(count);
  });
});
