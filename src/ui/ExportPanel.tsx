import { useRef, useState } from 'react';
import { exportVideo, type ExportProgress } from '../render/export.js';
import { loadAssets } from '../render/assets.js';
import { api } from './api.js';
import { playhead } from './playhead.js';
import { useEditor } from './store.js';

function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function ExportPanel() {
  const project = useEditor((s) => s.project);
  const mutate = useEditor((s) => s.mutate);
  const setToast = useEditor((s) => s.setToast);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ url: string; size: number } | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  if (!project) return null;

  const start = async () => {
    playhead.pause();
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setProgress(null);
    setResult(null);
    try {
      const assets = await loadAssets(project);
      const encoded = await exportVideo(project, {
        assets,
        signal: controller.signal,
        onProgress: setProgress,
      });
      setToast('Encoding selesai, menggabungkan audio…');
      const filename = `${project.id}-${project.export.height}p`;
      const muxed = await api.mux(project.id, filename, encoded.blob);
      setResult({ url: muxed.url, size: muxed.size });
      setToast(`Export selesai (${encoded.codec})`);
    } catch (err) {
      const error = err as Error;
      if (error.name === 'AbortError') setToast('Export dibatalkan');
      else setToast(`Export gagal: ${error.message}`);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const revealFolder = async () => {
    setRevealError(null);
    try {
      await api.reveal(project.id);
      setToast('Folder lagu dibuka');
    } catch (err) {
      setRevealError(`Tidak bisa membuka folder: ${(err as Error).message}`);
    }
  };

  const saveFrame = () => {
    const canvas = document.querySelector<HTMLCanvasElement>('.canvas-wrap canvas');
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${project.id}-frame.png`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, 'image/png');
  };

  return (
    <div className="panel-body">
      <div className="group">
        <h3>Resolusi</h3>
        <div className="seg">
          <button
            className={project.export.height === 720 ? 'active' : ''}
            disabled={running}
            onClick={() => mutate((p) => ({ ...p, export: { ...p.export, width: 1280, height: 720 } }))}
          >
            720p
          </button>
          <button
            className={project.export.height === 1080 ? 'active' : ''}
            disabled={running}
            onClick={() => mutate((p) => ({ ...p, export: { ...p.export, width: 1920, height: 1080 } }))}
          >
            1080p
          </button>
        </div>
        <div className="hint">
          {project.export.width}×{project.export.height} @ {project.export.fps}fps ·{' '}
          {project.audio.duration > 0 ? `${project.audio.duration.toFixed(1)}s` : 'tanpa audio'}
        </div>
      </div>

      <div className="group">
        <h3>Render MP4</h3>
        <button className="primary" onClick={() => void start()} disabled={running || project.audio.duration <= 0}>
          {running ? 'Mengekspor…' : 'Export MP4'}
        </button>
        {running && (
          <button onClick={() => abortRef.current?.abort()}>Batal</button>
        )}
        {progress && (
          <>
            <div className="progress">
              <div style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
            </div>
            <div className="hint">
              frame {progress.frame}/{progress.total} · {Math.round(progress.ratio * 100)}% ·{' '}
              {progress.fps.toFixed(1)} fps · sisa {formatEta(progress.etaSeconds)}
            </div>
          </>
        )}
        {project.audio.duration <= 0 && <div className="hint">Impor audio dulu untuk bisa mengekspor.</div>}
      </div>

      <div className="group">
        <h3>Hasil</h3>
        {result ? (
          <>
            <a href={result.url} download>
              <button className="primary">Unduh MP4 ({(result.size / 1024 / 1024).toFixed(1)} MB)</button>
            </a>
            <div className="hint">{result.url}</div>
          </>
        ) : (
          <div className="hint">Belum ada hasil export.</div>
        )}
        <button onClick={() => void revealFolder()} disabled={running}>
          Buka folder lagu
        </button>
        {revealError && <div className="hint">{revealError}</div>}
        <button onClick={saveFrame} disabled={running}>
          Simpan frame PNG
        </button>
      </div>
    </div>
  );
}
