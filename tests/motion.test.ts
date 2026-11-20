import { describe, expect, it } from 'vitest';
import { DEFAULT_MOTION, resolveMotion } from '../src/render/presets.js';
import { DEFAULT_STYLE } from '../src/project.js';
import type { Style } from '../src/types.js';

describe('resolveMotion', () => {
  it('fills defaults when the project predates motion', () => {
    const style = structuredClone(DEFAULT_STYLE);
    delete (style as { motion?: unknown }).motion;
    expect(resolveMotion(style)).toEqual(DEFAULT_MOTION);
  });

  it('merges partial motion without dropping the other keys', () => {
    const style: Style = { ...structuredClone(DEFAULT_STYLE), motion: { blur: 12 } };
    const motion = resolveMotion(style);
    expect(motion.blur).toBe(12);
    expect(motion.cameraZoom).toBe(DEFAULT_MOTION.cameraZoom);
    expect(motion.exitLift).toBe(DEFAULT_MOTION.exitLift);
  });

  it('allows disabling motion entirely', () => {
    const style: Style = {
      ...structuredClone(DEFAULT_STYLE),
      motion: { cameraZoom: 0, breathe: 0, drift: 0, blur: 0, exitLift: 0 },
    };
    expect(Object.values(resolveMotion(style)).every((v) => v === 0)).toBe(true);
  });
});
