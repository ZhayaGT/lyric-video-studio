import type { Hono } from 'hono';
import fsp from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isConfigured, transcribeAudio } from '../lib/inferhub.js';
import { isSafeId, readProject, songFile } from '../lib/store.js';

export type JobType = 'transcribe';

type Job = {
  id: string;
  type: JobType;
  songId: string;
  state: 'running' | 'done' | 'error';
  progress: number;
  stage: string;
  result: unknown;
  error: string | null;
  detail: string | null;
  startedAt: number;
  finishedAt: number | null;
  cancel: (() => void) | null;
};

const jobs = new Map<string, Job>();
const JOB_TTL_MS = 30 * 60 * 1000;

function publicJob(job: Job) {
  const { cancel: _cancel, ...rest } = job;
  return rest;
}

function sweep(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.finishedAt && now - job.finishedAt > JOB_TTL_MS) jobs.delete(id);
  }
}

export function registerJobRoutes(app: Hono): void {
  app.get('/api/jobs', (c) => {
    sweep();
    return c.json([...jobs.values()].map(publicJob));
  });

  app.post('/api/jobs', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { type?: JobType; songId?: string };
    const songId = String(body.songId ?? '');
    if (body.type !== 'transcribe') return c.json({ error: 'type tidak valid' }, 400);
    if (!isSafeId(songId)) return c.json({ error: 'songId tidak valid' }, 400);
    if (!isConfigured()) {
      return c.json(
        { error: 'inferhub_belum_dikonfigurasi', detail: 'isi INFERHUB_API_KEY di .env lalu restart server' },
        400,
      );
    }

    const project = await readProject(songId);
    if (!project) return c.json({ error: 'not_found' }, 404);
    if (!project.audio.file) return c.json({ error: 'audio_belum_ada' }, 400);

    const audioPath = songFile(songId, project.audio.file);
    try {
      await fsp.access(audioPath);
    } catch {
      return c.json({ error: 'audio_hilang', detail: project.audio.file }, 400);
    }

    const id = randomUUID();
    const job: Job = {
      id,
      type: 'transcribe',
      songId,
      state: 'running',
      progress: 0,
      stage: 'menyiapkan audio',
      result: null,
      error: null,
      detail: null,
      startedAt: Date.now(),
      finishedAt: null,
      cancel: null,
    };
    jobs.set(id, job);
    sweep();

    const controller = new AbortController();
    job.cancel = () => controller.abort();

    void (async () => {
      try {
        const result = await transcribeAudio(
          audioPath,
          project.audio.duration,
          (done, total, note) => {
            job.progress = Math.min(0.99, done / total);
            job.stage = note ?? `bagian ${done}/${total}`;
          },
          controller.signal,
        );
        if (controller.signal.aborted) throw new Error('cancelled');
        job.result = {
          model: result.model,
          chunks: result.chunks,
          device: 'inferhub',
          segments: result.lines.map((line) => ({
            start: line.start,
            end: line.end,
            text: line.text,
            words: [],
          })),
        };
        job.state = 'done';
        job.progress = 1;
        job.stage = 'selesai';
        await fsp.writeFile(
          songFile(songId, 'transcript.json'),
          JSON.stringify({ provider: 'inferhub', ...result }, null, 2),
          'utf8',
        );
      } catch (err) {
        const error = err as Error;
        job.state = 'error';
        job.error = controller.signal.aborted ? 'cancelled' : 'transcribe_failed';
        job.detail = error.message.slice(0, 800);
      } finally {
        job.finishedAt = Date.now();
        job.cancel = null;
      }
    })();

    return c.json(publicJob(job), 202);
  });

  app.get('/api/jobs/:id', (c) => {
    const job = jobs.get(c.req.param('id'));
    if (!job) return c.json({ error: 'job_not_found' }, 404);
    return c.json(publicJob(job));
  });

  app.delete('/api/jobs/:id', (c) => {
    const job = jobs.get(c.req.param('id'));
    if (!job) return c.json({ error: 'job_not_found' }, 404);
    job.cancel?.();
    job.state = 'error';
    job.error = 'cancelled';
    job.finishedAt = Date.now();
    return c.json(publicJob(job));
  });
}
