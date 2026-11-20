import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { Project } from '../types.js';
import type { Assets } from './assets.js';
import { loadAssets } from './assets.js';
import { renderFrame } from './renderFrame.js';
import { sleep } from './math.js';

export type ExportProgress = {
  frame: number;
  total: number;
  ratio: number;
  etaSeconds: number;
  fps: number;
};

export type ExportResult = { blob: Blob; codec: string; mime: string };

type CodecChoice = { codec: string; muxCodec: 'avc' | 'vp9'; bitrate: number; label: string };

function candidateConfigs(width: number, height: number): { choice: CodecChoice; config: VideoEncoderConfig }[] {
  const h264 =
    height >= 1080
      ? { codec: 'avc1.640028', bitrate: 10_000_000, label: 'H.264 High 4.0' }
      : { codec: 'avc1.42001f', bitrate: 6_000_000, label: 'H.264 Baseline 3.1' };
  const vp9 = { codec: 'vp09.00.10.08', bitrate: 5_000_000, label: 'VP9' };

  const out: { choice: CodecChoice; config: VideoEncoderConfig }[] = [];
  for (const [entry, muxCodec] of [
    [h264, 'avc'],
    [vp9, 'vp9'],
  ] as const) {
    const choice: CodecChoice = { ...entry, muxCodec };
    const base = {
      codec: entry.codec,
      width,
      height,
      bitrate: entry.bitrate,
      framerate: 30,
    };
    out.push({ choice, config: { ...base, hardwareAcceleration: 'prefer-hardware', latencyMode: 'quality' } });
    out.push({ choice, config: { ...base, latencyMode: 'quality' } });
  }
  return out;
}

/**
 * `isConfigSupported` and `configure()` both accept configs that then fail
 * asynchronously (e.g. prefer-hardware without a GPU encoder), so every
 * candidate is validated by encoding and flushing one probe frame.
 */
async function encoderWorks(config: VideoEncoderConfig): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  let settled = false;
  const settle = (ok: boolean) => {
    if (settled) return;
    settled = true;
    resolve(ok);
  };
  const encoder = new VideoEncoder({
    output: () => undefined,
    error: () => settle(false),
  });
  try {
    const support = await VideoEncoder.isConfigSupported(config);
    if (!support.supported) {
      encoder.close();
      return false;
    }
    encoder.configure(config);
    const canvas = new OffscreenCanvas(config.width, config.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, config.width, config.height);
    const frame = new VideoFrame(canvas, { timestamp: 0, duration: 33_333 });
    encoder.encode(frame);
    frame.close();
    await encoder.flush();
    settle(true);
  } catch {
    settle(false);
  } finally {
    try {
      encoder.close();
    } catch {
      /* already closed */
    }
  }
  return promise;
}

/**
 * Render + encode the whole project with WebCodecs. Frame `i` always renders at
 * `i / fps`, so the output is frame-exact regardless of machine speed.
 */
export async function exportVideo(
  project: Project,
  opts: {
    onProgress?: (progress: ExportProgress) => void;
    signal?: AbortSignal;
    assets?: Assets;
  } = {},
): Promise<ExportResult> {
  if (typeof VideoEncoder === 'undefined') {
    throw new Error('Browser ini tidak mendukung WebCodecs. Gunakan Chrome atau Edge.');
  }

  const { width, height, fps } = project.export;

  let picked: { choice: CodecChoice; config: VideoEncoderConfig } | null = null;
  for (const candidate of candidateConfigs(width, height)) {
    if (await encoderWorks(candidate.config)) {
      picked = candidate;
      break;
    }
  }
  if (!picked) throw new Error('Tidak ada encoder H.264/VP9 yang tersedia di browser ini.');

  const assets = opts.assets ?? (await loadAssets(project));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D tidak tersedia.');

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: picked.choice.muxCodec, width, height, frameRate: fps },
    fastStart: 'in-memory',
  });

  let encoderError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      encoderError = err instanceof Error ? err : new Error(String(err));
    },
  });
  encoder.configure(picked.config);

  const total = Math.max(1, Math.ceil(project.audio.duration * fps));
  const started = performance.now();
  const frameDuration = Math.round(1_000_000 / fps);

  try {
    for (let i = 0; i < total; i++) {
      if (opts.signal?.aborted) throw new DOMException('Export dibatalkan', 'AbortError');
      if (encoderError) throw encoderError;

      renderFrame(ctx, project, i / fps, assets);
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round((i * 1_000_000) / fps),
        duration: frameDuration,
      });
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();

      while (encoder.encodeQueueSize > 8) {
        await sleep(4);
        if (encoderError) throw encoderError;
      }

      if (i % 3 === 0 || i === total - 1) {
        const elapsed = (performance.now() - started) / 1000;
        const rate = (i + 1) / Math.max(elapsed, 0.001);
        opts.onProgress?.({
          frame: i + 1,
          total,
          ratio: (i + 1) / total,
          etaSeconds: Math.max(0, (total - i - 1) / Math.max(rate, 0.001)),
          fps: rate,
        });
      }
    }

    await encoder.flush();
    muxer.finalize();
  } finally {
    try {
      encoder.close();
    } catch {
      /* already closed */
    }
  }

  const blob = new Blob([target.buffer], { type: 'video/mp4' });
  return { blob, codec: picked.choice.label, mime: 'video/mp4' };
}
