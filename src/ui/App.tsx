import { useEffect, useRef, useState } from 'react';
import { Library } from './Library.js';
import { Preview } from './Preview.js';
import { Transport } from './Transport.js';
import { Timeline } from './Timeline.js';
import { LyricEditor } from './LyricEditor.js';
import { StylePanel } from './StylePanel.js';
import { AudioPanel } from './AudioPanel.js';
import { ExportPanel } from './ExportPanel.js';
import { playhead } from './playhead.js';
import { useEditor, type Panel } from './store.js';
import { usePanelWidth, useTimelineResize } from './useResize.js';

const PANELS: { id: Panel; label: string }[] = [
  { id: 'lirik', label: 'Lirik' },
  { id: 'desain', label: 'Desain' },
  { id: 'audio', label: 'Audio' },
  { id: 'ekspor', label: 'Ekspor' },
];

export function App() {
  const bootstrap = useEditor((s) => s.bootstrap);
  const project = useEditor((s) => s.project);
  const panel = useEditor((s) => s.panel);
  const setPanel = useEditor((s) => s.setPanel);
  const error = useEditor((s) => s.error);
  const toast = useEditor((s) => s.toast);
  const setToast = useEditor((s) => s.setToast);
  const saving = useEditor((s) => s.saving);
  const dirty = useEditor((s) => s.dirty);
  const save = useEditor((s) => s.save);
  const tap = useEditor((s) => s.tap);
  const safeGuides = useEditor((s) => s.safeGuides);
  const toggleSafeGuides = useEditor((s) => s.toggleSafeGuides);
  const sidebarOpen = useEditor((s) => s.sidebarOpen);
  const setSidebarOpen = useEditor((s) => s.setSidebarOpen);
  const sheetOpen = useEditor((s) => s.sheetOpen);
  const setSheetOpen = useEditor((s) => s.setSheetOpen);
  const audioRef = useRef<HTMLAudioElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const sidebar = usePanelWidth('lvs.sidebarWidth', 236, 180, 420, 'left');
  const panelWidth = usePanelWidth('lvs.panelWidth', 348, 280, 620, 'right');
  const timeline = useTimelineResize(150);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(timer);
  }, [toast, setToast]);

  // Audio element is the clock source whenever the song has a file. Opening a
  // song jumps to its first lyric; later edits keep the current position.
  const openedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!project) return;
    const isNewSong = openedRef.current !== project.id;
    openedRef.current = project.id;
    const first = project.lines[0];
    const startAt = isNewSong && first ? Math.max(0, first.start + 0.4) : playhead.time;
    playhead.attach(audioRef.current, project.audio.duration, startAt);
    return () => playhead.detach();
  }, [project?.id, project?.audio.file, project?.audio.duration]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
        return;
      }
      if (!project) return;

      switch (event.key) {
        case ' ':
          event.preventDefault();
          playhead.toggle();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          playhead.nudge(event.shiftKey ? -1 : -0.1);
          break;
        case 'ArrowRight':
          event.preventDefault();
          playhead.nudge(event.shiftKey ? 1 : 0.1);
          break;
        case 'Escape':
          setSidebarOpen(false);
          setSheetOpen(false);
          break;
        case 's':
        case 'S':
          event.preventDefault();
          tap();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [project, save, tap, setSidebarOpen, setSheetOpen]);

  const toggleFullscreen = () => {
    const stage = stageRef.current;
    if (!stage) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stage.requestFullscreen?.().catch(() => undefined);
  };

  return (
    <div
      className={`app${sheetOpen ? ' sheet-open' : ''}`}
      style={
        {
          '--sidebar-w': `${sidebar.width}px`,
          '--panel-w': `${panelWidth.width}px`,
        } as React.CSSProperties
      }
    >
      <div
        className={`backdrop${sidebarOpen ? ' show' : ''}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />
      <Library />

      <div
        className="splitter splitter-left"
        onPointerDown={sidebar.drag}
        onDoubleClick={() => localStorage.removeItem('lvs.sidebarWidth')}
        role="separator"
        aria-orientation="vertical"
        aria-label="Atur lebar daftar lagu"
        title="Geser untuk mengatur lebar · klik dua kali untuk reset"
      />

      <main className="stage" ref={stageRef}>
        <div className="stage-head">
          <button
            className="icon ghost mobile-only"
            onClick={() => setSidebarOpen(true)}
            title="Daftar lagu"
            aria-label="Daftar lagu"
          >
            ☰
          </button>
          <h1>{project?.title ?? 'Pilih atau buat lagu'}</h1>
          <span className="sub">{project?.artist}</span>
          <span className="spacer" />
          {project && (
            <>
              <span className="state">{saving ? 'menyimpan…' : dirty ? 'belum tersimpan' : 'tersimpan'}</span>
              <button
                className={`icon ${safeGuides ? 'primary' : 'ghost'}`}
                onClick={toggleSafeGuides}
                title="Panduan safe area (tidak ikut ter-export)"
                aria-label="Panduan safe area"
              >
                ⌗
              </button>
              <button
                className="icon ghost"
                onClick={toggleFullscreen}
                title={isFullscreen ? 'Keluar layar penuh (Esc)' : 'Pratinjau layar penuh'}
                aria-label="Layar penuh"
              >
                {isFullscreen ? '⤡' : '⛶'}
              </button>
              <button className="icon ghost" onClick={() => void save()} disabled={!dirty} title="Simpan (Ctrl+S)">
                ⤓
              </button>
            </>
          )}
        </div>

        {error && (
          <div className="error" style={{ margin: '8px 14px 0' }}>
            {error}
          </div>
        )}

        <div className="stage-body">
          {project ? (
            <>
              <Preview project={project} />
              <Transport duration={project.audio.duration} />
              <div
                className="splitter-row"
                onPointerDown={timeline.drag}
                onDoubleClick={timeline.reset}
                role="separator"
                aria-orientation="horizontal"
                aria-label="Atur tinggi timeline"
                title="Geser untuk mengatur tinggi timeline · klik dua kali untuk reset"
              />
              <Timeline
                lines={project.lines}
                duration={project.audio.duration}
                height={timeline.height ?? undefined}
              />
              {project.audio.file && (
                <audio
                  ref={audioRef}
                  src={`/media/songs/${project.id}/${project.audio.file}`}
                  preload="auto"
                  style={{ display: 'none' }}
                />
              )}
            </>
          ) : (
            <div className="empty">
              Belum ada lagu terbuka.
              <br />
              Buat lagu baru, impor URL YouTube, atau tarik berkas audio ke panel kiri.
              <br />
              <br />
              <kbd>Space</kbd> play/pause · <kbd>←</kbd>/<kbd>→</kbd> geser 0,1s · <kbd>Shift</kbd>+panah 1s ·{' '}
              <kbd>S</kbd> tap-sync · <kbd>Ctrl</kbd>+<kbd>S</kbd> simpan
            </div>
          )}
        </div>
      </main>

      <div
        className="splitter splitter-right"
        onPointerDown={panelWidth.drag}
        onDoubleClick={() => localStorage.removeItem('lvs.panelWidth')}
        role="separator"
        aria-orientation="vertical"
        aria-label="Atur lebar panel kanan"
        title="Geser untuk mengatur lebar · klik dua kali untuk reset"
      />

      <aside className={`right${sheetOpen ? ' open' : ''}`}>
        <div className="tabs">
          {PANELS.map((item) => (
            <button
              key={item.id}
              className={panel === item.id ? 'active' : ''}
              onClick={() => setPanel(item.id)}
            >
              {item.label}
            </button>
          ))}
          <button
            className="sheet-close icon"
            onClick={() => setSheetOpen(false)}
            title="Tutup panel"
            aria-label="Tutup panel"
          >
            ⌄
          </button>
        </div>
        {project ? (
          panel === 'lirik' ? (
            <LyricEditor lines={project.lines} duration={project.audio.duration} />
          ) : panel === 'desain' ? (
            <StylePanel />
          ) : panel === 'audio' ? (
            <AudioPanel />
          ) : (
            <ExportPanel />
          )
        ) : (
          <div className="panel-body">
            <div className="hint">Pilih lagu untuk mengedit.</div>
          </div>
        )}
      </aside>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
