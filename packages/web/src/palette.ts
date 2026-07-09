import type { Basemap } from './types';

/**
 * Curated, harmonious field colours (Seaborn-"muted" flavour) — rich but not neon. Each domain
 * gets a family of related-but-distinct hues so it reads as a region while its fields stay
 * clearly separable.
 */
const DOMAIN_PALETTES: Record<string, string[]> = {
  'domains/3': ['#4c72b0', '#4fa1c9', '#3fae9f', '#5b7fbd', '#6f8fbf', '#3d7a8c', '#6aa3c8'], // Physical
  'domains/1': ['#55a868', '#83b66a', '#6fa287', '#4e8c6a', '#93a35a', '#7bb274', '#5c9e7a'], // Life
  'domains/4': ['#c4646a', '#dd8452', '#d98a6a', '#cc6f7d', '#e0a458', '#bd5f7a', '#d99080'], // Health
  'domains/2': ['#8172b3', '#a579b8', '#b07aa1', '#9370b0', '#7e6ba8', '#bd8bc0', '#8e6c9e'], // Social
};
const FALLBACK = ['#6b7f99', '#7d8fa8', '#5f7288'];

export function buildFieldColors(basemap: Basemap): Map<string, string> {
  const colors = new Map<string, string>();
  const byDomain = new Map<string, string[]>();
  for (const f of basemap.fields) byDomain.set(f.domain, [...(byDomain.get(f.domain) ?? []), f.id]);
  for (const [domain, fieldIds] of byDomain) {
    const pal = DOMAIN_PALETTES[domain] ?? FALLBACK;
    fieldIds.forEach((fid, i) => {
      // overflow past the palette: nudge lightness so repeats stay distinct
      const base = pal[i % pal.length]!;
      colors.set(fid, i < pal.length ? base : shade(base, i % 2 === 0 ? 14 : -14));
    });
  }
  return colors;
}

// ---------- small hex-colour helpers ----------
function toRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`;

/** Lighten (amount>0) or darken (amount<0) a hex colour by a percentage of the way to white/black. */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = toRgb(hex);
  const t = amount / 100;
  const target = amount >= 0 ? 255 : 0;
  return toHex(r + (target - r) * Math.abs(t), g + (target - g) * Math.abs(t), b + (target - b) * Math.abs(t));
}

/** Blend two hex colours (t=0 → a, t=1 → b). */
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = toRgb(a);
  const [r2, g2, b2] = toRgb(b);
  return toHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

export const HEAT = '#f5b642';
export const OCEAN = '#0a0f1a';
export const labelColor = 'rgba(233, 238, 252, 0.96)';

/** Deep, near-flat background so the tiles carry the colour. */
export function paintBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const g = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.max(w, h) * 0.85);
  g.addColorStop(0, '#0e1524');
  g.addColorStop(1, '#070b13');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}
