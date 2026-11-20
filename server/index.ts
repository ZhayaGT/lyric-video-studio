import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { loadEnvFile } from './lib/env.js';
import { health } from './lib/probe.js';
import { registerSongRoutes } from './routes/songs.js';
import { registerMediaRoutes } from './routes/media.js';
import { registerLyricsRoutes } from './routes/lyrics.js';
import { registerImportRoutes } from './routes/import.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerMuxRoutes } from './routes/mux.js';
import { registerRevealRoutes } from './routes/reveal.js';
import { serveStatic } from './lib/static.js';

const loaded = loadEnvFile();
if (loaded.length > 0) console.log(`[server] .env dimuat: ${loaded.join(', ')}`);

const app = new Hono();

app.get('/api/health', async (c) => c.json(await health()));

registerSongRoutes(app);
registerMediaRoutes(app);
registerLyricsRoutes(app);
registerImportRoutes(app);
registerJobRoutes(app);
registerMuxRoutes(app);
registerRevealRoutes(app);

app.onError((err, c) => {
  console.error('[server]', err);
  return c.json({ error: 'internal', detail: String(err?.message ?? err) }, 500);
});

const prod = process.argv.includes('--prod');
if (prod) app.use('*', serveStatic());

const port = Number(process.env.PORT ?? 5178);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[server] http://localhost:${info.port}${prod ? ' (prod)' : ''}`);
});
