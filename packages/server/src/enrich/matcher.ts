import { openalexRaw, ENRICH_FIELDS } from '../openalex.js';
import { arxivDoi } from '../ingest/arxiv.js';
import type { PaperItem } from '../ingest/types.js';
import { EnrichCache } from './cache.js';

/** The subset of an OpenAlex work paper-atlas keeps per matched library item. */
export interface WorkRecord {
  openalexId: string; // "W2194775991"
  doi: string | null;
  title: string;
  year: number | null;
  citedBy: number;
  subfield: { id: string; name: string } | null; // "subfields/1702"
  topic: { id: string; name: string } | null;
  authors: string[];
  venue: string | null;
  openAccessUrl: string | null;
  referencedWorks: string[]; // ["W...", ...] — for the citation graph + gap detection
}

export interface MatchedItem {
  item: PaperItem;
  method: 'doi' | 'arxiv' | 'title' | 'none';
  confidence: number;
  work: WorkRecord | null;
}

const shortId = (url: string) => url.replace('https://openalex.org/', '');
const normalizeDoi = (doi: string) =>
  doi
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:/i, '')
    .toLowerCase()
    .trim();

function toRecord(w: any): WorkRecord {
  return {
    openalexId: shortId(w.id),
    doi: w.doi ? normalizeDoi(w.doi) : null,
    title: w.display_name ?? '(untitled)',
    year: w.publication_year ?? null,
    citedBy: w.cited_by_count ?? 0,
    subfield: w.primary_topic?.subfield
      ? { id: shortId(w.primary_topic.subfield.id), name: w.primary_topic.subfield.display_name }
      : null,
    topic: w.primary_topic
      ? { id: shortId(w.primary_topic.id), name: w.primary_topic.display_name }
      : null,
    authors: (w.authorships ?? []).slice(0, 8).map((a: any) => a.author?.display_name ?? '?'),
    venue: w.primary_location?.source?.display_name ?? null,
    openAccessUrl: w.open_access?.oa_url ?? null,
    referencedWorks: (w.referenced_works ?? []).map(shortId),
  };
}

// ---------- title similarity ----------
const normTitle = (t: string) =>
  t
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function titleSimilarity(a: string, b: string): number {
  const ta = new Set(normTitle(a).split(' ').filter((w) => w.length > 2));
  const tb = new Set(normTitle(b).split(' ').filter((w) => w.length > 2));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  return inter / (ta.size + tb.size - inter); // Jaccard
}

/** Look up a batch of DOIs (<=50) and return works keyed by normalized DOI. */
async function batchByDoi(dois: string[]): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  for (let i = 0; i < dois.length; i += 50) {
    const batch = dois.slice(i, i + 50);
    const data: any = await openalexRaw(
      `/works?filter=doi:${batch.map(encodeURIComponent).join('|')}&per_page=50&select=${ENRICH_FIELDS}`,
    );
    for (const w of data.results ?? []) if (w.doi) out.set(normalizeDoi(w.doi), w);
  }
  return out;
}

/** Best title-search match for one item, or null. */
async function matchByTitle(item: PaperItem): Promise<{ work: any; score: number } | null> {
  const q = normTitle(item.title).slice(0, 220);
  if (q.length < 6) return null;
  const data: any = await openalexRaw(
    `/works?filter=title.search:${encodeURIComponent(q)}&per_page=5&select=${ENRICH_FIELDS}`,
  );
  let best: { work: any; score: number } | null = null;
  for (const w of data.results ?? []) {
    let score = titleSimilarity(item.title, w.display_name ?? '');
    if (item.year && w.publication_year) {
      const diff = Math.abs(item.year - w.publication_year);
      if (diff > 2) score -= 0.3;
      else if (diff === 0) score += 0.05;
    }
    if (!best || score > best.score) best = { work: w, score };
  }
  return best;
}

export interface MatchProgress {
  (done: number, total: number, method: string): void;
}

/**
 * Matches every library item to an OpenAlex work and enriches it. Strategy per item:
 *   1. DOI (batched, exact) — highest confidence.
 *   2. arXiv id -> DataCite DOI (batched) for items without a direct DOI.
 *   3. Title search (per item) with a Jaccard + year gate — the fallback that carries
 *      title-heavy libraries.
 * Results are cached by item key so re-syncs only touch new/changed items.
 */
export async function matchLibrary(
  items: PaperItem[],
  opts: { cache?: EnrichCache; onProgress?: MatchProgress; refresh?: boolean } = {},
): Promise<MatchedItem[]> {
  const cache = opts.cache ?? new EnrichCache();
  const results = new Map<string, MatchedItem>();
  let done = 0;
  const total = items.length;
  const tick = (method: string) => opts.onProgress?.(++done, total, method);

  // Cached first.
  const pending: PaperItem[] = [];
  for (const item of items) {
    const cached = opts.refresh ? null : cache.get(item.key);
    if (cached) {
      results.set(item.key, {
        item,
        method: cached.matchMethod as MatchedItem['method'],
        confidence: cached.confidence,
        work: (cached.work as WorkRecord) ?? null,
      });
      tick('cache');
    } else {
      pending.push(item);
    }
  }

  // Tier 1 + 2: gather DOIs (direct + arXiv-derived) and batch them.
  const doiToItems = new Map<string, PaperItem[]>();
  const methodForDoi = new Map<string, 'doi' | 'arxiv'>();
  for (const item of pending) {
    let doi = item.doi ? normalizeDoi(item.doi) : null;
    let method: 'doi' | 'arxiv' = 'doi';
    if (!doi && item.arxivId) {
      doi = arxivDoi(item.arxivId);
      method = 'arxiv';
    }
    if (doi) {
      doiToItems.set(doi, [...(doiToItems.get(doi) ?? []), item]);
      methodForDoi.set(doi, method);
    }
  }
  const byDoi = await batchByDoi([...doiToItems.keys()]);

  const stillPending: PaperItem[] = [];
  for (const item of pending) {
    const doi = item.doi ? normalizeDoi(item.doi) : item.arxivId ? arxivDoi(item.arxivId) : null;
    const w = doi ? byDoi.get(doi) : undefined;
    if (w) {
      const method = methodForDoi.get(doi!) ?? 'doi';
      const rec = toRecord(w);
      cache.set(item.key, method, 1, rec);
      results.set(item.key, { item, method, confidence: 1, work: rec });
      tick(method);
    } else {
      stillPending.push(item);
    }
  }

  // Tier 3: title search, one request each (throttled inside openalexRaw).
  for (const item of stillPending) {
    let matched: MatchedItem = { item, method: 'none', confidence: 0, work: null };
    try {
      const best = await matchByTitle(item);
      if (best && best.score >= 0.6) {
        const rec = toRecord(best.work);
        matched = { item, method: 'title', confidence: Math.min(1, best.score), work: rec };
      }
    } catch {
      // leave unmatched; a later sync can retry
    }
    cache.set(item.key, matched.method, matched.confidence, matched.work);
    results.set(item.key, matched);
    tick(matched.method);
  }

  return items.map((i) => results.get(i.key)!);
}
