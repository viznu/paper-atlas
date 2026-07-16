import { matchedWorks } from './library.js';
import { worksByIds, stripMarkup } from './openalex.js';

/**
 * A recommended next read: a work your library *cites* but does not *own*. The more of your
 * own papers cite it, the stronger the signal that it's foundational to what you read.
 */
export interface RecPaper {
  id: string; // "W..."
  title: string;
  year: number | null;
  authors: string[];
  venue: string | null;
  citedBy: number;
  doi: string | null;
  openAccessUrl: string | null;
  topic: string | null;
  /** How many distinct library papers reference this work. */
  citedByYours: number;
  /** A few of your paper titles that cite it — the "why you're seeing this". */
  viaTitles: string[];
}

const REC_FIELDS =
  'id,doi,display_name,publication_year,cited_by_count,primary_topic,authorships,primary_location,open_access';

/**
 * Rank external works by how many of your library papers cite them (co-citation frequency),
 * excluding works you already own. Deduplicates by OpenAlex id so a paper stored twice in
 * Zotero counts once. Threshold ≥2 keeps this to genuinely shared foundations.
 */
function rankCandidates(): { id: string; count: number; viaTitles: string[] }[] {
  const matched = matchedWorks();
  const owned = new Set<string>();
  const seenWork = new Set<string>();
  for (const m of matched) if (m.work) owned.add(m.work.openalexId);

  const count = new Map<string, number>();
  const via = new Map<string, string[]>();
  for (const m of matched) {
    const w = m.work;
    if (!w || seenWork.has(w.openalexId)) continue;
    seenWork.add(w.openalexId);
    for (const ref of w.referencedWorks) {
      if (owned.has(ref)) continue;
      count.set(ref, (count.get(ref) ?? 0) + 1);
      const arr = via.get(ref) ?? [];
      if (arr.length < 3) arr.push(w.title);
      via.set(ref, arr);
    }
  }
  return [...count.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([id, c]) => ({ id, count: c, viaTitles: via.get(id) ?? [] }));
}

export interface RecommendationsResult {
  papers: RecPaper[];
  /** True when the library hasn't been synced yet (no matched works in memory). */
  needsSync: boolean;
}

/**
 * The Reading Desk feed: top co-cited works, enriched with OpenAlex metadata (batched, cached)
 * and finally ordered by co-citation count, breaking ties by the work's own citation impact.
 */
export async function fetchRecommendations(limit = 40): Promise<RecommendationsResult> {
  if (matchedWorks().length === 0) return { papers: [], needsSync: true };
  const ranked = rankCandidates().slice(0, limit);
  if (ranked.length === 0) return { papers: [], needsSync: false };

  const details = await worksByIds(
    ranked.map((r) => r.id),
    REC_FIELDS,
  );
  const papers: RecPaper[] = [];
  for (const r of ranked) {
    const w = details.get(r.id);
    if (!w || !w.display_name) continue; // skip works OpenAlex has no title for
    papers.push({
      id: r.id,
      title: w.display_name ? stripMarkup(w.display_name) : '(untitled)',
      year: w.publication_year ?? null,
      authors: (w.authorships ?? []).slice(0, 6).map((a: any) => a.author?.display_name ?? '?'),
      venue: w.primary_location?.source?.display_name ?? null,
      citedBy: w.cited_by_count ?? 0,
      doi: w.doi ?? null,
      openAccessUrl: w.open_access?.oa_url ?? null,
      topic: w.primary_topic?.display_name ?? null,
      citedByYours: r.count,
      viaTitles: r.viaTitles,
    });
  }
  papers.sort((a, b) => b.citedByYours - a.citedByYours || b.citedBy - a.citedBy);
  return { papers, needsSync: false };
}
