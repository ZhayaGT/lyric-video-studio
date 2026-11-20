import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.js';

/**
 * Minimal `.env` loader: the tool is meant to run on a church PC with nothing
 * but Node + ffmpeg, so no dotenv dependency. Existing env vars always win.
 */
export function loadEnvFile(file = path.join(ROOT, '.env')): string[] {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const loaded: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
      loaded.push(key);
    }
  }
  return loaded;
}
