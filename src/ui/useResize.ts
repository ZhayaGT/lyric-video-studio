import { useCallback, useEffect, useState } from 'react';

export type Side = 'left' | 'right';

/** Persisted pixel width for a side panel, clamped so the stage never collapses. */
export function usePanelWidth(key: string, fallback: number, min: number, max: number, side: Side) {
  const [width, setWidth] = useState(() => {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    const parsed = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
  });

  useEffect(() => {
    localStorage.setItem(key, String(Math.round(width)));
  }, [key, width]);

  const drag = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = width;
      const limit = () => Math.max(min, Math.min(max, window.innerWidth - 420));

      const move = (ev: PointerEvent) => {
        const delta = ev.clientX - startX;
        // Dragging a right-hand splitter leftwards must grow its panel.
        setWidth(Math.max(min, Math.min(limit(), side === 'right' ? startWidth - delta : startWidth + delta)));
      };
      const stop = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', stop);
        window.removeEventListener('pointercancel', stop);
        document.body.classList.remove('resizing');
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', stop);
      window.addEventListener('pointercancel', stop);
      document.body.classList.add('resizing');
    },
    [width, min, max, side],
  );

  const reset = () => {
    localStorage.removeItem(key);
    setWidth(fallback);
  };

  return { width, drag, reset };
}

/**
 * Height of the timeline strip, or `null` to let the layout decide. Dragging the
 * splitter above it pins an explicit height so operators can trade frame size
 * for timeline detail.
 */
export function useTimelineResize(initial = 150) {
  const [height, setHeight] = useState<number | null>(null);

  const drag = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = height ?? initial;

      const move = (ev: PointerEvent) => {
        const next = startHeight + (startY - ev.clientY);
        setHeight(Math.max(80, Math.min(window.innerHeight * 0.6, next)));
      };
      const stop = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', stop);
        window.removeEventListener('pointercancel', stop);
        document.body.classList.remove('resizing-row');
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', stop);
      window.addEventListener('pointercancel', stop);
      document.body.classList.add('resizing-row');
    },
    [height, initial],
  );

  return { height, drag, reset: () => setHeight(null) };
}
