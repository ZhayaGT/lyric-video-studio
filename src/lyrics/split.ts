import type { LyricLine } from '../types.js';
import { newLineId } from './id.js';

const MIN_LINE = 12;

/**
 * Normalize whitespace, split on newlines, break long lines at the nearest
 * space before `maxChars`, drop empties, and merge very short lines forward.
 */
export function splitText(raw: string, maxChars = 42): string[] {
  const normalized = raw.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ');
  const out: string[] = [];

  for (const source of normalized.split('\n')) {
    const line = source.trim();
    if (!line) continue;
    if (line.length <= maxChars) {
      out.push(line);
      continue;
    }
    let rest = line;
    while (rest.length > maxChars) {
      let cut = rest.lastIndexOf(' ', maxChars);
      if (cut <= 0) cut = rest.indexOf(' ');
      if (cut <= 0) break;
      const head = rest.slice(0, cut).trim();
      if (head) out.push(head);
      rest = rest.slice(cut + 1).trim();
    }
    if (rest) out.push(rest);
  }

  const merged: string[] = [];
  for (let i = 0; i < out.length; i++) {
    const cur = out[i];
    const next = out[i + 1];
    if (cur.length < MIN_LINE && next !== undefined && cur.length + 1 + next.length <= maxChars * 1.5) {
      out[i + 1] = `${cur} ${next}`.trim();
      continue;
    }
    merged.push(cur);
  }
  return merged;
}

/**
 * Spread lines across the timeline proportional to text length, starting at
 * 1s, leaving 0.15s gaps, over `duration - 2` seconds.
 */
export function distributeTiming(texts: string[], duration: number): LyricLine[] {
  if (texts.length === 0) return [];
  const total = Math.max(duration - 2, texts.length * 0.6);
  const gaps = 0.15 * (texts.length - 1);
  const usable = Math.max(total - gaps, texts.length * 0.4);
  const weights = texts.map((t) => t.length + 4);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  let cursor = duration > 0 ? Math.min(1, duration * 0.1) : 0;

  return texts.map((text, i) => {
    const span = (weights[i] / weightSum) * usable;
    const start = cursor;
    const end = start + span;
    cursor = end + 0.15;
    return {
      id: newLineId(),
      text,
      start: Number(start.toFixed(3)),
      end: Number(end.toFixed(3)),
    };
  });
}
