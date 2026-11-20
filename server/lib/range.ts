import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { DATA_DIR } from './paths.js';
import { mimeFor } from './mime.js';

export type ParsedRange = { start: number; end: number } | 'invalid' | null;

export function parseRange(header: string | undefined | null, size: number): ParsedRange {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return 'invalid';
  const [, rawStart, rawEnd] = m;
  if (rawStart === '' && rawEnd === '') return 'invalid';
  let start: number;
  let end: number;
  if (rawStart === '') {
    // suffix range: last N bytes
    const n = Number(rawEnd);
    if (!Number.isFinite(n) || n <= 0) return 'invalid';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Number(rawEnd);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'invalid';
  if (start > end || start >= size) return 'invalid';
  return { start, end: Math.min(end, size - 1) };
}

export { mimeFor };

/** Resolve a media-relative path, refusing anything that escapes DATA_DIR. */
export function resolveMediaPath(rel: string): string | null {
  const decoded = decodeURIComponent(rel);
  if (decoded.includes('\0')) return null;
  const abs = path.resolve(DATA_DIR, decoded);
  const rootWithSep = DATA_DIR.endsWith(path.sep) ? DATA_DIR : DATA_DIR + path.sep;
  if (abs !== DATA_DIR && !abs.startsWith(rootWithSep)) return null;
  return abs;
}

export async function serveFile(
  abs: string,
  rangeHeader: string | undefined,
): Promise<Response> {
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(abs);
  } catch {
    return new Response('not found', { status: 404 });
  }
  if (!stat.isFile()) return new Response('not found', { status: 404 });

  const size = stat.size;
  const type = mimeFor(abs);
  const parsed = parseRange(rangeHeader, size);

  if (parsed === 'invalid') {
    return new Response('range not satisfiable', {
      status: 416,
      headers: { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' },
    });
  }

  if (parsed) {
    const { start, end } = parsed;
    const stream = fs.createReadStream(abs, { start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
      },
    });
  }

  const stream = fs.createReadStream(abs);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      'Content-Type': type,
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    },
  });
}
