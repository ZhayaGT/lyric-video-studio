import fsp from 'node:fs/promises';
import path from 'node:path';
import { run, tail } from './ffmpeg.js';

export type YoutubeMeta = { id: string; title: string; uploader: string; duration: number };

const ALLOWED_HOSTS: Record<string, true> = {
  'youtube.com': true,
  'www.youtube.com': true,
  'm.youtube.com': true,
  'music.youtube.com': true,
  'youtu.be': true,
  'www.youtu.be': true,
};

export function isYoutubeUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    return ALLOWED_HOSTS[url.hostname.toLowerCase()] === true;
  } catch {
    return false;
  }
}

export async function fetchYoutubeMeta(url: string): Promise<YoutubeMeta> {
  const { stdout } = await run('yt-dlp', ['-J', '--no-warnings', url], 120_000);
  const json = JSON.parse(stdout) as {
    id?: string;
    title?: string;
    uploader?: string;
    channel?: string;
    duration?: number;
  };
  return {
    id: json.id ?? '',
    title: json.title ?? 'Tanpa judul',
    uploader: json.uploader ?? json.channel ?? '',
    duration: Number(json.duration ?? 0),
  };
}

export type DownloadResult = { audioFile: string; subtitleFile: string | null };

/** Download best audio, then best-effort Indonesian/English auto captions as VTT. */
export async function downloadYoutube(url: string, dir: string): Promise<DownloadResult> {
  await fsp.mkdir(dir, { recursive: true });
  try {
    await run(
      'yt-dlp',
      [
        '-f',
        'bestaudio[ext=m4a]/bestaudio',
        '-o',
        path.join(dir, 'audio.%(ext)s'),
        '--no-playlist',
        '--no-warnings',
        url,
      ],
      300_000,
    );
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    throw new Error(tail(e.stderr || e.stdout || e.message || 'yt-dlp gagal'));
  }

  const entries = await fsp.readdir(dir);
  const audio = entries.find((f) => f.startsWith('audio.') && !f.endsWith('.part'));
  if (!audio) throw new Error('yt-dlp tidak menghasilkan berkas audio');

  // Captions are a convenience: YouTube rate-limits individual languages often
  // (HTTP 429) and yt-dlp exits non-zero when any single one fails, so scan the
  // output dir regardless of exit code and keep whatever landed.
  const subDir = path.join(dir, 'subs');
  await fsp.mkdir(subDir, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await run(
        'yt-dlp',
        [
          '--skip-download',
          '--write-auto-subs',
          '--write-subs',
          '--sub-langs',
          'id-orig,id-ID,id,en',
          '--sub-format',
          'vtt',
          '--no-playlist',
          '--no-warnings',
          '--ignore-errors',
          '-o',
          path.join(subDir, '%(id)s.%(ext)s'),
          url,
        ],
        180_000,
      );
    } catch {
      /* keep partial results */
    }
    const found = (await fsp.readdir(subDir)).filter((f) => f.endsWith('.vtt'));
    if (found.length > 0) break;
    if (attempt === 0) await new Promise((r) => setTimeout(r, 3000));
  }

  const priority = ['id-orig', 'id-ID', 'id', 'en'];
  const ranked = (await fsp.readdir(subDir))
    .filter((f) => f.endsWith('.vtt'))
    .map((name) => {
      const lang = name.replace(/^[^.]+\./, '').replace(/\.vtt$/, '');
      const rank = priority.findIndex((p) => lang === p || lang.startsWith(`${p}-`));
      return { name, rank: rank === -1 ? priority.length : rank };
    })
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));

  return {
    audioFile: audio,
    subtitleFile: ranked.length ? path.posix.join('subs', ranked[0].name) : null,
  };
}
