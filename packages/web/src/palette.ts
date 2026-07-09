import type { Basemap } from './types';

/**
 * Field colors, grouped by domain so each domain reads as one "continent" family:
 * Physical Sciences in blues/cyans, Life Sciences in greens, Health Sciences in
 * warm reds/oranges, Social Sciences in purples/magentas.
 */
const DOMAIN_HUE_RANGES: Record<string, [number, number]> = {
  'domains/3': [190, 250], // Physical Sciences
  'domains/1': [90, 160], // Life Sciences
  'domains/4': [0, 55], // Health Sciences
  'domains/2': [265, 330], // Social Sciences
};

export function buildFieldHues(basemap: Basemap): Map<string, number> {
  const hues = new Map<string, number>();
  const byDomain = new Map<string, string[]>();
  for (const f of basemap.fields) {
    byDomain.set(f.domain, [...(byDomain.get(f.domain) ?? []), f.id]);
  }
  for (const [domain, fieldIds] of byDomain) {
    const [lo, hi] = DOMAIN_HUE_RANGES[domain] ?? [0, 360];
    fieldIds.forEach((fid, i) => {
      hues.set(fid, lo + ((hi - lo) * (i + 0.5)) / fieldIds.length);
    });
  }
  return hues;
}

/**
 * A soft radial fill for a territory: a lighter, saturated core fading to a darker rim, so
 * regions read as gently lit landmasses rather than flat blobs.
 */
export function territoryGradient(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  hue: number,
  state: { hover: boolean; focus: boolean; dim: boolean },
): CanvasGradient {
  const g = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
  const sat = state.dim ? 18 : 48;
  const coreL = state.dim ? 13 : state.hover || state.focus ? 30 : 22;
  const rimL = state.dim ? 8 : 12;
  g.addColorStop(0, `hsl(${hue} ${sat}% ${coreL}%)`);
  g.addColorStop(1, `hsl(${hue} ${sat}% ${rimL}%)`);
  return g;
}

export const territoryStroke = (hue: number, dim: boolean) =>
  `hsl(${hue} ${dim ? 24 : 42}% ${dim ? 20 : 34}%)`;
export const territoryGlow = (hue: number) => `hsl(${hue} 85% 60%)`;

/** Warm coverage heat: an orange bloom whose opacity scales with how much you've read there. */
export function heatGradient(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  intensity: number, // 0..1
): CanvasGradient {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  const a = Math.min(0.5, 0.12 + intensity * 0.4);
  g.addColorStop(0, `rgba(245, 182, 66, ${a})`);
  g.addColorStop(0.6, `rgba(245, 140, 66, ${a * 0.5})`);
  g.addColorStop(1, 'rgba(245, 140, 66, 0)');
  return g;
}

/** Deep radial background so the map sits in space rather than on flat black. */
export function paintBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const g = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.max(w, h) * 0.75);
  g.addColorStop(0, '#0d1526');
  g.addColorStop(1, '#05080f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

export const labelColor = 'rgba(233, 238, 252, 0.95)';

/** Chaikin corner-cutting: smooths a closed polygon into soft curves (2 passes ≈ blobby). */
export function chaikin(points: [number, number][], passes = 2): [number, number][] {
  let pts = points;
  for (let p = 0; p < passes; p++) {
    const out: [number, number][] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    pts = out;
  }
  return pts;
}
