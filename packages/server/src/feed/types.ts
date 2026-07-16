/**
 * A single feed entry — the common shape rendered by every tab (Fresh, Recommended by Claude,
 * From your citations, PhD faculty). Fields are optional so each source fills what it has; the
 * UI shows whatever is present.
 */
export interface FeedEntry {
  id: string; // OpenAlex "W..." id, or "arxiv:<id>" for arXiv-only papers
  arxivId?: string | null;
  title: string;
  authors: string[];
  year?: number | null;
  published?: string | null; // ISO date (arXiv)
  summary?: string | null; // abstract or short blurb (tweet body)
  url?: string | null; // external link
  pdf?: string | null;
  doi?: string | null;
  citedBy?: number | null;
  categories?: string[];
  matched?: string[]; // interest-group tags
  inLibraryTopic?: boolean;
  reason?: string | null; // "why you're seeing this" (Claude rationale / citation / faculty)
  faculty?: string | null; // PhD tab: the professor
  institution?: string | null; // PhD tab: their university
  score?: number;
}
