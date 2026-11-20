import type { LyricLine } from '../types.js';
import { newLineId } from './id.js';

export type TimedWord = { text: string; start: number; end: number };

const PUNCT = /[^\p{L}\p{N}\s]/gu;
const BREAK_AFTER = /[.?!,;:…]$/;
const MAX_WORDS_PER_LINE = 7;
const PAUSE_BREAK = 0.7;

function normalizeWord(text: string): string {
  return text.toLowerCase().replace(PUNCT, '').trim();
}

/**
 * Group Whisper words into lines when no reference text exists: break on
 * pauses > 0.7s, after sentence punctuation, or every 7 words.
 */
export function groupWordsIntoLines(words: TimedWord[]): LyricLine[] {
  const groups: TimedWord[][] = [];
  let current: TimedWord[] = [];

  for (const word of words) {
    const text = word.text.trim();
    if (!text) continue;
    const prev = current[current.length - 1];
    const gap = prev ? word.start - prev.end : 0;
    const tooLong = current.length >= MAX_WORDS_PER_LINE;
    const sentenceEnd = prev ? BREAK_AFTER.test(prev.text.trim()) : false;

    if (current.length > 0 && (gap > PAUSE_BREAK || tooLong || sentenceEnd)) {
      groups.push(current);
      current = [];
    }
    current.push({ ...word, text });
  }
  if (current.length) groups.push(current);

  // A pause inside a phrase can leave a one-word orphan; fold it into the
  // neighbour that still has room so lines read as phrases, not fragments.
  // Never do it across sentence punctuation, or real breaks disappear.
  const balanced: TimedWord[][] = [];
  for (const group of groups) {
    const prev = balanced[balanced.length - 1];
    const prevEndsSentence = prev ? BREAK_AFTER.test(prev[prev.length - 1].text.trim()) : false;
    const groupEndsSentence = BREAK_AFTER.test(group[group.length - 1].text.trim());
    const mergeable =
      prev &&
      !prevEndsSentence &&
      !groupEndsSentence &&
      (group.length < 2 || prev.length < 2) &&
      prev.length + group.length <= MAX_WORDS_PER_LINE;
    if (mergeable) {
      prev.push(...group);
      continue;
    }
    balanced.push([...group]);
  }

  return balanced
    .map((group) => {
      const text = group.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim();
      const start = group[0].start;
      const end = Math.max(group[group.length - 1].end, start + 0.3);
      return {
        id: newLineId(),
        text,
        start: Number(start.toFixed(3)),
        end: Number(end.toFixed(3)),
        words: group.map((w) => ({
          text: w.text,
          start: Number(w.start.toFixed(3)),
          end: Number(Math.max(w.end, w.start + 0.05).toFixed(3)),
        })),
      } satisfies LyricLine;
    })
    .filter((line) => line.text.length > 0);
}

/**
 * Map timed words onto existing lyric lines by longest-common-subsequence
 * alignment over normalized tokens. Lines without a match keep their own
 * timings and get proportional word timings instead.
 */
export function alignWordsToLines(words: TimedWord[], lines: LyricLine[]): LyricLine[] {
  if (words.length === 0 || lines.length === 0) return lines;

  const lineTokens = lines.map((line) => line.text.split(/\s+/).map(normalizeWord).filter(Boolean));
  const wordTokens = words.map((w) => normalizeWord(w.text));

  // LCS table over the flattened line tokens vs word tokens.
  const flat: { line: number; token: number }[] = [];
  lineTokens.forEach((tokens, line) => tokens.forEach((_, token) => flat.push({ line, token })));

  const n = flat.length;
  const m = wordTokens.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        lineTokens[flat[i].line][flat[i].token] === wordTokens[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const matched: { line: number; wordIndex: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (lineTokens[flat[i].line][flat[i].token] === wordTokens[j]) {
      matched.push({ line: flat[i].line, wordIndex: j });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }

  const perLine = new Map<number, TimedWord[]>();
  for (const { line, wordIndex } of matched) {
    const bucket = perLine.get(line) ?? [];
    bucket.push(words[wordIndex]);
    perLine.set(line, bucket);
  }

  return lines.map((line, idx) => {
    const tokens = line.text.split(/\s+/).filter(Boolean);
    // Auto-captions already carry per-word timings; never downgrade them to a
    // proportional estimate just because ASR spelled the words differently.
    if (line.words && line.words.length === tokens.length) return line;
    const bucket = perLine.get(idx);
    if (!bucket || bucket.length === 0 || bucket.length !== tokens.length) {
      return { ...line, words: distributeWords(line, tokens) };
    }
    const start = Math.max(0, bucket[0].start);
    const end = Math.max(bucket[bucket.length - 1].end, start + 0.3);
    return {
      ...line,
      start: Number(start.toFixed(3)),
      end: Number(end.toFixed(3)),
      words: bucket.map((w) => ({
        text: w.text,
        start: Number(w.start.toFixed(3)),
        end: Number(Math.max(w.end, w.start + 0.05).toFixed(3)),
      })),
    };
  });
}

function distributeWords(line: LyricLine, tokens: string[]): { text: string; start: number; end: number }[] {
  if (tokens.length === 0) return [];
  const span = Math.max(line.end - line.start, 0.3);
  const weights = tokens.map((t) => t.length + 1);
  const sum = weights.reduce((a, b) => a + b, 0);
  let cursor = line.start;
  return tokens.map((text, idx) => {
    const dur = (weights[idx] / sum) * span;
    const start = cursor;
    cursor += dur;
    return {
      text,
      start: Number(start.toFixed(3)),
      end: Number((start + dur).toFixed(3)),
    };
  });
}
