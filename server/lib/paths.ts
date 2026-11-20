import path from 'node:path';

export const ROOT = process.cwd();
export const DATA_DIR = path.join(ROOT, 'data');
export const SONGS_DIR = path.join(DATA_DIR, 'songs');
