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

export const territoryFill = (hue: number, hover: boolean, dim: boolean) =>
  `hsl(${hue} ${dim ? 20 : 45}% ${hover ? 24 : dim ? 10 : 15}%)`;
export const territoryStroke = (hue: number) => `hsl(${hue} 40% 28%)`;
export const territoryGlow = (hue: number) => `hsl(${hue} 80% 55%)`;
export const labelColor = 'rgba(226, 232, 240, 0.92)';
export const WATER = '#070b14';
