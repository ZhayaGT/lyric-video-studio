import type { LyricLine } from '../types.js';
import { newLineId } from './id.js';

export type Word = { text: string; start: number; end: number };
export type RawLine = { start: number; end: number; text: string; words?: Word[] };

const STAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const META = /^\[([a-zA-Z#]+):(.*)\]$/;
const ENHANCED = /<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>/g;

function stampSeconds(min: string, sec: string, frac?: string): number {
  const f = frac ? Number(frac.padEnd(3, '0').slice(0, 3)) / 1000 : 0;
  return Number(min) * 60 + Number(sec) + f;
}

/** Parse standard + enhanced LRC. `offset` metadata shifts all timestamps. */
export function parseLrc(text: string, duration = 0): RawLine[] {
  const raw = text.replace(/\r\n?/g, '\n');
  let offsetSec = 0;
  const collected: RawLine[] = [];

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const meta = META.exec(line);
    if (meta) {
      const key = meta[1].toLowerCase();
      if (key === 'offset') {
        const v = Number(meta[2].trim());
        if (Number.isFinite(v)) offsetSec = -v / 1000;
      }
      continue;
    }

    const starts: number[] = [];
    STAMP.lastIndex = 0;
    let m: RegExpExecArray | null;
    let consumed = 0;
    while ((m = STAMP.exec(line)) !== null) {
      if (m.index !== consumed) break;
      starts.push(stampSeconds(m[1], m[2], m[3]));
      consumed = m.index + m[0].length;
    }
    if (starts.length === 0) continue;

    const body = line.slice(consumed).trim();
    if (!body) continue;

    const words = parseEnhancedWords(body);
    const plain = words ? words.map((w) => w.text).join(' ') : body;
    for (const start of starts) {
      const shifted = start + offsetSec;
      const shiftedWords = words
        ? words.map((w) => ({ text: w.text, start: w.start + offsetSec, end: w.end + offsetSec }))
        : undefined;
      collected.push({
        start: Math.max(0, shifted),
        end: 0,
        text: plain.replace(/\s+/g, ' ').trim(),
        words: shiftedWords,
      });
    }
  }

  collected.sort((a, b) => a.start - b.start);
  return finalizeEnds(collected, duration);
}

/** `<mm:ss.xx>kata ` markers → word list with end = next word start. */
function parseEnhancedWords(body: string): Word[] | null {
  const marks: { start: number; end: number; time: number }[] = [];
  ENHANCED.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ENHANCED.exec(body)) !== null) {
    marks.push({ start: m.index, end: m.index + m[0].length, time: stampSeconds(m[1], m[2], m[3]) });
  }
  if (marks.length === 0) return null;

  const words: Word[] = [];
  for (let i = 0; i < marks.length; i++) {
    const from = marks[i].end;
    const to = i + 1 < marks.length ? marks[i + 1].start : body.length;
    const cleaned = body.slice(from, to).replace(/<[^>]*>/g, '').trim();
    if (!cleaned) continue;
    words.push({ text: cleaned, start: marks[i].time, end: marks[i + 1]?.time ?? marks[i].time + 0.3 });
  }
  return words.length ? words : null;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}

const CLOCK = '(?:\\d{1,3}:)?\\d{1,2}:\\d{2}(?:[.:]\\d{1,3})?';
const TS_ONLY = new RegExp(`^<${CLOCK}>$`);
const TS_SPLIT = new RegExp(`<(${CLOCK})>`);

function clockToSeconds(clock: string): number | null {
  const m = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(clock.trim());
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  const frac = m[4] ? Number(m[4].padEnd(3, '0').slice(0, 3)) / 1000 : 0;
  return h * 3600 + Number(m[2]) * 60 + Number(m[3]) + frac;
}

/**
 * YouTube auto-captions carry inline `<hh:mm:ss.mmm><c>word</c>` markers. Each
 * timed cue repeats the previous line as context and adds one new timed line,
 * so the timed line alone yields the newly spoken words.
 */
function timedWordsFromLine(line: string, cueStart: number): Word[] {
  const cleaned = line.replace(/<[^>]*>/g, (tag) => (TS_ONLY.test(tag) ? tag : ' '));
  const parts = cleaned.split(TS_SPLIT);
  const out: Word[] = [];
  const push = (chunk: string | undefined, at: number) => {
    if (!chunk) return;
    for (const token of chunk.split(/\s+/)) {
      if (token) out.push({ text: token, start: at, end: at + 0.3 });
    }
  };

  let at = cueStart;
  push(parts[0], at);
  for (let i = 1; i < parts.length; i += 2) {
    at = clockToSeconds(parts[i]) ?? at;
    push(parts[i + 1], at);
  }
  return out;
}

export type ParsedVtt = { lines: RawLine[]; words: Word[] };

