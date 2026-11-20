import type { Ctx2D } from '../src/render/text.js';

export type FakeCtx = Ctx2D & {
  canvas: { width: number; height: number };
  fills: { text: string; x: number; y: number }[];
};

/**
 * Headless canvas stand-in: monospace-ish metrics so wrap/autofit maths is
 * deterministic under vitest (no DOM, no real font shaping).
 */
export function fakeCtx(width = 1280, height = 720): FakeCtx {
  const ctx = {
    canvas: { width, height },
    font: '16px sans-serif',
    letterSpacing: '0px',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    fillStyle: '#fff',
    globalAlpha: 1,
    fills: [] as { text: string; x: number; y: number }[],
    measureText(text: string) {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 16);
      return { width: text.length * size * 0.55 } as TextMetrics;
    },
    fillText(text: string, x: number, y: number) {
      this.fills.push({ text, x, y });
    },
    save() {},
    restore() {},
    translate() {},
    scale() {},
    rotate() {},
    beginPath() {},
    rect() {},
    clip() {},
    stroke() {},
    fillRect() {},
    clearRect() {},
    drawImage() {},
    setLineDash() {},
    strokeRect() {},
    createLinearGradient() {
      return { addColorStop() {} } as unknown as CanvasGradient;
    },
    createRadialGradient() {
      return { addColorStop() {} } as unknown as CanvasGradient;
    },
    setTransform() {},
  };
  return ctx as unknown as FakeCtx;
}
