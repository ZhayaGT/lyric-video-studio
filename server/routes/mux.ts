import type { Hono } from 'hono';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { run, tail } from '../lib/ffmpeg.js';
import { isSafeId, readProject, songFile } from '../lib/store.js';

const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;

function slugForExport(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'export';
}

/** Never overwrite an earlier render: append -2, -3, … until the name is free. */
async function uniqueExportPath(dir: string, base: string): Promise<{ name: string; path: string }> {
  for (let n = 1; n < 1000; n++) {
    const name = n === 1 ? `${base}.mp4` : `${base}-${n}.mp4`;
    const target = path.join(dir, name);
    try {
      await fsp.access(target);
    } catch {
      return { name, path: target };
    }
  }
  const name = `${base}-${Date.now()}.mp4`;
  return { name, path: path.join(dir, name) };
}

export function registerMuxRoutes(app: Hono): void {
  app.post('/api/mux', async (c) => {
    const form = await c.req.parseBody();
    const video = form.video;
    const songId = String(form.songId ?? '');
    const filename = String(form.filename ?? 'export');

    if (!(video instanceof File)) return c.json({ error: 'video wajib' }, 400);
    if (!isSafeId(songId)) return c.json({ error: 'songId tidak valid' }, 400);
    if (video.size > MAX_VIDEO_BYTES) return c.json({ error: 'video terlalu besar' }, 413);

    const project = await readProject(songId);
    if (!project) return c.json({ error: 'not_found' }, 404);

    const tmpDir = songFile(songId, 'exports', '.tmp');
    await fsp.mkdir(tmpDir, { recursive: true });
    const videoPath = path.join(tmpDir, `${randomUUID()}.mp4`);
    const exportsDir = songFile(songId, 'exports');
    const { name: outName, path: outPath } = await uniqueExportPath(exportsDir, slugForExport(filename));

    await fsp.writeFile(videoPath, Buffer.from(await video.arrayBuffer()));

    const args = ['-y', '-i', videoPath];
    const hasAudio = Boolean(project.audio.file);
    if (hasAudio) args.push('-i', songFile(songId, project.audio.file as string));
    args.push('-map', '0:v:0');
    if (hasAudio) args.push('-map', '1:a:0');
    args.push('-c:v', 'copy');
    if (hasAudio) args.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
    else args.push('-an');
    args.push('-movflags', '+faststart', outPath);

    try {
      await run('ffmpeg', args, 600_000);
    } catch (err) {
      const e = err as { stderr?: string; message?: string };
      await fsp.rm(videoPath, { force: true });
      return c.json({ error: 'mux_failed', detail: tail(e.stderr ?? e.message ?? String(err)) }, 500);
    }

    await fsp.rm(videoPath, { force: true });
    const stat = await fsp.stat(outPath);
    return c.json({
      url: `/media/songs/${songId}/exports/${outName}`,
      file: path.join('exports', outName),
      size: stat.size,
    });
  });
}