/**
 * VTT → lyric lines. Prefers inline word timings (accurate karaoke); otherwise
 * collapses YouTube's rolling duplicate cues into one line per caption.
 */
export function parseVtt(text: string, duration = 0): ParsedVtt {
  const raw = text.replace(/\r\n?/g, '\n');
  const blocks = raw.split(/\n{2,}/);
  const cues: { start: number; end: number; body: string[] }[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    if (/^WEBVTT/i.test(lines[0]) && !lines.some((l) => l.includes('-->'))) continue;
    if (/^(NOTE|STYLE|REGION)\b/i.test(lines[0])) continue;

    const arrowIdx = lines.findIndex((l) => l.includes('-->'));
    if (arrowIdx === -1) continue;
    const [startRaw, endRaw] = lines[arrowIdx].split('-->');
    const start = clockToSeconds(startRaw);
    const end = clockToSeconds((endRaw ?? '').trim().split(/\s+/)[0] ?? '');
    if (start === null || end === null) continue;
    const body = lines.slice(arrowIdx + 1).filter((l) => l.length > 0);
    if (body.length === 0) continue;
    cues.push({ start, end, body });
  }

  const words: Word[] = [];
  for (const cue of cues) {
    for (const line of cue.body) {
      if (!TS_SPLIT.test(line)) continue;
      for (const word of timedWordsFromLine(line, cue.start)) {
        const prev = words[words.length - 1];
        if (prev) {
          const duplicate =
            prev.text.toLowerCase() === word.text.toLowerCase() && Math.abs(prev.start - word.start) < 0.2;
          if (duplicate) continue;
          if (word.start < prev.start) continue;
        }
        words.push(word);
      }
    }
  }

  if (words.length >= 3) {
    for (let i = 0; i < words.length - 1; i++) {
      // Cap the tail so long instrumental gaps still register as pauses when
      // grouping words into lines, instead of swallowing the next line.
      words[i].end = Math.max(words[i].start + 0.05, Math.min(words[i + 1].start, words[i].start + 1.0));
    }
    const last = words[words.length - 1];
    last.end = duration > 0 ? Math.min(duration, last.start + 0.8) : last.start + 0.8;
    return { lines: [], words };
  }

  const flat: RawLine[] = cues.map((cue) => ({
    start: cue.start,
    end: cue.end,
    text: cue.body
      .map((l) => stripTags(l).replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' '),
  }));

  const deduped: RawLine[] = [];
  for (const cue of flat) {
    if (!cue.text) continue;
    const prev = deduped[deduped.length - 1];
    let text = cue.text;
    if (prev) {
      text = removeOverlap(prev.text, text);
      if (!text || text === prev.text) continue;
    }
    deduped.push({ start: cue.start, end: cue.end, text });
  }

  const merged: RawLine[] = [];
  for (const line of deduped) {
    const prev = merged[merged.length - 1];
    if (prev && prev.text === line.text) {
      prev.end = Math.max(prev.end, line.end);
      continue;
    }
    merged.push({ ...line });
  }

  return { lines: finalizeEnds(merged, duration), words: [] };
}

function removeOverlap(prevText: string, text: string): string {
  const prev = prevText.split(' ');
  const cur = text.split(' ');
  let best = 0;
  for (let k = Math.min(prev.length, cur.length); k > 0; k--) {
    let same = true;
    for (let i = 0; i < k; i++) {
      if (prev[prev.length - k + i] !== cur[i]) {
        same = false;
        break;
      }
    }
    if (same) {
      best = k;
      break;
    }
  }
  if (best === 0) {
    if (prevText === text) return '';
    return text;
  }
  return cur.slice(best).join(' ').trim();
}

/** Fill ends: next start - 0.1, last line min(start + 6, duration). */
export function finalizeEnds(lines: RawLine[], duration: number): RawLine[] {
  const out = lines.map((l) => ({ ...l }));
  for (let i = 0; i < out.length; i++) {
    const next = out[i + 1];
    if (next) {
      out[i].end = Math.max(out[i].start + 0.2, next.start - 0.1);
    } else {
      out[i].end = duration > 0 ? Math.min(out[i].start + 6, duration) : out[i].start + 6;
    }
    if (out[i].end <= out[i].start) out[i].end = out[i].start + 0.5;
  }
  return out;
}

export function toLyricLines(raws: RawLine[]): LyricLine[] {
  return raws.map((r) => ({
    id: newLineId(),
    text: r.text,
    start: Number(r.start.toFixed(3)),
    end: Number(r.end.toFixed(3)),
    ...(r.words && r.words.length
      ? { words: r.words.map((w) => ({ text: w.text, start: Number(w.start.toFixed(3)), end: Number(w.end.toFixed(3)) })) }
      : {}),
  }));
}
