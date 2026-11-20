import type { Project } from '../types.js';
import type { Assets } from './assets.js';
import type { Ctx2D } from './text.js';
import { drawBackground } from './backgrounds.js';
import { drawLine, drawSafeArea, exitSpan, wordCount } from './presets.js';
import { beatPhase } from './beat.js';
import { withAlpha } from './math.js';
import { drawGrain } from './grain.js';

export type RenderOpts = { safeAreaGuides?: boolean };

/**
 * Lines whose visible window contains `t`. The tail is padded by the full exit
 * span (duration + stagger tail) so a staggered exit is never clipped, and the
 * head by the crossfade overlap.
 */
export function activeLines(project: Project, t: number) {
  const lead = project.style.transition === 'crossfade' ? 0.25 : 0;
  return project.lines.filter(
    (line) => t >= line.start - lead && t <= line.end + exitSpan(project.style, wordCount(line.text)),
  );
}

/**
 * Single source of truth for preview and export: renders one frame at time `t`
 * deterministically, with no state carried between calls.
 */
export function renderFrame(
  ctx: Ctx2D,
  project: Project,
  t: number,
  assets: Assets,
  opts: RenderOpts = {},
): void {
  const { width: w, height: h } = project.export;
  const phase = beatPhase(t, project.bpm);
  const style = project.style;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  ctx.clearRect(0, 0, w, h);

  drawBackground(ctx, style.background, w, h, t, assets, phase);

  if (style.colors.overlay > 0) {
    ctx.fillStyle = withAlpha('#000000', style.colors.overlay);
    ctx.fillRect(0, 0, w, h);
  }

  // Grain sits under the text so type stays crisp.
  drawGrain(ctx, style.grain ?? 0, t);

  for (const line of activeLines(project, t)) drawLine(ctx, line, t, style, phase);

  if (opts.safeAreaGuides) drawSafeArea(ctx);
  ctx.restore();
}
