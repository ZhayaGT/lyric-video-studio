import { describe, expect, it } from 'vitest';
import { extractJson, normalizeLines, normalizePolish } from '../server/lib/inferhub.js';

describe('extractJson', () => {
  it('parses a bare JSON object', () => {
    expect(extractJson('{"lines":[]}')).toEqual({ lines: [] });
  });

  it('strips a ```json fence', () => {
    expect(extractJson('```json\n{"lines":[{"start":1,"end":2,"text":"a"}]}\n```')).toEqual({
      lines: [{ start: 1, end: 2, text: 'a' }],
    });
  });

  it('salvages JSON surrounded by prose', () => {
    const reply = 'Berikut hasilnya:\n{"lines":[{"start":0,"end":1,"text":"halo"}]}\nSemoga membantu.';
    expect(extractJson(reply)).toEqual({ lines: [{ start: 0, end: 1, text: 'halo' }] });
  });

  it('returns null for unparsable output', () => {
    expect(extractJson('maaf, saya tidak bisa')).toBeNull();
    expect(extractJson('{"lines": [')).toBeNull();
  });
});

describe('normalizeLines', () => {
  it('accepts the documented shape and sorts by start', () => {
    const lines = normalizeLines({
      lines: [
        { start: 5, end: 7, text: 'kedua' },
        { start: 1, end: 3, text: 'pertama' },
      ],
    });
    expect(lines.map((l) => l.text)).toEqual(['pertama', 'kedua']);
  });

  it('accepts a bare array and a segments key', () => {
    expect(normalizeLines([{ start: 0, end: 1, text: 'a' }])).toHaveLength(1);
    expect(normalizeLines({ segments: [{ start: 0, end: 1, text: 'a' }] })).toHaveLength(1);
  });

  it('drops entries without usable text or a numeric start', () => {
    const lines = normalizeLines({
      lines: [
        { start: 0, end: 1, text: '   ' },
        { start: 'x', end: 1, text: 'salah' },
        { start: 2, end: 3, text: 'benar' },
        null,
        'teks',
      ],
    });
    expect(lines).toEqual([{ start: 2, end: 3, text: 'benar' }]);
  });

  it('repairs inverted or missing end times', () => {
    const lines = normalizeLines({
      lines: [
        { start: 4, end: 2, text: 'a' },
        { start: 6, text: 'b' },
      ],
    });
    expect(lines[0].end).toBeGreaterThan(lines[0].start);
    expect(lines[1].end).toBeGreaterThan(lines[1].start);
  });

  it('collapses whitespace and clamps negatives', () => {
    const lines = normalizeLines({ lines: [{ start: -3, end: 1, text: '  dua   kata ' }] });
    expect(lines[0].start).toBe(0);
    expect(lines[0].text).toBe('dua kata');
  });

  it('returns empty for unusable payloads', () => {
    expect(normalizeLines(null)).toEqual([]);
    expect(normalizeLines({})).toEqual([]);
    expect(normalizeLines('teks')).toEqual([]);
  });
});

describe('normalizePolish', () => {
  const original = ['ku mau cinta yesus', 'meskipun badai silih berganti'];

  it('keeps the model text when the count matches', () => {
    expect(normalizePolish({ lines: ['Ku mau cinta Yesus', 'Meskipun badai silih berganti'] }, original)).toEqual([
      'Ku mau cinta Yesus',
      'Meskipun badai silih berganti',
    ]);
  });

  it('collapses whitespace in the reply', () => {
    expect(normalizePolish({ lines: ['  Ku   mau  cinta ', 'ok'] }, original)[0]).toBe('Ku mau cinta');
  });

  it('falls back to the original for empty entries', () => {
    expect(normalizePolish({ lines: ['', 'ok'] }, original)[0]).toBe('ku mau cinta yesus');
  });

  it('rejects a reply with a different line count', () => {
    expect(() => normalizePolish({ lines: ['hanya satu'] }, original)).toThrow(/seharusnya 2/);
  });

  it('rejects a reply without a lines array', () => {
    expect(() => normalizePolish({ text: 'bukan json yang benar' }, original)).toThrow(/array "lines"/);
    expect(() => normalizePolish(null, original)).toThrow();
  });
});
