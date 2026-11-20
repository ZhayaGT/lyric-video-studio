import type { Hono } from 'hono';
import { resolveMediaPath, serveFile } from '../lib/range.js';

export function registerMediaRoutes(app: Hono): void {
  app.get('/media/*', async (c) => {
    const url = new URL(c.req.url);
    const rel = url.pathname.replace(/^\/media\//, '');
    const abs = resolveMediaPath(rel);
    if (!abs) return c.json({ error: 'forbidden' }, 403);
    return serveFile(abs, c.req.header('range'));
  });
}
