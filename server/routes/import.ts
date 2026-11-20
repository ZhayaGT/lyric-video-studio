import type { Hono } from 'hono';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createSong, ensureSongDir, isSafeId, readProject, songDir, songFile, writeProject } from '../lib/store.js';
import { probeDuration, tail } from '../lib/ffmpeg.js';
import { downloadYoutube, fetchYoutubeMeta, isYoutubeUrl } from '../lib/ytdlp.js';
import { parseVtt, toLyricLines } from '../../src/lyrics/lrc.js';
import { groupWordsIntoLines } from '../../src/lyrics/align.js';
import { splitText, distributeTiming } from '../../src/lyrics/split.js';

const AUDIO_EXT = new Set(['.mp3', '.m4a', '.wav', '.ogg', '.opus', '.flac', '.aac', '.webm', '.mp4']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function extOf(name: string): string {
  return path.extname(name).toLowerCase();
}

export function registerImportRoutes(app: Hono): void {
  app.post('/api/import/upload', async (c) => {
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) return c.json({ error: 'file wajib' }, 400);

    const kind = (form.type as string | undefined) === 'image' ? 'image' : 'audio';
    const ext = extOf(file.name);
    const allowed = kind === 'image' ? IMAGE_EXT : AUDIO_EXT;
    if (!allowed.has(ext)) return c.json({ error: `format tidak didukung: ${ext || '?'}` }, 400);

    if (kind === 'image') {
      const songId = String(form.songId ?? '');
      if (!isSafeId(songId)) return c.json({ error: 'songId tidak valid' }, 400);
      const project = await readProject(songId);
      if (!project) return c.json({ error: 'not_found' }, 404);
      await ensureSongDir(songId);
      const rel = path.posix.join('assets', `bg-${Date.now()}${ext}`);
      await fsp.writeFile(songFile(songId, rel), Buffer.from(await file.arrayBuffer()));
      return c.json({ file: rel });
    }

    const title = String(form.title ?? '').trim() || file.name.replace(/\.[^.]+$/, '') || 'Tanpa judul';
    const artist = String(form.artist ?? '').trim();
    const project = await createSong(title, artist);
    const rel = `audio${ext}`;
    await fsp.writeFile(songFile(project.id, rel), Buffer.from(await file.arrayBuffer()));
    const duration = await probeDuration(songFile(project.id, rel));
    if (duration <= 0) {
      await fsp.rm(songDir(project.id), { recursive: true, force: true });
      return c.json({ error: 'audio tidak bisa dibaca (ffprobe gagal)' }, 400);
    }
    const updated = await writeProject({
      ...project,
      audio: { file: rel, duration: Number(duration.toFixed(3)), source: 'upload' },
    });
    return c.json(updated, 201);
  });

  app.post('/api/import/youtube', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { url?: string };
    const url = (body.url ?? '').trim();
    if (!isYoutubeUrl(url)) return c.json({ error: 'url_youtube_tidak_valid' }, 400);

    let meta;
    try {
      meta = await fetchYoutubeMeta(url);
    } catch (err) {
      return c.json({ error: 'youtube_failed', detail: tail(String((err as Error).message ?? err)) }, 400);
    }

    const project = await createSong(meta.title, meta.uploader);
    const dir = songDir(project.id);
    let download;
    try {
      download = await downloadYoutube(url, dir);
    } catch (err) {
      await fsp.rm(dir, { recursive: true, force: true });
      return c.json({ error: 'youtube_failed', detail: tail(String((err as Error).message ?? err)) }, 400);
    }

    const duration = (await probeDuration(path.join(dir, download.audioFile))) || meta.duration;
    let lines: ReturnType<typeof toLyricLines> = [];
    if (download.subtitleFile) {
      try {
        const vtt = await fsp.readFile(path.join(dir, download.subtitleFile), 'utf8');
        const parsed = parseVtt(vtt, duration);
        lines = parsed.words.length
          ? groupWordsIntoLines(parsed.words)
          : toLyricLines(parsed.lines);
      } catch {
        lines = [];
      }
    }

    const stored = await writeProject({
      ...project,
      audio: {
        file: download.audioFile,
        duration: Number(duration.toFixed(3)),
        source: 'youtube',
        sourceUrl: url,
      },
      lines,
    });
    return c.json({ ...stored, subtitle: download.subtitleFile }, 201);
  });

  /** Paste plain text → split lines → distribute timings over the known duration. */
  app.post('/api/lyrics/split', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      text?: string;
      songId?: string;
      duration?: number;
      maxChars?: number;
    };
    const text = String(body.text ?? '');
    const songId = String(body.songId ?? '');
    if (!isSafeId(songId)) return c.json({ error: 'songId tidak valid' }, 400);
    const project = await readProject(songId);
    if (!project) return c.json({ error: 'not_found' }, 404);
    const duration = Number(body.duration ?? project.audio.duration) || 0;
    const lines = distributeTiming(splitText(text, Number(body.maxChars ?? 42)), duration);
    return c.json({ lines });
  });
}
