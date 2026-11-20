import { useEffect, useRef, useState } from 'react';
import type { LyricLine } from '../types.js';
import { parseLrc, parseVtt, toLyricLines } from '../lyrics/lrc.js';
import { groupWordsIntoLines } from '../lyrics/align.js';
import { distributeTiming, splitText } from '../lyrics/split.js';
import { api, type LrclibCandidate } from './api.js';
import { playhead } from './playhead.js';
import { useEditor } from './store.js';

type ImportMode = 'teks' | 'lrc' | 'vtt' | 'lrclib';

export function LyricEditor({ lines, duration }: { lines: LyricLine[]; duration: number }) {
  const project = useEditor((s) => s.project);
  const selectedLineId = useEditor((s) => s.selectedLineId);
  const setSelectedLine = useEditor((s) => s.setSelectedLine);
  const updateLine = useEditor((s) => s.updateLine);
  const addLine = useEditor((s) => s.addLine);
  const removeLine = useEditor((s) => s.removeLine);
  const mergeWithPrevious = useEditor((s) => s.mergeWithPrevious);
  const splitLine = useEditor((s) => s.splitLine);
  const moveLine = useEditor((s) => s.moveLine);
  const setLines = useEditor((s) => s.setLines);
  const tapSync = useEditor((s) => s.tapSync);
  const toggleTapSync = useEditor((s) => s.toggleTapSync);
  const setToast = useEditor((s) => s.setToast);

  const [importMode, setImportMode] = useState<ImportMode>('teks');
  const [importText, setImportText] = useState('');
  const [candidates, setCandidates] = useState<LrclibCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const health = useEditor((s) => s.health);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const lastManualScroll = useRef(0);
  const [follow, setFollow] = useState(true);
  const [playingId, setPlayingId] = useState<string | null>(null);

  // Track the line being sung right now without re-rendering on every frame:
  // only a change of line id reaches React state.
  useEffect(() => {
    const locate = (t: number): string | null => {
      let candidate: LyricLine | null = null;
      for (const line of lines) {
        if (line.start <= t + 0.01) candidate = line;
        else break;
      }
      if (!candidate) return null;
      return t <= candidate.end + 0.35 ? candidate.id : null;
    };
    const unsubscribe = playhead.subscribe((t) => {
      const id = locate(t);
      setPlayingId((prev) => (prev === id ? prev : id));
    });
    return unsubscribe;
  }, [lines]);

  // Keep the current line centred in the panel while following is on.
  useEffect(() => {
    if (!follow || !playingId) return;
    if (performance.now() - lastManualScroll.current < 3500) return;
    const scroller = scrollerRef.current;
    const row = scroller?.querySelector<HTMLElement>(`[data-line-id="${playingId}"]`);
    if (!scroller || !row) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const delta = rowRect.top - scrollerRect.top;
    const target = scroller.scrollTop + delta - scroller.clientHeight / 2 + rowRect.height / 2;
    scroller.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }, [playingId, follow]);

  const markManualScroll = () => {
    lastManualScroll.current = performance.now();
  };

  const polish = async () => {
    if (lines.length === 0) return;
    setPolishing(true);
    try {
      const { lines: fixed } = await api.polishLyrics(lines.map((line) => line.text));
      setLines(lines.map((line, index) => ({ ...line, text: fixed[index] ?? line.text })));
      setToast('Ejaan & tanda baca dirapikan');
    } catch (err) {
      setToast(`Gagal merapikan: ${(err as Error).message}`);
    } finally {
      setPolishing(false);
    }
  };

  const applyText = () => {
    const raw = importText.trim();
    if (!raw) return;
    if (importMode === 'lrc') {
      const parsed = parseLrc(raw, duration);
      if (parsed.length === 0) return setToast('LRC tidak menghasilkan baris');
      setLines(toLyricLines(parsed));
    } else if (importMode === 'vtt') {
      const parsed = parseVtt(raw, duration);
      setLines(parsed.words.length ? groupWordsIntoLines(parsed.words) : toLyricLines(parsed.lines));
    } else {
      setLines(distributeTiming(splitText(raw, 42), duration));
    }
    setImportText('');
    setToast('Lirik dimuat');
  };

  const fetchLrclib = async () => {
    if (!project) return;
    setBusy(true);
    try {
      const result = await api.lrclib(project.title, project.artist, duration);
      setCandidates(result.candidates);
      if (result.candidates.length === 0) setToast('LRCLIB tidak menemukan lirik — pakai transkripsi AI');
    } catch (err) {
      setToast(`LRCLIB gagal: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const applyCandidate = (candidate: LrclibCandidate) => {
    const parsed = parseLrc(candidate.lrc, duration);
    if (parsed.length === 0) return setToast('LRC kosong');
    setLines(toLyricLines(parsed));
    setCandidates([]);
    setToast(`Lirik dari ${candidate.artistName}`);
  };

  return (
    <div
      className="panel-body"
      ref={scrollerRef}
      onWheel={markManualScroll}
      onTouchMove={markManualScroll}
      onPointerDown={markManualScroll}
    >
      <div className="group">
        <h3>Impor lirik</h3>
        <div className="seg">
          {(['teks', 'lrc', 'vtt', 'lrclib'] as ImportMode[]).map((mode) => (
            <button
              key={mode}
              className={importMode === mode ? 'active' : ''}
              onClick={() => setImportMode(mode)}
            >
              {mode === 'lrclib' ? 'LRCLIB' : mode.toUpperCase()}
            </button>
          ))}
        </div>

        {importMode === 'lrclib' ? (
          <>
            <button onClick={() => void fetchLrclib()} disabled={busy}>
              {busy ? 'Mencari…' : 'Cari lirik LRCLIB'}
            </button>
            {candidates.map((candidate, index) => (
              <button
                key={`${candidate.trackName}-${index}`}
                className="ghost"
                style={{ textAlign: 'left' }}
                onClick={() => applyCandidate(candidate)}
              >
                {candidate.trackName} — {candidate.artistName}
                <span className="badge" style={{ marginLeft: 6 }}>
                  {candidate.synced ? 'sinkron' : 'polos'}
                </span>
              </button>
            ))}
          </>
        ) : (
          <>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={5}
              placeholder={
                importMode === 'lrc'
                  ? '[00:12.00]baris pertama…'
                  : importMode === 'vtt'
                    ? 'WEBVTT…'
                    : 'Tempel teks lirik, satu baris per frasa'
              }
            />
            <button onClick={applyText} disabled={!importText.trim()}>
              Terapkan
            </button>
          </>
        )}
      </div>

      <div className="group">
        <h3>
          Baris lirik
          <span className="hint" style={{ marginLeft: 8 }}>
            {tapSync ? 'tap-sync aktif — tekan S tiap baris' : 'tekan S untuk tap-sync'}
          </span>
        </h3>
        <div className="row wrap">
          <button className={tapSync ? 'primary' : ''} onClick={toggleTapSync}>
            {tapSync ? 'Tap sync: ON' : 'Tap sync'}
          </button>
          <button onClick={() => addLine(selectedLineId ?? undefined)}>+ Baris</button>
          <button
            onClick={() => void polish()}
            disabled={polishing || lines.length === 0 || !(health?.inferhub.configured ?? false)}
            title="Perbaiki ejaan & tanda baca lewat inferhub (timing tidak berubah)"
          >
            {polishing ? 'Merapikan…' : 'Rapikan teks'}
          </button>
          <button
            className={follow ? 'primary' : ''}
            onClick={() => setFollow((value) => !value)}
            title="Daftar lirik mengikuti posisi lagu"
          >
            {follow ? 'Ikuti: ON' : 'Ikuti: OFF'}
          </button>
        </div>

        <div className="line-editor">
          {lines.length === 0 && <div className="hint">Belum ada baris. Impor lirik atau tambah manual.</div>}
          {lines.map((line, index) => (
            <div
              key={line.id}
              data-line-id={line.id}
              className={`line-row${line.id === selectedLineId ? ' selected' : ''}${
                line.id === playingId ? ' playing' : ''
              }`}
              onClick={() => setSelectedLine(line.id)}
            >
              <div className="top">
                <span className="idx">{line.id === playingId ? '▶' : `#${index + 1}`}</span>
                <span className="time">
                  {line.start.toFixed(2)} → {line.end.toFixed(2)}s
                </span>
                <span className={`badge ${line.words?.length ? 'ready' : 'warn'}`}>
                  {line.words?.length ? `${line.words.length} kata` : 'estimasi'}
                </span>
                <span className="grow" />
                <span className="actions">
                  <button
                    className="icon ghost"
                    title="Gabung dengan baris di atas"
                    disabled={index === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      mergeWithPrevious(line.id);
                    }}
                  >
                    ⤒
                  </button>
                  <button
                    className="icon ghost"
                    title="Pisah di tengah teks"
                    onClick={(e) => {
                      e.stopPropagation();
                      splitLine(line.id, Math.ceil(line.text.length / 2));
                    }}
                  >
                    ⫶
                  </button>
                  <button
                    className="icon ghost"
                    title="Seek ke baris"
                    onClick={(e) => {
                      e.stopPropagation();
                      playhead.seek(line.start);
                    }}
                  >
                    ⏱
                  </button>
                  <button
                    className="icon ghost"
                    title="Naik"
                    disabled={index === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      moveLine(line.id, -1);
                    }}
                  >
                    ↑
                  </button>
                  <button
                    className="icon ghost"
                    title="Turun"
                    disabled={index === lines.length - 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      moveLine(line.id, 1);
                    }}
                  >
                    ↓
                  </button>
                  <button
                    className="icon ghost danger"
                    title="Hapus"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeLine(line.id);
                    }}
                  >
                    ✕
                  </button>
                </span>
              </div>
              <textarea
                className="lyric"
                rows={1}
                ref={(el) => {
                  if (!el) return;
                  el.style.height = 'auto';
                  el.style.height = `${el.scrollHeight}px`;
                }}
                value={line.text}
                onChange={(e) => updateLine(line.id, { text: e.target.value, words: undefined })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    const caret = (e.target as HTMLTextAreaElement).selectionStart;
                    splitLine(line.id, caret);
                  }
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
