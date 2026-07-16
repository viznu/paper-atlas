import { ApiCache } from './enrich/apiCache.js';
import { atlasHome } from './enrich/cache.js';
import { join } from 'node:path';

/**
 * Semantic Scholar reference contexts. S2's references endpoint returns, for each work a paper
 * cites, the *sentences in which it is cited* (`contexts`) and a classified `intents`
 * (background / methodology / result). We use this to annotate the citation timeline with
 * "here's how the paper you're reading uses this reference" — real extracted text, not guessed.
 *
 * The public API is keyless but heavily rate-limited and sometimes down, so every call is
 * best-effort: on any failure we return null and the timeline simply renders without contexts.
 * Results are cached forever (reference contexts don't change).
 */
const S2 = 'https://api.semanticscholar.org/graph/v1';

let cache: ApiCache | null = null;
function s2Cache(): ApiCache {
  if (!cache) cache = new ApiCache(join(atlasHome(), 's2-cache.db'));
  return cache;
}

export interface RefContext {
  contexts: string[];
  intents: string[];
}
export interface S2Contexts {
  byDoi: Record<string, RefContext>;
  byTitle: Record<string, RefContext>;
}

const normDoi = (d: string) =>
  d
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:/i, '')
    .toLowerCase()
    .trim();
const normTitle = (t: string) =>
  t.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

let lastS2At = 0;
const S2_SPACING_MS = 1200;

/**
 * Fetch the citation contexts of a paper, indexed by the cited work's DOI and title so callers
 * can join them against an OpenAlex reference list. Prefers the arXiv id when available (S2
 * resolves arXiv preprints far more reliably than their DataCite DOIs). Returns null if S2
 * can't resolve the paper or the request fails/rate-limits.
 */
export async function fetchS2Contexts(
  doi: string | null,
  arxivId?: string | null,
): Promise<S2Contexts | null> {
  const s2Id = arxivId ? `ARXIV:${arxivId}` : doi ? `DOI:${normDoi(doi)}` : null;
  if (!s2Id) return null;
  const key = `s2ctx:${s2Id}`;
  const cached = s2Cache().get(key);
  if (cached !== undefined) return cached as S2Contexts | null;

  try {
    const wait = lastS2At + S2_SPACING_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastS2At = Date.now();

    const url = `${S2}/paper/${encodeURIComponent(s2Id)}/references?fields=contexts,intents,title,externalIds&limit=250`;
    const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (!res.ok) {
      // Don't cache a transient failure (429/503) — a later view can retry.
      if (res.status === 404) s2Cache().set(key, null);
      return null;
    }
    const data: any = await res.json();
    const out: S2Contexts = { byDoi: {}, byTitle: {} };
    for (const ref of data.data ?? []) {
      const contexts: string[] = (ref.contexts ?? []).slice(0, 4);
      const intents: string[] = ref.intents ?? [];
      if (contexts.length === 0 && intents.length === 0) continue;
      const rc: RefContext = { contexts, intents };
      const cited = ref.citedPaper ?? {};
      const cDoi = cited.externalIds?.DOI;
      if (cDoi) out.byDoi[normDoi(cDoi)] = rc;
      if (cited.title) out.byTitle[normTitle(cited.title)] = rc;
    }
    // Only cache a hit. An empty result is usually S2 throttling (it returns data:[] under
    // load), not a real "no contexts" — caching it would permanently suppress contexts that a
    // later, un-throttled view would find. Re-fetch next time instead.
    if (Object.keys(out.byDoi).length > 0 || Object.keys(out.byTitle).length > 0) {
      s2Cache().set(key, out);
    }
    return out;
  } catch {
    return null;
  }
}

export { normDoi as normalizeDoi, normTitle as normalizeTitle };
