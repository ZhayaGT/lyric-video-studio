import { useEffect, useRef, useState } from 'react';
import type { Project } from '../types.js';
import { loadAssets, type Assets } from '../render/assets.js';
import { renderFrame } from '../render/renderFrame.js';
import { playhead } from './playhead.js';
import { useEditor } from './store.js';

/** Canvas preview driven by the shared playhead; same renderer as the export. */
export function Preview({ project }: { project: Project }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [assets, setAssets] = useState<Assets | null>(null);
  const safeGuides = useEditor((s) => s.safeGuides);

  const bg = project.style.background;
  const imageFile = bg.kind === 'image' ? bg.file : '';
  const { family, weight, size } = project.style.font;
  const audioDuration = project.audio.duration;

  // Only reload assets when something they depend on changes. Keying on the
  // whole `project` object would re-run this on every keystroke and blank the
  // frame (assets were set to null while loading) — visible as flicker.
  useEffect(() => {
    let cancelled = false;
    void loadAssets(project).then((loaded) => {
      if (!cancelled) setAssets(loaded);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, imageFile, family, weight, size, audioDuration]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height } = project.export;
    canvas.width = width;
    canvas.height = height;
  }, [project.export.width, project.export.height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let frame = 0;
    const draw = () => {
      renderFrame(ctx, project, playhead.time, assets ?? { images: new Map(), duration: 0 }, {
        safeAreaGuides: safeGuides,
      });
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [project, assets, safeGuides]);

  return (
    <div className="canvas-wrap">
      <canvas ref={canvasRef} />
    </div>
  );
}
