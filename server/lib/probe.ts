import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inferhubConfig, isConfigured } from './inferhub.js';

const exec = promisify(execFile);

export type InferhubInfo = {
  configured: boolean;
  model: string | null;
  baseUrl: string | null;
};

export type Health = {
  ok: true;
  ffmpeg: boolean;
  ytdlp: boolean;
  inferhub: InferhubInfo;
};

async function hasBinary(bin: string, args: string[]): Promise<boolean> {
  try {
    await exec(bin, args, { timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

function inferhubInfo(): InferhubInfo {
  const config = inferhubConfig();
  const configured = isConfigured();
  return {
    configured,
    model: configured ? config.audioModel : null,
    baseUrl: configured ? config.baseUrl : null,
  };
}

let cached: { at: number; value: Promise<Health> } | null = null;
const TTL_MS = 15_000;

export function health(): Promise<Health> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.value;
  const value = (async (): Promise<Health> => {
    const [ffmpeg, ytdlp] = await Promise.all([
      hasBinary('ffmpeg', ['-version']),
      hasBinary('yt-dlp', ['--version']),
    ]);
    return { ok: true, ffmpeg, ytdlp, inferhub: inferhubInfo() };
  })();
  cached = { at: now, value };
  return value;
}
