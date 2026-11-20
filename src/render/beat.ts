import { clamp } from './math.js';

/** Beat phase 0..1 at time t. Uses detected beats when available. */
export function beatPhase(t: number, bpm: { value: number; offset: number; beats: number[] | null }): number {
  const { beats, value, offset } = bpm;
  if (beats && beats.length > 1) {
    if (t <= beats[0]) return 0;
    if (t >= beats[beats.length - 1]) {
      const last = beats[beats.length - 1];
      const period = beats[beats.length - 1] - beats[beats.length - 2];
      if (period <= 0) return 0;
      return ((t - last) / period) % 1;
    }
    let lo = 0;
    let hi = beats.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (beats[mid] <= t) lo = mid;
      else hi = mid;
    }
    const span = beats[hi] - beats[lo];
    if (span <= 0) return 0;
    return clamp((t - beats[lo]) / span);
  }
  if (!value || value <= 0) return 0;
  const phase = ((t - offset) * (value / 60)) % 1;
  return phase < 0 ? phase + 1 : phase;
}
