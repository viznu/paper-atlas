/**
 * Minimal OpenAlex client used by the explorer API: throttled, retried, and cached to disk so
 * repeat views cost no budget. OpenAlex is keyless; setting OPENALEX_MAILTO joins their faster
 * "polite pool". OpenAlex enforces a daily spend budget: when it is exhausted, requests are
 * refused with a 429 whose body carries a `retryAfter`. That case throws RateLimitError so the
 * server can degrade gracefully rather than surface a 500.
 */
import { ApiCache, RateLimitError } from './enrich/apiCache.js';

const API = 'https://api.openalex.org';
const MAILTO = process.env.OPENALEX_MAILTO;

const mem = new Map<string, unknown>();
let disk: ApiCache | null = null;
function diskCache(): ApiCache {
  if (!disk) disk = new ApiCache();
  return disk;
}

let lastRequestAt = 0;
const MIN_SPACING_MS = 150;

/** A budget refusal carries a JSON body with retryAfter + a remaining-budget field. */
function isBudgetRefusal(body: unknown): { retryAfter: number | null } | null {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    if (
      typeof b.error === 'string' &&
      (/budget|rate limit|insufficient/i.test(b.error) || 'dailyRemainingUsd' in b)
    ) {
      return { retryAfter: typeof b.retryAfter === 'number' ? b.retryAfter : null };
    }
  }
  return null;
}

export async function openalexGet(path: string): Promise<unknown> {
  if (mem.has(path)) return mem.get(path);
  const cached = diskCache().get(path);
  if (cached !== undefined) {
    mem.set(path, cached);
    return cached;
  }

  const url = `${API}${path}${MAILTO ? `${path.includes('?') ? '&' : '?'}mailto=${MAILTO}` : ''}`;
  for (let attempt = 0; ; attempt++) {
    const wait = lastRequestAt + MIN_SPACING_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    const res = await fetch(url);
    if (!res.ok) {
      // Parse the body to tell a transient 429 (retry) from a budget refusal (give up cleanly).
      const body = await res.json().catch(() => null);
      const refusal = isBudgetRefusal(body);
      if (refusal) throw new RateLimitError(refusal.retryAfter);
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      throw new Error(`OpenAlex ${res.status} for ${path}`);
    }
    const data = await res.json();
    mem.set(path, data);
    diskCache().set(path, data);
    return data;
  }
}

export { RateLimitError } from './enrich/apiCache.js';

export { openalexGet as openalexRaw };

const WORK_FIELDS =
  'id,doi,display_name,publication_year,cited_by_count,primary_topic,authorships,primary_location,open_access';

/** Fields needed to place an item on the atlas and seed the citation graph. */
export const ENRICH_FIELDS =
  'id,doi,display_name,publication_year,cited_by_count,primary_topic,topics,authorships,primary_location,open_access,referenced_works';

export interface WorkSummary {
  id: string;
  doi: string | null;
  title: string;
  year: number | null;
  citedBy: number;
  authors: string[];
  venue: string | null;
  openAccessUrl: string | null;
  topic: string | null;
}

const stripMarkup = (s: string) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();

function toWorkSummary(w: any): WorkSummary {
  return {
    id: (w.id as string).replace('https://openalex.org/', ''),
    doi: w.doi ?? null,
    title: w.display_name ? stripMarkup(w.display_name) : '(untitled)',
    year: w.publication_year ?? null,
    citedBy: w.cited_by_count ?? 0,
    authors: (w.authorships ?? []).slice(0, 6).map((a: any) => a.author?.display_name ?? '?'),
    venue: w.primary_location?.source?.display_name ?? null,
    openAccessUrl: w.open_access?.oa_url ?? null,
    topic: w.primary_topic?.display_name ?? null,
  };
}

/** Top or recent works for a subfield ("subfields/1702") or topic ("T10883"). */
export async function worksFor(
  unit: { kind: 'subfield' | 'topic'; id: string },
  mode: 'top' | 'recent',
  count = 12,
): Promise<WorkSummary[]> {
  const filterKey = unit.kind === 'subfield' ? 'primary_topic.subfield.id' : 'primary_topic.id';
  const recency = mode === 'recent' ? `,from_publication_date:${new Date().getFullYear() - 2}-01-01` : '';
  const data: any = await openalexGet(
    `/works?filter=${filterKey}:${unit.id}${recency}&sort=cited_by_count:desc&per_page=${count}&select=${WORK_FIELDS}`,
  );
  return (data.results ?? []).map(toWorkSummary);
}
