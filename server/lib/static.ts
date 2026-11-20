import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { MiddlewareHandler } from 'hono';
import { ROOT } from './paths.js';
import { mimeFor } from './mime.js';

const DIST = path.join(ROOT, 'dist');

/** Serve built SPA from dist/, with index.html fallback for non-API routes. */
export function serveStatic(): MiddlewareHandler {
  return async (c, next) => {
    const url = new URL(c.req.url);
    if (url.pathname.startsWith('/api') || url.pathname.startsWith('/media')) return next();

    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const candidate = path.resolve(DIST, rel);
    if (candidate.startsWith(DIST) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      const data = await fsp.readFile(candidate);
      const type = mimeFor(candidate);
      return new Response(data, { headers: { 'Content-Type': type } });
    }
    const index = path.join(DIST, 'index.html');
    if (!fs.existsSync(index)) return c.text('build belum ada: jalankan npm run build', 404);
    const html = await fsp.readFile(index, 'utf8');
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  };
}
