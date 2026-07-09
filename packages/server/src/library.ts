import { ingest, findZoteroDataDir } from './ingest/index.js';
import { matchLibrary } from './enrich/matcher.js';
import { EnrichCache } from './enrich/cache.js';
import { computeOverlay, type Overlay } from './atlas/overlay.js';
import { basemapRaw } from './basemap.js';

interface LibraryState {
  configured: boolean;
  overlay: Overlay | null;
  error: string | null;
  syncing: boolean;
}

let state: LibraryState = {
  configured: !!findZoteroDataDir(),
  overlay: null,
  error: null,
  syncing: false,
};

export function libraryState(): LibraryState {
  return state;
}

/**
 * Ingests the library and matches it to OpenAlex (cache-first, so an already-synced library
 * needs no API calls), then projects it onto the base map. Safe to call when no library is
 * configured — it just reports `configured:false` and the explorer runs without an overlay.
 */
export async function syncLibrary(opts: { refresh?: boolean } = {}): Promise<LibraryState> {
  if (!findZoteroDataDir()) {
    state = { configured: false, overlay: null, error: null, syncing: false };
    return state;
  }
  state = { ...state, syncing: true, error: null };
  const cache = new EnrichCache();
  try {
    const { items } = await ingest();
    const matched = await matchLibrary(items, { cache, refresh: opts.refresh });
    const basemap = JSON.parse(basemapRaw());
    state = {
      configured: true,
      overlay: computeOverlay(matched, basemap),
      error: null,
      syncing: false,
    };
  } catch (err) {
    state = { ...state, syncing: false, error: String(err) };
  } finally {
    cache.close();
  }
  return state;
}
