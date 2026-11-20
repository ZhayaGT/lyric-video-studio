import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export type InferhubConfig = {
  baseUrl: string;
  apiKey: string;
  audioModel: string;
  textModel: string;
};

export type TranscriptLine = { start: number; end: number; text: string };

const CHUNK_SECONDS = 90;
const OVERLAP_SECONDS = 2;
const MAX_CONCURRENCY = 2;

export function inferhubConfig(): InferhubConfig {
  return {
    baseUrl: (process.env.INFERHUB_BASE_URL ?? 'https://api.inferhub.dev/v1').replace(/\/+$/, ''),
    apiKey: process.env.INFERHUB_API_KEY ?? '',
    audioModel: process.env.INFERHUB_AUDIO_MODEL ?? 'ali/qwen3.8-omni-flash',
    textModel: process.env.INFERHUB_TEXT_MODEL ?? 'cb/deepseek-v4.1-flash',
  };
}

export function isConfigured(): boolean {
  return inferhubConfig().apiKey.length > 0;
}

/** Strip markdown fences and salvage the first JSON object in a reply. */
export function extractJson(raw: string): unknown | null {
  const text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const direct = (() => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  })();
  if (direct !== null) return direct;

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Keep only well-formed lines, clamp times, and sort. */
export function normalizeLines(value: unknown): TranscriptLine[] {
  const container = value as { lines?: unknown; segments?: unknown } | null;
  const raw = Array.isArray(value) ? value : (container?.lines ?? container?.segments);
  if (!Array.isArray(raw)) return [];

  const out: TranscriptLine[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { start?: unknown; end?: unknown; text?: unknown };
    const text = typeof record.text === 'string' ? record.text.replace(/\s+/g, ' ').trim() : '';
    const start = Number(record.start);
    const end = Number(record.end);
    if (!text) continue;
    if (!Number.isFinite(start)) continue;
    out.push({
      start: Math.max(0, start),
      end: Number.isFinite(end) && end > start ? end : start + 2.5,
      text,
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

const PROMPT = [
  'Transkripsikan lirik lagu ini apa adanya (bahasa asli, jangan diterjemahkan).',
  'Pecah per frasa yang dinyanyikan, satu baris maksimal 7 kata.',
  'Waktu start/end dalam detik relatif terhadap AWAL audio yang dikirim.',
  'Abaikan intro/instrumen tanpa vokal, jangan mengarang baris.',
  'Balas HANYA JSON tanpa penjelasan:',
  '{"lines":[{"start":0.0,"end":2.5,"text":"..."}]}',
].join('\n');

const PROMPT_RETRY = [
  'Dengarkan audio ini. Balas HANYA satu objek JSON, tanpa markdown, tanpa kalimat lain.',
  'Format wajib: {"lines":[{"start":0.0,"end":2.5,"text":"..."}]}',
  'start/end dalam detik relatif ke awal audio. Maksimal 7 kata per baris.',
  'Kalau tidak ada vokal sama sekali, balas tepat: {"lines":[]}',
].join('\n');

type ChatResponse = {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string; type?: string };
};

async function postChat(
  config: InferhubConfig,
  body: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) {
    let message = text.slice(0, 400);
    try {
      const parsed = JSON.parse(text) as ChatResponse;
      message = parsed.error?.message ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`inferhub ${res.status}: ${message}`);
  }
  const parsed = JSON.parse(text) as ChatResponse;
  const content = parsed.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    throw new Error('inferhub mengembalikan respons kosong');
  }
  return content;
}

/** One chunk → transcript lines, timestamps relative to the chunk start. */
async function transcribeChunk(
  config: InferhubConfig,
  audioPath: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<TranscriptLine[]> {
  const data = await fs.readFile(audioPath);
  const audio = data.toString('base64');

  const ask = async (prompt: string): Promise<TranscriptLine[] | null> => {
    const reply = await postChat(
      config,
      {
        model: config.audioModel,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'input_audio', input_audio: { data: audio, format: 'mp3' } },
            ],
          },
        ],
      },
      timeoutMs,
      signal,
    );
    const parsed = extractJson(reply);
    return parsed === null ? null : normalizeLines(parsed);
  };

  const first = await ask(PROMPT);
  if (first && first.length > 0) return first;
  // An empty `lines` array is a legitimate answer (instrumental chunk), so only
  // unparsable or empty replies get one stricter retry before giving up.
  if (first !== null && first.length === 0) {
    const second = await ask(PROMPT_RETRY);
    if (second && second.length > 0) return second;
    return [];
  }
  const retry = await ask(PROMPT_RETRY);
  if (retry && retry.length > 0) return retry;
  if (retry !== null) return [];
  throw new Error('model tidak mengembalikan JSON yang valid untuk bagian ini');
}

export type TranscribeProgress = (done: number, total: number, note?: string) => void;

export type TranscribeResult = {
  model: string;
  chunks: number;
  lines: TranscriptLine[];
  duration: number;
};

