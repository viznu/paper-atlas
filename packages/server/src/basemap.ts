import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Locates the precomputed basemap. In the published package it is bundled into
 * public/basemap.json at build time; in the dev workspace it lives in
 * packages/basemap-data/data/. PAPER_ATLAS_BASEMAP overrides both.
 */
export function basemapPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.PAPER_ATLAS_BASEMAP,
    join(here, '..', 'public', 'basemap.json'), // published: dist/../public
    join(here, '..', '..', 'public', 'basemap.json'), // dev via tsx: src/../../public
    join(here, '..', '..', '..', 'basemap-data', 'data', 'basemap.json'), // workspace
    join(here, '..', '..', 'basemap-data', 'data', 'basemap.json'),
  ].filter((p): p is string => !!p);
  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error(
    'basemap.json not found. Run `npm run basemap` (see scripts/build-basemap.ts) or set PAPER_ATLAS_BASEMAP.',
  );
}

let cached: { raw: string } | null = null;
export function basemapRaw(): string {
  if (!cached) cached = { raw: readFileSync(basemapPath(), 'utf8') };
  return cached.raw;
}
