import { openalexRaw, worksByIds, reconstructAbstract, stripMarkup } from './openalex.js';
import { matchedWorks } from './library.js';
import { fetchS2Contexts, normalizeDoi, normalizeTitle } from './s2.js';
import { paperStore } from './store.js';

const shortId = (url: string) => url.replace('https://openalex.org/', '');

/** arXiv works get a DataCite DOI of the form 10.48550/arXiv.<id>; extract the bare id. */
function arxivIdFromDoi(doi: string | null): string | null {
  if (!doi) return null;
  const m = doi
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .match(/^10\.48550\/arxiv\.(.+)$/i);
  return m ? (m[1] ?? null) : null;
}

const DETAIL_FIELDS =
  'id,doi,display_name,publication_year,cited_by_count,primary_topic,authorships,primary_location,open_access,abstract_inverted_index,referenced_works';
const REF_FIELDS =
  'id,doi,display_name,publication_year,cited_by_count,primary_topic,authorships,primary_location,open_access';

/** One reference of the focal paper, placed on the timeline. */
export interface PaperRef {
  id: string;
  title: string;
  year: number | null;
  authors: string[];
  venue: string | null;
  citedBy: number;
  doi: string | null;
  openAccessUrl: string | null;
  topic: string | null;
  inLibrary: boolean;
  /** Sentences where the focal paper cites this work (from Semantic Scholar; may be empty). */
  contexts: string[];
  /** background | methodology | result (S2 classification; may be empty). */
  intents: string[];
}

export interface PaperDetail {
  id: string;
  title: string;
  year: number | null;
  authors: string[];
  venue: string | null;
  citedBy: number;
  doi: string | null;
  openAccessUrl: string | null;
  topic: string | null;
  abstract: string | null;
  references: PaperRef[];
  /** Whether S2 supplied any citation contexts for this paper. */
  contextsAvailable: boolean;
}

/** Cap references we enrich, to bound OpenAlex cost on heavily-cited works. */
const MAX_REFS = 80;

/**
 * Assemble the "family tree" for one paper: its metadata + abstract, and every work it cites
 * (up to MAX_REFS), enriched from OpenAlex and annotated with Semantic Scholar citation
 * contexts, sorted oldest→newest to read as a vertical timeline.
 */
export async function fetchPaperDetail(id: string): Promise<PaperDetail> {
  const w: any = await openalexRaw(`/works/${id}?select=${DETAIL_FIELDS}`);
  const refIds: string[] = (w.referenced_works ?? []).map(shortId).slice(0, MAX_REFS);
  const refDetails = await worksByIds(refIds, REF_FIELDS);

  const owned = new Set(
    matchedWorks()
      .map((m) => m.work?.openalexId)
      .filter((x): x is string => !!x),
  );
  const s2 = await fetchS2Contexts(
    w.doi ? normalizeDoi(w.doi) : null,
    arxivIdFromDoi(w.doi),
  );

  const references: PaperRef[] = [];
  for (const rid of refIds) {
    const rw = refDetails.get(rid);
    if (!rw) continue;
    const rDoi = rw.doi ? normalizeDoi(rw.doi) : null;
    const rTitle = rw.display_name ? normalizeTitle(rw.display_name) : '';
    const ctx =
      (rDoi && s2?.byDoi[rDoi]) || (rTitle && s2?.byTitle[rTitle]) || { contexts: [], intents: [] };
    references.push({
      id: rid,
      title: rw.display_name ? stripMarkup(rw.display_name) : '(untitled)',
      year: rw.publication_year ?? null,
      authors: (rw.authorships ?? []).slice(0, 5).map((a: any) => a.author?.display_name ?? '?'),
      venue: rw.primary_location?.source?.display_name ?? null,
      citedBy: rw.cited_by_count ?? 0,
      doi: rw.doi ?? null,
      openAccessUrl: rw.open_access?.oa_url ?? null,
      topic: rw.primary_topic?.display_name ?? null,
      inLibrary: owned.has(rid),
      contexts: ctx.contexts,
      intents: ctx.intents,
    });
  }
  references.sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || b.citedBy - a.citedBy);

  const detail: PaperDetail = {
    id: shortId(w.id),
    title: w.display_name ? stripMarkup(w.display_name) : '(untitled)',
    year: w.publication_year ?? null,
    authors: (w.authorships ?? []).slice(0, 12).map((a: any) => a.author?.display_name ?? '?'),
    venue: w.primary_location?.source?.display_name ?? null,
    citedBy: w.cited_by_count ?? 0,
    doi: w.doi ?? null,
    openAccessUrl: w.open_access?.oa_url ?? null,
    topic: w.primary_topic?.display_name ?? null,
    abstract: reconstructAbstract(w.abstract_inverted_index),
    references,
    contextsAvailable: references.some((r) => r.contexts.length > 0),
  };

  // Accumulate the RAG corpus as the reader browses: one row per paper, metadata + abstract.
  paperStore().upsertMeta({
    id: detail.id,
    doi: detail.doi,
    title: detail.title,
    year: detail.year,
    authors: detail.authors,
    venue: detail.venue,
    topic: detail.topic,
    abstract: detail.abstract,
  });

  return detail;
}
