export type TempoResult = {
  bpm: number;
  beats: number[];
  confidence: number;
};

const FRAME = 1024;
const HOP = 512;

/**
 * Decode + analyse an audio file entirely in the browser (no Python, no server
 * round-trip): onset strength → autocorrelation tempo → beat phase alignment.
 * Works on the church PC too, where only a browser is guaranteed.
 */
export async function analyzeTempo(
  url: string,
  opts: { onProgress?: (ratio: number) => void; signal?: AbortSignal } = {},
): Promise<TempoResult> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`audio tidak bisa diunduh (${res.status})`);
  const buffer = await res.arrayBuffer();
  if (opts.signal?.aborted) throw new DOMException('dibatalkan', 'AbortError');

  // Safari still exposes the constructor under a prefixed name.
  const legacyWindow = window as Window & { webkitAudioContext?: typeof AudioContext };
  const AudioCtx = window.AudioContext ?? legacyWindow.webkitAudioContext;
  if (!AudioCtx) throw new Error('Web Audio tidak tersedia di browser ini');
  const ctx = new AudioCtx();
  let audio: AudioBuffer;
  try {
    audio = await ctx.decodeAudioData(buffer);
  } finally {
    void ctx.close();
  }

  const sampleRate = audio.sampleRate;
  const mono = new Float32Array(audio.length);
  for (let channel = 0; channel < audio.numberOfChannels; channel++) {
    const data = audio.getChannelData(channel);
    for (let i = 0; i < data.length; i++) mono[i] += data[i] / audio.numberOfChannels;
  }

  // Low-pass the spectrum by decimating: beats live under ~150 Hz, so a 4x
  // downsample keeps the kick/snare pulse and cuts cost by 16x.
  const factor = Math.max(1, Math.floor(sampleRate / 11025));
  const decimated = new Float32Array(Math.floor(mono.length / factor));
  for (let i = 0; i < decimated.length; i++) {
    let sum = 0;
    for (let k = 0; k < factor; k++) sum += mono[i * factor + k] ?? 0;
    decimated[i] = sum / factor;
  }
  const sr = sampleRate / factor;

  const frames = Math.max(1, Math.floor((decimated.length - FRAME) / HOP));
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const offset = f * HOP;
    let sum = 0;
    for (let i = 0; i < FRAME; i++) {
      const v = decimated[offset + i];
      sum += v * v;
    }
    energy[f] = Math.sqrt(sum / FRAME);
    if (f % 500 === 0) opts.onProgress?.((f / frames) * 0.6);
  }

  // Spectral-flux-style onset envelope: positive energy change only.
  const onset = new Float32Array(frames);
  for (let f = 1; f < frames; f++) onset[f] = Math.max(0, energy[f] - energy[f - 1]);
  opts.onProgress?.(0.7);

  const fps = sr / HOP;
  const { bpm, confidence } = estimateTempo(onset, fps);
  opts.onProgress?.(0.85);

  const beats = bpm > 0 ? pickBeats(onset, fps, bpm, decimated.length / sr) : [];
  opts.onProgress?.(1);

  return { bpm, beats, confidence };
}

/** Autocorrelate the onset envelope over the 50–200 BPM lag range. */
function estimateTempo(onset: Float32Array, fps: number): { bpm: number; confidence: number } {
  const minLag = Math.floor((fps * 60) / 200);
  const maxLag = Math.ceil((fps * 60) / 50);
  if (onset.length < maxLag * 2) return { bpm: 0, confidence: 0 };

  const mean = onset.reduce((a, b) => a + b, 0) / onset.length;
  const centred = onset.map((v) => v - mean);

  let bestLag = 0;
  let bestScore = 0;
  const scores: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < centred.length; i++) sum += centred[i] * centred[i + lag];
    const score = sum / (centred.length - lag);
    scores.push(score);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestLag === 0 || bestScore <= 0) return { bpm: 0, confidence: 0 };

  // Refine to sub-lag precision with a parabolic fit around the peak.
  const idx = bestLag - minLag;
  const left = scores[idx - 1] ?? scores[idx];
  const right = scores[idx + 1] ?? scores[idx];
  const denom = left - 2 * bestScore + right;
  const shift = denom !== 0 ? (0.5 * (left - right)) / denom : 0;
  const lag = bestLag + Math.max(-0.5, Math.min(0.5, shift));

  let bpm = (60 * fps) / lag;
  while (bpm < 60) bpm *= 2;
  while (bpm > 190) bpm /= 2;

  const total = scores.reduce((a, b) => a + Math.max(0, b), 0) || 1;
  return { bpm, confidence: Math.min(1, bestScore / total) };
}

/** Place beats by walking the tempo grid and snapping each to the loudest onset nearby. */
function pickBeats(onset: Float32Array, fps: number, bpm: number, duration: number): number[] {
  const period = (60 / bpm) * fps;
  const tolerance = Math.max(2, Math.round(period * 0.12));
  const beats: number[] = [];

  // Best starting offset: the phase whose grid lands on the most onset energy.
  let bestPhase = 0;
  let bestSum = -1;
  for (let phase = 0; phase < period; phase += 1) {
    let sum = 0;
    for (let f = Math.round(phase); f < onset.length; f += period) sum += onset[Math.round(f)] ?? 0;
    if (sum > bestSum) {
      bestSum = sum;
      bestPhase = phase;
    }
  }

  for (let f = bestPhase; f < onset.length; f += period) {
    const from = Math.max(0, Math.round(f) - tolerance);
    const to = Math.min(onset.length - 1, Math.round(f) + tolerance);
    let peak = from;
    for (let i = from; i <= to; i++) if (onset[i] > onset[peak]) peak = i;
    const seconds = peak / fps;
    if (seconds >= 0 && seconds <= duration) beats.push(Number(seconds.toFixed(3)));
  }
  return beats;
}
