import type { Hono } from 'hono';
import fsp from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { isSafeId, songDir } from '../lib/store.js';

/**
 * Open the song folder in the OS file manager. Only ever called from the local
 * UI, so the request must come from loopback; the path is derived from the song
 * id, never from the request body.
 */
export function registerRevealRoutes(app: Hono): void {
  app.post('/api/reveal', async (c) => {
    const host = c.req.header('host') ?? '';
    const remote = c.req.header('x-forwarded-for');
    if (remote || !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) {
      return c.json({ error: 'hanya untuk localhost' }, 403);
    }

    const body = (await c.req.json().catch(() => ({}))) as { songId?: string };
    const songId = String(body.songId ?? '');
    if (!isSafeId(songId)) return c.json({ error: 'songId tidak valid' }, 400);

    const dir = songDir(songId);
    try {
      await fsp.access(dir);
    } catch {
      return c.json({ error: 'not_found' }, 404);
    }

    const opener =
      process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    try {
      const child = spawn(opener, [dir], { detached: true, stdio: 'ignore' });
      child.unref();
    } catch (err) {
      return c.json({ error: 'reveal_failed', detail: String((err as Error).message) }, 500);
    }
    return c.json({ ok: true, dir });
  });
}
