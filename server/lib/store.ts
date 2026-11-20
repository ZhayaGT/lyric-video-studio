import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { SONGS_DIR } from './paths.js';
import { defaultProject } from '../../src/project.js';
import type { Project, SongSummary, StoredProject } from '../../src/types.js';

export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return base || 'lagu';
}

export function uniqueSlug(title: string): string {
  const base = slugify(title);
  if (!fs.existsSync(songDir(base))) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!fs.existsSync(songDir(candidate))) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export function songDir(id: string): string {
  return path.join(SONGS_DIR, id);
}

export function songFile(id: string, ...parts: string[]): string {
  return path.join(songDir(id), ...parts);
}

export async function ensureSongDir(id: string): Promise<string> {
  const dir = songDir(id);
  await fsp.mkdir(path.join(dir, 'assets'), { recursive: true });
  await fsp.mkdir(path.join(dir, 'exports'), { recursive: true });
  return dir;
}

export async function readProject(id: string): Promise<StoredProject | null> {
  try {
    const raw = await fsp.readFile(songFile(id, 'project.json'), 'utf8');
    const parsed = JSON.parse(raw) as StoredProject;
    if (parsed?.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeProject(project: Project): Promise<StoredProject> {
  await ensureSongDir(project.id);
  const stored: StoredProject = { ...project, updatedAt: new Date().toISOString() };
  const target = songFile(project.id, 'project.json');
  const tmp = `${target}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(stored, null, 2), 'utf8');
  await fsp.rename(tmp, target);
  return stored;
}

export async function createSong(title: string, artist: string): Promise<StoredProject> {
  const id = uniqueSlug(title);
  const project = defaultProject(id, title, artist);
  return writeProject(project);
}

export async function listSongs(): Promise<SongSummary[]> {
  let ids: string[] = [];
  try {
    const entries = await fsp.readdir(SONGS_DIR, { withFileTypes: true });
    ids = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
  const out: SongSummary[] = [];
  for (const id of ids) {
    const p = await readProject(id);
    if (!p) continue;
    out.push({
      id: p.id,
      title: p.title,
      artist: p.artist,
      duration: p.audio.duration,
      updatedAt: p.updatedAt ?? new Date(0).toISOString(),
    });
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteSong(id: string): Promise<boolean> {
  if (!isSafeId(id)) return false;
  const dir = songDir(id);
  if (!fs.existsSync(dir)) return false;
  await fsp.rm(dir, { recursive: true, force: true });
  return true;
}

export function isSafeId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
}

export function validateProject(body: unknown): Project | string {
  if (!body || typeof body !== 'object') return 'body harus objek';
  const p = body as Partial<Project>;
  if (p.version !== 1) return 'version harus 1';
  if (typeof p.id !== 'string' || !isSafeId(p.id)) return 'id tidak valid';
  if (typeof p.title !== 'string') return 'title tidak valid';
  if (!p.audio || typeof p.audio.duration !== 'number') return 'audio tidak valid';
  if (!p.style || typeof p.style !== 'object') return 'style tidak valid';
  if (!Array.isArray(p.lines)) return 'lines harus array';
  if (!p.export || typeof p.export.width !== 'number') return 'export tidak valid';
  return p as Project;
}
