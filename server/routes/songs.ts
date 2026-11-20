import type { Hono } from 'hono';
import { createSong, deleteSong, isSafeId, listSongs, readProject, validateProject, writeProject } from '../lib/store.js';

export function registerSongRoutes(app: Hono): void {
  app.get('/api/songs', async (c) => c.json(await listSongs()));

  app.post('/api/songs', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { title?: string; artist?: string };
    const title = (body.title ?? '').trim();
    if (!title) return c.json({ error: 'title wajib' }, 400);
    const project = await createSong(title, (body.artist ?? '').trim());
    return c.json(project, 201);
  });

  app.get('/api/songs/:id', async (c) => {
    const id = c.req.param('id');
    if (!isSafeId(id)) return c.json({ error: 'id tidak valid' }, 400);
    const project = await readProject(id);
    if (!project) return c.json({ error: 'not_found' }, 404);
    return c.json(project);
  });

  app.put('/api/songs/:id', async (c) => {
    const id = c.req.param('id');
    if (!isSafeId(id)) return c.json({ error: 'id tidak valid' }, 400);
    const body = await c.req.json().catch(() => null);
    const project = validateProject(body);
    if (typeof project === 'string') return c.json({ error: project }, 400);
    if (project.id !== id) return c.json({ error: 'id tidak cocok' }, 400);
    const stored = await writeProject(project);
    return c.json(stored);
  });

  app.delete('/api/songs/:id', async (c) => {
    const id = c.req.param('id');
    if (!isSafeId(id)) return c.json({ error: 'id tidak valid' }, 400);
    const ok = await deleteSong(id);
    if (!ok) return c.json({ error: 'not_found' }, 404);
    return c.json({ ok: true });
  });
}
