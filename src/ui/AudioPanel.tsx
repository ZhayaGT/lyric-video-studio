import { useEffect, useRef, useState } from 'react';
import type { Job, Transcript } from './api.js';
import { api } from './api.js';
import { analyzeTempo } from '../audio/tempo.js';
import { alignWordsToLines } from '../lyrics/align.js';
import { newLineId } from '../lyrics/id.js';
import type { LyricLine } from '../types.js';
import { playhead } from './playhead.js';
import { useEditor } from './store.js';

const TAP_WINDOW = 4000;

/**
 * Expand segments into pseudo word timings by distributing each segment's tokens
 * over its span. Enough for LCS alignment against existing lyric text.
 */
function segmentWords(segments: Transcript['segments']): { text: string; start: number; end: number }[] {
  const words: { text: string; start: number; end: number }[] = [];
  for (const segment of segments) {
    const tokens = segment.text.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const span = Math.max(segment.end - segment.start, 0.2);
    const per = span / tokens.length;
    tokens.forEach((text, index) => {
      const start = segment.start + index * per;
      words.push({ text, start, end: start + per });
    });
  }
  return words;
}

export function AudioPanel() {
  const project = useEditor((s) => s.project);
  const health = useEditor((s) => s.health);
  const mutate = useEditor((s) => s.mutate);
  const setLines = useEditor((s) => s.setLines);
  const setToast = useEditor((s) => s.setToast);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState<'tempo' | 'transcribe' | null>(null);
  const [tempoProgress, setTempoProgress] = useState(0);
  const [taps, setTaps] = useState<number[]>([]);
  const [mode, setMode] = useState<'replace' | 'timing'>('timing');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => clearInterval(pollRef.current ?? undefined), []);

  const audioUrl = project?.audio.file ? `/media/songs/${project.id}/${project.audio.file}` : null;
  const aiReady = health?.inferhub.configured ?? false;

  const detectTempo = async () => {
    if (!project || !audioUrl) return;
    setBusy('tempo');
    setTempoProgress(0);
    try {
      const result = await analyzeTempo(audioUrl, { onProgress: setTempoProgress });
      if (!(result.bpm > 0) || result.beats.length === 0) {
        setToast('Tidak ada tempo terdeteksi — isi BPM manual atau pakai tap tempo');
        return;
      }
      mutate((p) => ({
        ...p,
        bpm: {
          value: Number(result.bpm.toFixed(2)),
          offset: result.beats[0] ?? 0,
          beats: result.beats,
          source: 'browser',
        },
      }));
      setToast(`BPM ${result.bpm.toFixed(1)} · ${result.beats.length} beat`);
    } catch (err) {
      setToast(`Deteksi tempo gagal: ${(err as Error).message}`);
    } finally {
      setBusy(null);
      setTempoProgress(0);
    }
  };

  const transcribe = async () => {
    if (!project) return;
    setBusy('transcribe');
    try {
      const started = await api.startTranscribe(project.id);
      setJob(started);
      clearInterval(pollRef.current ?? undefined);
      pollRef.current = setInterval(async () => {
        try {
          const next = await api.getJob(started.id);
          setJob(next);
          if (next.state === 'running') return;
          clearInterval(pollRef.current ?? undefined);
          pollRef.current = null;
          setBusy(null);
          if (next.state !== 'done') {
            setToast(`Transkripsi gagal: ${next.error ?? 'tidak diketahui'}${next.detail ? ` — ${next.detail}` : ''}`);
            return;
          }
          const result = next.result as Transcript;
          const segments = result.segments.filter((segment) => segment.text.trim().length > 0);
          if (segments.length === 0) {
            setToast('Model tidak mengembalikan baris lirik');
            return;
          }

          // Keep the user's own wording and take only the timing from the model.
          if (project.lines.length > 0 && mode === 'timing') {
            const aligned = alignWordsToLines(segmentWords(segments), project.lines);
            setLines(aligned);
            setToast(`Timing disesuaikan untuk ${aligned.length} baris (teks tetap)`);
            return;
          }

          const fresh: LyricLine[] = segments.map((segment) => ({
            id: newLineId(),
            text: segment.text.trim(),
            start: Number(segment.start.toFixed(3)),
            end: Number(Math.max(segment.end, segment.start + 0.4).toFixed(3)),
          }));
          setLines(fresh);
          setToast(`${fresh.length} baris dari ${result.model} (${result.chunks} bagian)`);
        } catch (err) {
          clearInterval(pollRef.current ?? undefined);
          pollRef.current = null;
          setBusy(null);
          setToast(`Job hilang, ulangi. (${(err as Error).message})`);
        }
      }, 900);
    } catch (err) {
      setBusy(null);
      setToast(`Transkripsi gagal: ${(err as Error).message}`);
    }
  };

  const tapTempo = () => {
    const now = performance.now();
    const recent = [...taps.filter((t) => now - t < TAP_WINDOW), now];
    setTaps(recent);
    if (recent.length < 4) return;
    const deltas = recent.slice(1).map((t, i) => (t - recent[i]) / 1000);
    const sorted = [...deltas].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (!median) return;
    const bpm = 60 / median;
    mutate((p) => ({
      ...p,
      bpm: { value: Number(bpm.toFixed(2)), offset: p.bpm.offset, beats: null, source: 'manual' },
    }));
    setToast(`Tap tempo: ${bpm.toFixed(1)} BPM`);
  };

  if (!project) return null;

  return (
    <div className="panel-body">
      <div className="group">
        <h3>Berkas audio</h3>
        <div className="hint">
          {project.audio.file
            ? `${project.audio.file} · ${project.audio.duration.toFixed(1)}s · ${project.audio.source}`
            : 'Belum ada audio untuk lagu ini.'}
        </div>
      </div>

      <div className="group">
        <h3>BPM &amp; beat</h3>
        <div className="row wrap">
          <button onClick={() => void detectTempo()} disabled={!audioUrl || busy !== null}>
            {busy === 'tempo' ? `Menganalisis… ${Math.round(tempoProgress * 100)}%` : 'Deteksi BPM'}
          </button>
          <button onClick={tapTempo} title="Ketuk minimal 4 kali">
            Tap tempo
          </button>
        </div>
        {busy === 'tempo' && (
          <div className="progress">
            <div style={{ width: `${Math.round(tempoProgress * 100)}%` }} />
          </div>
        )}
        <div className="grid-2">
          <div className="field">
            <label>BPM</label>
            <input
              type="text"
              inputMode="decimal"
              value={project.bpm.value}
              onChange={(e) => {
                const value = Number(e.target.value.replace(',', '.')) || 0;
                mutate((p) => ({ ...p, bpm: { ...p.bpm, value, source: 'manual', beats: null } }));
              }}
            />
          </div>
          <div className="field">
            <label>Offset (s)</label>
            <input
              type="text"
              inputMode="decimal"
              value={project.bpm.offset}
              onChange={(e) => {
                const offset = Number(e.target.value.replace(',', '.')) || 0;
                mutate((p) => ({ ...p, bpm: { ...p.bpm, offset } }));
              }}
            />
          </div>
        </div>
        <div className="hint">
          sumber: {project.bpm.source}
          {project.bpm.beats ? ` · ${project.bpm.beats.length} beat` : ' · tanpa grid beat'}
          {' · dihitung di browser ini, tanpa server'}
        </div>
      </div>

      <div className="group">
        <h3>Lirik otomatis (AI)</h3>
        {!aiReady && (
          <div className="hint">
            Inferhub belum dikonfigurasi. Isi <kbd>INFERHUB_API_KEY</kbd> di berkas <kbd>.env</kbd> lalu restart server.
            Impor LRC/manual tetap bisa dipakai.
          </div>
        )}
        <button
          className="primary"
          onClick={() => void transcribe()}
          disabled={!aiReady || !audioUrl || busy !== null}
        >
          {busy === 'transcribe'
            ? `${job?.stage ?? 'Memproses'} · ${Math.round((job?.progress ?? 0) * 100)}%`
            : 'Transkripsi lirik (AI)'}
        </button>
        {busy === 'transcribe' && (
          <div className="progress">
            <div style={{ width: `${Math.round((job?.progress ?? 0) * 100)}%` }} />
          </div>
        )}
        {busy === 'transcribe' && job && (
          <button onClick={() => void api.cancelJob(job.id).catch(() => undefined)}>Batalkan</button>
        )}
        {project.lines.length > 0 && (
          <div className="seg">
            <button className={mode === 'timing' ? 'active' : ''} onClick={() => setMode('timing')}>
              Timing saja
            </button>
            <button className={mode === 'replace' ? 'active' : ''} onClick={() => setMode('replace')}>
              Ganti teks
            </button>
          </div>
        )}
        <div className="hint">
          Model: {health?.inferhub.model ?? '—'} lewat inferhub (audio dipecah 90 detik, paralel).{' '}
          {project.lines.length > 0 && mode === 'timing'
            ? 'Teks lirik Anda dipertahankan; hanya waktunya yang diperbarui.'
            : 'Hasil menimpa baris lirik yang ada.'}
        </div>
      </div>

      <div className="group">
        <h3>Pratinjau cepat</h3>
        <div className="row wrap">
          <button onClick={() => playhead.seek(0)}>Awal</button>
          <button
            onClick={() => {
              const first = project.lines[0];
              if (first) playhead.seek(Math.max(0, first.start - 1));
            }}
            disabled={project.lines.length === 0}
          >
            Baris pertama
          </button>
          <button
            onClick={() => playhead.seek(Math.max(0, project.audio.duration / 2))}
            disabled={!project.audio.file}
          >
            Tengah
          </button>
        </div>
      </div>
    </div>
  );
}
