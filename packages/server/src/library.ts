import { ingest, findZoteroDataDir } from './ingest/index.js';
import { matchLibrary, type MatchedItem } from './enrich/matcher.js';
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

/**
 * The last successful match result, kept in memory so the Reading Desk (recommendations,
 * paper detail) can read each library work's `referencedWorks` without re-ingesting. Empty
 * until the first sync runs.
 */
let lastMatched: MatchedItem[] = [];

export function libraryState(): LibraryState {
  return state;
}

/** Matched library works (only those resolved to an OpenAlex work), for citation-based recs. */
export function matchedWorks(): MatchedItem[] {
  return lastMatched.filter((m) => m.work);
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
    lastMatched = matched;
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
