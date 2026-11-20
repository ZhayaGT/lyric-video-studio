import type { Project, Style } from '../types.js';

export type Assets = {
  images: Map<string, ImageBitmap>;
  duration: number;
};

const bitmapCache = new Map<string, ImageBitmap>();

async function loadBitmap(url: string): Promise<ImageBitmap | null> {
  const cached = bitmapCache.get(url);
  if (cached) return cached;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    bitmapCache.set(url, bitmap);
    return bitmap;
  } catch {
    return null;
  }
}

/** Load the font face used by the style so the first frame is never fallback text. */
async function ensureFont(style: Style): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const spec = `${style.font.weight} ${style.font.size}px "${style.font.family}"`;
  try {
    await document.fonts.load(spec, 'AaBbGgKk0123');
    await document.fonts.ready;
  } catch {
    /* fall back to the system stack */
  }
}

export async function loadAssets(project: Project): Promise<Assets> {
  await ensureFont(project.style);
  const images = new Map<string, ImageBitmap>();
  const bg = project.style.background;
  if (bg.kind === 'image' && bg.file) {
    const bitmap = await loadBitmap(`/media/songs/${project.id}/${bg.file.replace(/^\/+/, '')}`);
    if (bitmap) images.set(bg.file, bitmap);
  }
  return { images, duration: project.audio.duration };
}

export function invalidateAssets(): void {
  bitmapCache.clear();
}
