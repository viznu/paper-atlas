import { fetchRecommendations } from '../recs.js';
import { paperStore } from '../store.js';
import type { FeedEntry } from './types.js';

/**
 * "From your citations" as a stored feed: works your library cites most but doesn't own. Wraps the
 * co-citation recommender into the common FeedEntry shape and materialises it into feed_citations.
 */
export interface CitationsFeedResult {
  count: number;
  needsSync: boolean;
}

export async function generateCitationsFeed(): Promise<CitationsFeedResult> {
  const { hide } = paperStore().feedbackProfile();
  const { papers, needsSync } = await fetchRecommendations();
  const entries: FeedEntry[] = papers
    .filter((p) => !hide.has(p.id))
    .map((p) => ({
      id: p.id,
      title: p.title,
      authors: p.authors,
      year: p.year,
      doi: p.doi,
      url: p.doi ?? p.openAccessUrl ?? `https://openalex.org/${p.id}`,
      pdf: p.openAccessUrl,
      citedBy: p.citedBy,
      reason:
        `cited by ${p.citedByYours} of your papers` +
        (p.viaTitles[0] ? ` · e.g. “${p.viaTitles[0]}”` : ''),
    }));
  paperStore().setFeed(
    'citations',
    entries.map((e) => ({ id: e.id, data: e })),
  );
  return { count: entries.length, needsSync };
}
