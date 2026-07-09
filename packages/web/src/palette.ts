import type { Basemap } from './types';

export interface FieldColor {
  h: number;
  s: number;
  l: number; // lightness of the lit core
}

/**
 * Each domain gets a WIDE, vivid hue arc so its fields stay clearly distinct from one another
 * (Physics vs Engineering vs Computer Science, Economics vs Arts) while the domain still reads
 * as a loose colour family. Saturation and core-lightness are alternated per field for extra
 * separation, and kept high so territories look vivid rather than muddy.
 */
const DOMAIN_ARCS: Record<string, [number, number]> = {
  'domains/3': [170, 265], // Physical Sciences: teal → cyan → blue → indigo → violet
  'domains/1': [78, 168], // Life Sciences: lime → green → emerald → teal
  'domains/4': [-18, 52], // Health Sciences: magenta-red → red → orange → amber
  'domains/2': [275, 340], // Social Sciences: violet → purple → magenta → pink
};

export function buildFieldColors(basemap: Basemap): Map<string, FieldColor> {
  const colors = new Map<string, FieldColor>();
  const byDomain = new Map<string, string[]>();
  for (const f of basemap.fields) {
    byDomain.set(f.domain, [...(byDomain.get(f.domain) ?? []), f.id]);
  }
  let fallback = 0;
  for (const [domain, fieldIds] of byDomain) {
    const arc = DOMAIN_ARCS[domain];
    fieldIds.forEach((fid, i) => {
      const n = fieldIds.length;
      let h: number;
      if (arc) {
        const [lo, hi] = arc;
        h = (lo + ((hi - lo) * (i + 0.5)) / n + 360) % 360;
      } else {
        h = (fallback++ * 137.5) % 360; // golden angle for any ungrouped fields
      }
      // alternate to push neighbours further apart perceptually
      const s = 62 + (i % 2 === 0 ? 8 : 0);
      const l = 46 + (i % 3) * 5;
      colors.set(fid, { h, s, l });
    });
  }
  return colors;
}

/** Back-compat: hue only (used where a single number is enough). */
export function buildFieldHues(basemap: Basemap): Map<string, number> {
  const m = new Map<string, number>();
  for (const [id, c] of buildFieldColors(basemap)) m.set(id, c.h);
  return m;
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
  color: FieldColor,
  state: { hover: boolean; focus: boolean; dim: boolean },
): CanvasGradient {
  const g = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
  const sat = state.dim ? 22 : color.s;
  const bump = state.hover || state.focus ? 12 : 0;
  const coreL = state.dim ? 15 : color.l + bump;
  const rimL = state.dim ? 9 : Math.max(14, color.l - 22);
  g.addColorStop(0, `hsl(${color.h} ${sat}% ${coreL}%)`);
  g.addColorStop(1, `hsl(${color.h} ${sat}% ${rimL}%)`);
  return g;
}

export const territoryStroke = (color: FieldColor, dim: boolean) =>
  `hsl(${color.h} ${dim ? 26 : color.s}% ${dim ? 24 : Math.min(62, color.l + 16)}%)`;
export const territoryGlow = (color: FieldColor) => `hsl(${color.h} 90% 66%)`;

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

/** Deep radial background so the map sits in a soft-lit space rather than on flat black. */
export function paintBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const g = ctx.createRadialGradient(w / 2, h * 0.4, 0, w / 2, h * 0.4, Math.max(w, h) * 0.8);
  g.addColorStop(0, '#141d33');
  g.addColorStop(0.55, '#0c1322');
  g.addColorStop(1, '#070b14');
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
