import { describe, expect, it } from 'vitest';
import { DEFAULT_KINETIC, resolveKinetic } from '../src/render/kinetic.js';
import { DEFAULT_STYLE } from '../src/project.js';
import type { Style } from '../src/types.js';

describe('resolveKinetic', () => {
  it('fills defaults for projects saved before kinetic existed', () => {
    const style = structuredClone(DEFAULT_STYLE);
    delete (style as { kinetic?: unknown }).kinetic;
    expect(resolveKinetic(style)).toEqual(DEFAULT_KINETIC);
  });

  it('merges partial overrides and keeps the rest', () => {
    const style: Style = { ...structuredClone(DEFAULT_STYLE), kinetic: { rotate: 12 } };
    const kinetic = resolveKinetic(style);
    expect(kinetic.rotate).toBe(12);
    expect(kinetic.wordsPerBurst).toBe(DEFAULT_KINETIC.wordsPerBurst);
    expect(kinetic.smear).toBe(DEFAULT_KINETIC.smear);
  });

  it('keeps burst size inside the frame', () => {
    // A burst of 1 word is allowed; 0 or negative must not produce empty bursts.
    const style: Style = { ...structuredClone(DEFAULT_STYLE), kinetic: { wordsPerBurst: 0 } };
    expect(resolveKinetic(style).wordsPerBurst).toBe(0);
  });
});
