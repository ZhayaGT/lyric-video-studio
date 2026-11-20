export function clamp(x: number, min = 0, max = 1): number {
  return x < min ? min : x > max ? max : x;
}

export function easeOutCubic(x: number): number {
  return 1 - (1 - x) ** 3;
}

export function easeInCubic(x: number): number {
  return x ** 3;
}

export function easeOutBack(x: number): number {
  return 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2;
}

/** `#rrggbb` or `#rgb` → `rgba(...)` with the given alpha. */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = Number.parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(n)) return `rgba(255,255,255,${alpha})`;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

export function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}
