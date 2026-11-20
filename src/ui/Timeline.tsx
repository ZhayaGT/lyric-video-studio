import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LyricLine } from '../types.js';
import { playhead } from './playhead.js';
import { useEditor } from './store.js';

const ROW_HEIGHT = 28;
const MIN_PX_PER_SEC = 9;

type DragState = {
  id: string;
  mode: 'move' | 'start' | 'end';
  originX: number;
  start: number;
  end: number;
};

export function Timeline({
  lines,
  duration,
  height,
}: {
  lines: LyricLine[];
  duration: number;
  /** Explicit height from the row splitter; omit to let CSS decide. */
  height?: number;
}) {
  const selectedLineId = useEditor((s) => s.selectedLineId);
  const setSelectedLine = useEditor((s) => s.setSelectedLine);
  const updateLine = useEditor((s) => s.updateLine);
  const zoom = useEditor((s) => s.zoom);
  const setZoom = useEditor((s) => s.setZoom);
  const [time, setTime] = useState(playhead.time);
  const [drag, setDrag] = useState<DragState | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => playhead.subscribe(setTime), []);

  const total = Math.max(duration, 1);
  const [viewportWidth, setViewportWidth] = useState(600);

  useEffect(() => {
    const el = trackRef.current?.parentElement;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && width > 0) setViewportWidth(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // zoom 1 → the whole song fits the visible track, but never below a legible
  // minimum scale: a 5-minute song then scrolls instead of collapsing to a bar.
  const pxPerSec = useMemo(
    () => Math.max(viewportWidth / total, MIN_PX_PER_SEC) * zoom,
    [viewportWidth, total, zoom],
  );
  const width = Math.max(viewportWidth, total * pxPerSec);

  const secondsToPx = useCallback((t: number) => t * pxPerSec, [pxPerSec]);
  const pxToSeconds = useCallback((px: number) => px / pxPerSec, [pxPerSec]);

  const ticks = useMemo(() => {
    const targetTicks = Math.max(4, Math.floor(viewportWidth / 70));
    const rawStep = total / targetTicks;
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    const step = steps.find((s) => s >= rawStep) ?? 600;
    const out: number[] = [];
    for (let t = 0; t <= total + 0.001; t += step) out.push(Number(t.toFixed(2)));
    return out;
  }, [total, viewportWidth]);

  const lanes = useMemo(() => {
    const ends: number[] = [];
    const assignment = new Map<string, number>();
    for (const line of lines) {
      let lane = ends.findIndex((end) => end <= line.start + 0.001);
      if (lane === -1) {
        lane = ends.length;
        ends.push(line.end);
      } else {
        ends[lane] = line.end;
      }
      assignment.set(line.id, lane);
    }
    return assignment;
  }, [lines]);

  // Always show a few lanes so the track reads as a track and short songs do not
  // leave the strip mostly empty.
  const laneCount = Math.max(3, Math.max(0, ...lanes.values()) + 1);

  const onPointerDown = (line: LyricLine, mode: DragState['mode']) => (event: React.PointerEvent) => {
    event.stopPropagation();
    try {
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      /* pointer already released, or synthetic event: track handlers still work */
    }
    setSelectedLine(line.id);
    setDrag({ id: line.id, mode, originX: event.clientX, start: line.start, end: line.end });
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!drag) return;
    const delta = pxToSeconds(event.clientX - drag.originX);
    const index = lines.findIndex((l) => l.id === drag.id);
    if (index === -1) return;
    const line = lines[index];
    const prevEnd = lines[index - 1]?.end ?? 0;
    const nextStart = lines[index + 1]?.start ?? total;

    if (drag.mode === 'move') {
      const span = drag.end - drag.start;
      const start = Math.max(prevEnd, Math.min(drag.start + delta, nextStart - span));
      updateLine(drag.id, { start: round(start), end: round(start + span) });
    } else if (drag.mode === 'start') {
      const start = Math.max(prevEnd, Math.min(drag.start + delta, line.end - 0.3));
      updateLine(drag.id, { start: round(start) });
    } else {
      const end = Math.min(nextStart, Math.max(drag.end + delta, line.start + 0.3));
      updateLine(drag.id, { end: round(end) });
    }
  };

  const onPointerUp = () => setDrag(null);

  // Keep the playhead on screen while the song plays or the user seeks.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || drag) return;
    const x = secondsToPx(time);
    const margin = 60;
    if (x < scroller.scrollLeft + margin || x > scroller.scrollLeft + scroller.clientWidth - margin) {
      scroller.scrollLeft = Math.max(0, x - scroller.clientWidth / 2);
    }
  }, [time, secondsToPx, drag]);

  return (
    <div
      className={`timeline${height ? ' sized' : ''}`}
      style={height ? { height, maxHeight: 'none', flex: '0 0 auto' } : undefined}
    >
      <div className="timeline-head">
        <span className="hint">
          {lines.length} baris · geser badan blok, tepi untuk durasi, klik untuk seek
        </span>
        <div className="zoom">
          <button className="ghost" onClick={() => setZoom(zoom / 1.5)} title="Zoom out">
            −
          </button>
          <span className="level">{zoom.toFixed(1)}×</span>
          <button className="ghost" onClick={() => setZoom(zoom * 1.5)} title="Zoom in">
            +
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="timeline-scroll">
        <div
          ref={trackRef}
          style={{ width, position: 'relative' }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerDown={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            playhead.seek(pxToSeconds(e.clientX - rect.left));
          }}
        >
          <div className="timeline-ruler">
            {ticks.map((tick) => (
              <span key={tick} style={{ left: secondsToPx(tick) }}>
                {Math.floor(tick / 60)}:{String(Math.floor(tick % 60)).padStart(2, '0')}
              </span>
            ))}
          </div>

          <div
            className="timeline-track"
            style={{ height: laneCount * ROW_HEIGHT }}
            data-lanes={laneCount}
          >
            {lines.map((line) => {
              const left = secondsToPx(line.start);
              const blockWidth = Math.max(8, secondsToPx(line.end - line.start));
              const lane = lanes.get(line.id) ?? 0;
              return (
                <div
                  key={line.id}
                  className={`line-block${line.id === selectedLineId ? ' selected' : ''}`}
                  style={{ left, width: blockWidth, top: lane * ROW_HEIGHT }}
                  title={`${line.text}\n${line.start.toFixed(2)}s → ${line.end.toFixed(2)}s`}
                  onPointerDown={onPointerDown(line, 'move')}
                >
                  <div className="handle left" onPointerDown={onPointerDown(line, 'start')} />
                  {blockWidth >= 44 ? line.text : ''}
                  <div className="handle right" onPointerDown={onPointerDown(line, 'end')} />
                </div>
              );
            })}
            <div className="playhead-line" style={{ left: secondsToPx(Math.min(time, total)) }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function round(value: number): number {
  return Number(value.toFixed(3));
}
