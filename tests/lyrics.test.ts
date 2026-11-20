import { describe, expect, it } from 'vitest';
import { parseLrc, parseVtt } from '../src/lyrics/lrc.js';
import { distributeTiming, splitText } from '../src/lyrics/split.js';

describe('parseLrc', () => {
  it('parses enhanced LRC into word timings', () => {
    const lrc = [
      '[ar:Nama Artis]',
      '[ti:Judul Lagu]',
      '[00:01.00]<00:01.00>Halo <00:01.50>dunia <00:02.00>indah',
      '[00:05.00]Baris kedua',
    ].join('\n');
    const lines = parseLrc(lrc, 30);
    expect(lines).toHaveLength(2);
    expect(lines[0].text).toBe('Halo dunia indah');
    expect(lines[0].words?.map((w) => w.text)).toEqual(['Halo', 'dunia', 'indah']);
    expect(lines[0].words?.[2].start).toBeCloseTo(2, 3);
    expect(lines[0].words?.[0].end).toBeCloseTo(1.5, 3);
    expect(lines[1].words).toBeUndefined();
    expect(lines[1].start).toBeCloseTo(5, 3);
    expect(lines[0].end).toBeCloseTo(4.9, 3);
  });

  it('expands multi-timestamp lines', () => {
    const lines = parseLrc('[00:10.00][00:20.00]chorus', 40);
    expect(lines.map((l) => l.start)).toEqual([10, 20]);
    expect(lines.every((l) => l.text === 'chorus')).toBe(true);
  });

  it('applies the offset metadata tag', () => {
    const lines = parseLrc('[offset:-500]\n[00:10.00]geser', 40);
    expect(lines[0].start).toBeCloseTo(10.5, 3);
  });

  it('ignores metadata-only lines', () => {
    expect(parseLrc('[ar:X]\n[ti:Y]\n[length:03:20]', 40)).toEqual([]);
  });
});

describe('parseVtt', () => {
  const header = 'WEBVTT\nKind: captions\nLanguage: id\n';

  it('collapses duplicate rolling cues', () => {
    const vtt = `${header}
00:00:01.000 --> 00:00:03.000
halo dunia

00:00:01.000 --> 00:00:03.000
halo dunia

00:00:04.000 --> 00:00:06.000
kita mulai

00:00:04.000 --> 00:00:06.000
kita mulai

00:00:07.000 --> 00:00:09.000
akhir kata

00:00:07.000 --> 00:00:09.000
akhir kata
`;
    const lines = parseVtt(vtt, 12).lines;
    expect(lines.map((l) => l.text)).toEqual(['halo dunia', 'kita mulai', 'akhir kata']);
  });

  it('removes the repeated head of the next rolling cue', () => {
    const vtt = `${header}
00:00:01.000 --> 00:00:03.000
satu dua tiga
empat

00:00:03.000 --> 00:00:05.000
empat
lima
`;
    const lines = parseVtt(vtt, 10).lines;
    expect(lines.map((l) => l.text)).toEqual(['satu dua tiga empat', 'lima']);
  });

  it('strips inline timing tags', () => {
    const vtt = `${header}
00:00:02.000 --> 00:00:04.000
<00:00:02.000><c>kasih</c> <00:00:03.000>setia
`;
    expect(parseVtt(vtt, 10).lines[0].text).toBe('kasih setia');
  });

  it('returns empty for header-only input', () => {
    const empty = parseVtt(`${header}\n`, 10);
    expect(empty.lines).toEqual([]);
    expect(empty.words).toEqual([]);
  });
});

describe('splitText', () => {
  it('breaks 200 chars without newlines into <=42 char rows', () => {
    const raw =
      'kasih yang tak pernah berkesudahan menyertai langkah kita di sepanjang perjalanan hidup yang penuh dengan ujian dan harapan serta damai sejahtera yang melampaui segala akal budi manusia di bumi ini selamanya';
    expect(raw.length).toBeGreaterThan(190);
    const lines = splitText(raw, 42);
    expect(lines.length).toBeGreaterThan(3);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(42);
    lines.slice(0, -1).forEach((line) => expect(line.length).toBeGreaterThanOrEqual(12));
    expect(lines.join(' ')).toBe(raw);
  });

  it('merges a short line forward', () => {
    expect(splitText('Oh\nkasih setia Tuhan selamanya', 42)).toEqual(['Oh kasih setia Tuhan selamanya']);
  });

  it('drops blank lines and trims whitespace', () => {
    expect(splitText('  satu dua tiga  \n\n\nempat lima enam  ', 42)).toEqual([
      'satu dua tiga',
      'empat lima enam',
    ]);
  });
});

describe('distributeTiming', () => {
  it('produces ordered, non-overlapping lines inside the duration', () => {
    const texts = ['baris pertama', 'baris kedua yang lebih panjang', 'baris ketiga'];
    const lines = distributeTiming(texts, 60);
    expect(lines).toHaveLength(3);
    expect(lines[0].start).toBeGreaterThan(0);
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].start).toBeGreaterThan(lines[i - 1].end);
    }
    expect(lines[lines.length - 1].end).toBeLessThanOrEqual(60);
    expect(lines[1].end - lines[1].start).toBeGreaterThan(lines[0].end - lines[0].start);
  });
});
