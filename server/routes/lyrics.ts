import type { Hono } from 'hono';
import { isConfigured, polishLines } from '../lib/inferhub.js';

type Candidate = {
  trackName: string;
  artistName: string;
  duration: number;
  synced: boolean;
  lrc: string;
};

const UA = 'LyricVideoStudio/1.0 (local)';
const RETRY_STATUS = new Set([429, 503, 502, 504]);

async function getJson(url: string): Promise<unknown | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) return await res.json();
      if (!RETRY_STATUS.has(res.status)) return null;
    } catch {
      /* network hiccup — retry */
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

type LrclibRecord = {
  trackName?: string;
  artistName?: string;
  duration?: number;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  instrumental?: boolean;
};

function toCandidate(record: LrclibRecord): Candidate | null {
  const lrc = record.syncedLyrics || record.plainLyrics || '';
  if (!lrc) return null;
  return {
    trackName: record.trackName ?? '',
    artistName: record.artistName ?? '',
    duration: Number(record.duration ?? 0),
    synced: Boolean(record.syncedLyrics),
    lrc,
  };
}

export function registerLyricsRoutes(app: Hono): void {
  app.post('/api/lyrics/lrclib', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      title?: string;
      artist?: string;
      duration?: number;
    };
    const title = (body.title ?? '').trim();
    const artist = (body.artist ?? '').trim();
    const duration = Math.round(Number(body.duration ?? 0));
    if (!title) return c.json({ candidates: [] });

    const candidates: Candidate[] = [];

    const getParams = new URLSearchParams({ track_name: title });
    if (artist) getParams.set('artist_name', artist);
    if (duration > 0) getParams.set('duration', String(duration));
    const exact = (await getJson(`https://lrclib.net/api/get?${getParams}`)) as LrclibRecord | null;
    if (exact && typeof exact === 'object') {
      const candidate = toCandidate(exact);
      if (candidate) candidates.push(candidate);
    }

    if (candidates.length === 0) {
      const query = new URLSearchParams({ q: `${title} ${artist}`.trim() });
      const found = (await getJson(`https://lrclib.net/api/search?${query}`)) as LrclibRecord[] | null;
      if (Array.isArray(found)) {
        for (const record of found.slice(0, 10)) {
          const candidate = toCandidate(record);
          if (candidate) candidates.push(candidate);
        }
      }
    }

    return c.json({ candidates });
  });

  /** Spelling/punctuation cleanup of existing lines; timings stay untouched. */
  app.post('/api/lyrics/polish', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { texts?: unknown };
    const texts = Array.isArray(body.texts) ? body.texts.filter((t): t is string => typeof t === 'string') : [];
    if (texts.length === 0) return c.json({ error: 'texts kosong' }, 400);
    if (texts.length > 400) return c.json({ error: 'terlalu banyak baris (maks 400)' }, 400);
    if (!isConfigured()) {
      return c.json(
        { error: 'inferhub_belum_dikonfigurasi', detail: 'isi INFERHUB_API_KEY di .env lalu restart server' },
        400,
      );
    }
    try {
      const lines = await polishLines(texts, AbortSignal.timeout(120_000));
      return c.json({ lines });
    } catch (err) {
      return c.json({ error: 'polish_failed', detail: String((err as Error).message).slice(0, 400) }, 502);
    }
  });
}
