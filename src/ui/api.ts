import type { LyricLine, Project, SongSummary, StoredProject } from '../types.js';

export type Health = {
  ok: boolean;
  ffmpeg: boolean;
  ytdlp: boolean;
  inferhub: { configured: boolean; model: string | null; baseUrl: string | null };
};

export type Job = {
  id: string;
  type: 'transcribe';
  songId: string;
  state: 'running' | 'done' | 'error';
  progress: number;
  stage: string;
  result: unknown;
  error: string | null;
  detail: string | null;
};

export type Transcript = {
  model: string;
  chunks: number;
  segments: { start: number; end: number; text: string }[];
};

export type LrclibCandidate = {
  trackName: string;
  artistName: string;
  duration: number;
  synced: boolean;
  lrc: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string; detail?: string };
      message = [body.error, body.detail].filter(Boolean).join(': ') || message;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  health: () => request<Health>('/api/health'),

  listSongs: () => request<SongSummary[]>('/api/songs'),
  getSong: (id: string) => request<StoredProject>(`/api/songs/${id}`),
  createSong: (title: string, artist: string) =>
    request<StoredProject>('/api/songs', json({ title, artist })),
  saveSong: (project: Project) =>
    request<StoredProject>(`/api/songs/${project.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(project),
    }),
  deleteSong: (id: string) => request<{ ok: true }>(`/api/songs/${id}`, { method: 'DELETE' }),

  importAudio: async (file: File, title: string, artist: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('title', title);
    form.append('artist', artist);
    return request<StoredProject>('/api/import/upload', { method: 'POST', body: form });
  },

  importImage: async (songId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    form.append('type', 'image');
    form.append('songId', songId);
    return request<{ file: string }>('/api/import/upload', { method: 'POST', body: form });
  },

  importYoutube: (url: string) =>
    request<StoredProject & { subtitle: string | null }>('/api/import/youtube', json({ url })),

  splitLyrics: (songId: string, text: string, duration: number) =>
    request<{ lines: LyricLine[] }>('/api/lyrics/split', json({ songId, text, duration })),

  polishLyrics: (texts: string[]) =>
    request<{ lines: string[] }>('/api/lyrics/polish', json({ texts })),

  lrclib: (title: string, artist: string, duration: number) =>
    request<{ candidates: LrclibCandidate[] }>('/api/lyrics/lrclib', json({ title, artist, duration })),

  startTranscribe: (songId: string) => request<Job>('/api/jobs', json({ type: 'transcribe', songId })),

  getJob: (id: string) => request<Job>(`/api/jobs/${id}`),
  cancelJob: (id: string) => request<Job>(`/api/jobs/${id}`, { method: 'DELETE' }),

  reveal: (songId: string) => request<{ ok: true; dir: string }>('/api/reveal', json({ songId })),

  mux: async (songId: string, filename: string, video: Blob) => {
    const form = new FormData();
    form.append('video', video, 'render.mp4');
    form.append('songId', songId);
    form.append('filename', filename);
    return request<{ url: string; file: string; size: number }>('/api/mux', { method: 'POST', body: form });
  },
};