/**
 * Transcribe a whole song through inferhub: split into overlapping 90 s MP3
 * chunks (keeps uploads small and timestamps accurate), then merge, dropping the
 * duplicated head of every chunk after the first.
 */
export async function transcribeAudio(
  audioPath: string,
  duration: number,
  onProgress: TranscribeProgress,
  signal?: AbortSignal,
): Promise<TranscribeResult> {
  const config = inferhubConfig();
  if (!config.apiKey) throw new Error('INFERHUB_API_KEY belum diisi di .env');

  const total = Math.max(1, Math.ceil(duration / CHUNK_SECONDS));
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lvs-audio-'));
  const merged: TranscriptLine[] = [];

  try {
    for (let index = 0; index < total; index++) {
      const offset = index * CHUNK_SECONDS;
      const chunkPath = path.join(tmpDir, `chunk-${index}.mp3`);
      await exec('ffmpeg', [
        '-v', 'error', '-y',
        '-ss', String(Math.max(0, offset - (index > 0 ? OVERLAP_SECONDS : 0))),
        '-t', String(CHUNK_SECONDS + OVERLAP_SECONDS * 2),
        '-i', audioPath,
        '-ac', '1',
        '-ar', '16000',
        '-c:a', 'libmp3lame',
        '-b:a', '64k',
        chunkPath,
      ]);
    }

    let done = 0;
    const queue = Array.from({ length: total }, (_, i) => i);
    const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, total) }, async () => {
      for (;;) {
        const index = queue.shift();
        if (index === undefined) return;
        const offset = index * CHUNK_SECONDS;
        const chunkStart = Math.max(0, offset - (index > 0 ? OVERLAP_SECONDS : 0));
        const chunkPath = path.join(tmpDir, `chunk-${index}.mp3`);
        const lines = await transcribeChunk(config, chunkPath, 180_000, signal);

        for (const line of lines) {
          const start = chunkStart + line.start;
          const end = chunkStart + line.end;
          // Each chunk owns [offset, offset+CHUNK_SECONDS): the pre-roll and tail
          // it reads only exist so lines crossing a boundary stay intact.
          if (start < offset) continue;
          if (start >= offset + CHUNK_SECONDS) continue;
          if (duration > 0 && start >= duration) continue;
          merged.push({ start, end, text: line.text });
        }
        done += 1;
        onProgress(done, total, `bagian ${done}/${total}`);
      }
    });

    // allSettled, not all: a failing worker must not tear down the temp dir
    // while the others are still uploading chunks from it. Surface the first
    // failure only after every worker has stopped.
    const settled = await Promise.allSettled(workers);
    const failure = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) throw failure.reason;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  const lines = merged
    .sort((a, b) => a.start - b.start)
    .filter((line, index, all) => {
      const prev = all[index - 1];
      return !prev || Math.abs(prev.start - line.start) > 0.15 || prev.text !== line.text;
    })
    .map((line) => ({
      start: Number(line.start.toFixed(3)),
      end: Number(Math.min(line.end, duration > 0 ? duration : line.end).toFixed(3)),
      text: line.text,
    }));

  return { model: config.audioModel, chunks: total, lines, duration };
}

const POLISH_PROMPT = [
  'Berikut baris lirik lagu rohani berbahasa Indonesia hasil transkripsi otomatis.',
  'Perbaiki HANYA ejaan, kapitalisasi, dan tanda baca. Jangan menambah, menghapus,',
  'menggabung, memecah, menerjemahkan, atau mengubah urutan baris.',
  'Balas HANYA JSON: {"lines":["baris 1","baris 2", ...]} dengan jumlah yang sama.',
].join('\n');

/**
 * Map a polish reply onto the original lines. The reply must contain exactly one
 * entry per line; a shorter or longer list is a contract violation, and any empty
 * entry falls back to the original text.
 */
export function normalizePolish(parsed: unknown, texts: string[]): string[] {
  const container = parsed as { lines?: unknown } | null;
  const list = container && Array.isArray(container.lines) ? container.lines : null;
  if (!list) throw new Error('balasan tidak berisi array "lines"');
  if (list.length !== texts.length) {
    throw new Error(`model mengembalikan ${list.length} baris, seharusnya ${texts.length}`);
  }
  return list.map((item, index) => {
    const text = typeof item === 'string' ? item.replace(/\s+/g, ' ').trim() : '';
    return text.length > 0 ? text : texts[index];
  });
}

/** Clean up transcription spelling without touching timing. */
export async function polishLines(texts: string[], signal?: AbortSignal): Promise<string[]> {
  const config = inferhubConfig();
  if (!config.apiKey) throw new Error('INFERHUB_API_KEY belum diisi di .env');
  if (texts.length === 0) return [];

  const reply = await postChat(
    config,
    {
      model: config.textModel,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: `${POLISH_PROMPT}\n\n${JSON.stringify({ lines: texts }, null, 1)}`,
        },
      ],
    },
    120_000,
    signal,
  );

  return normalizePolish(extractJson(reply), texts);
}

export type { InferhubConfig as Config };
