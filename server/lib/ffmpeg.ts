import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export type RunResult = { stdout: string; stderr: string };

export async function run(cmd: string, args: string[], timeout = 120_000): Promise<RunResult> {
  const { stdout, stderr } = await exec(cmd, args, { timeout, maxBuffer: 64 * 1024 * 1024 });
  return { stdout, stderr };
}

/** Container duration in seconds; 0 when ffprobe cannot read the file. */
export async function probeDuration(file: string): Promise<number> {
  try {
    const { stdout } = await run('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=nw=1:nk=1',
      file,
    ]);
    const value = Number(stdout.trim());
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export function tail(text: string, max = 800): string {
  const trimmed = text.trim();
  return trimmed.length > max ? trimmed.slice(trimmed.length - max) : trimmed;
}
