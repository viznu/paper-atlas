/**
 * Minimal OpenAlex client used by the explorer API: throttled, retried, and cached in memory.
 * OpenAlex is free and keyless; setting OPENALEX_MAILTO joins their faster "polite pool".
 */
const API = 'https://api.openalex.org';
const MAILTO = process.env.OPENALEX_MAILTO;

const cache = new Map<string, { at: number; data: unknown }>();
const TTL_MS = 1000 * 60 * 60 * 12;

let lastRequestAt = 0;
const MIN_SPACING_MS = 110;

export async function openalexGet(path: string): Promise<unknown> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  const url = `${API}${path}${MAILTO ? `${path.includes('?') ? '&' : '?'}mailto=${MAILTO}` : ''}`;
  for (let attempt = 0; ; attempt++) {
    const wait = lastRequestAt + MIN_SPACING_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    const res = await fetch(url);
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`OpenAlex ${res.status} for ${path}`);
    const data = await res.json();
    cache.set(path, { at: Date.now(), data });
    return data;
  }
}

const WORK_FIELDS =
  'id,doi,display_name,publication_year,cited_by_count,primary_topic,authorships,primary_location,open_access';

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

function toWorkSummary(w: any): WorkSummary {
  return {
    id: (w.id as string).replace('https://openalex.org/', ''),
    doi: w.doi ?? null,
    title: w.display_name ?? '(untitled)',
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
