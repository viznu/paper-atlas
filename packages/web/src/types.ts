export interface BasemapDomain {
  id: string;
  name: string;
}
export interface BasemapField {
  id: string;
  name: string;
  domain: string;
}
export interface BasemapSubfield {
  id: string; // "subfields/1702"
  name: string;
  field: string;
  domain: string;
  x: number;
  y: number;
  worksCount: number;
  wikipedia: string | null;
  neighbors: { id: string; w: number }[];
}
export interface BasemapTopic {
  id: string; // "T10883"
  name: string;
  subfield: string;
  worksCount: number;
  x: number;
  y: number;
  keywords: string[];
  summary: string;
  wikipedia: string | null;
}
export interface Basemap {
  version: number;
  generatedAt: string;
  domains: BasemapDomain[];
  fields: BasemapField[];
  subfields: BasemapSubfield[];
  topics: BasemapTopic[];
}

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

export type Selection =
  | { kind: 'subfield'; id: string }
  | { kind: 'topic'; id: string }
  | null;

/** A level in the drill-down: a field (facet), a subfield (territory), or a topic. */
export type Focus =
  | { kind: 'field'; id: string }
  | { kind: 'subfield'; id: string }
  | { kind: 'topic'; id: string };

export interface LibraryEntry {
  key: string;
  zoteroKey: string | null;
  title: string;
  year: number | null;
  authors: string[];
  subfield: string | null;
  topic: string | null;
  confidence: number;
}
export interface FrontierGap {
  id: string;
  name: string;
  field: string;
  score: number;
  coverage: number;
  viaSubfields: string[];
}
export interface Overlay {
  stats: { total: number; matched: number; placed: number };
  itemsBySubfield: Record<string, LibraryEntry[]>;
  itemsByTopic: Record<string, LibraryEntry[]>;
  coverage: Record<string, number>;
  coverageByTopic: Record<string, number>;
  frontier: FrontierGap[];
}
export interface LibraryState {
  configured: boolean;
  overlay: Overlay | null;
  error: string | null;
  syncing: boolean;
}

export interface ArxivPaper {
  id: string;
  title: string;
  authors: string[];
  published: string;
  summary: string;
  url: string;
  pdf: string;
}

// ---- Reading Desk ----
export interface RecPaper {
  id: string;
  title: string;
  year: number | null;
  authors: string[];
  venue: string | null;
  citedBy: number;
  doi: string | null;
  openAccessUrl: string | null;
  topic: string | null;
  citedByYours: number;
  viaTitles: string[];
}
export interface RecommendationsResponse {
  papers: RecPaper[];
  needsSync: boolean;
  rateLimited: boolean;
}
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
  contexts: string[];
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
  contextsAvailable: boolean;
}
export interface SummaryCards {
  problem: string;
  achieved: string;
  showed: string;
  limitations: string;
  future: string;
}
export interface PaperSummary {
  enabled: boolean;
  model?: string;
  noAbstract?: boolean;
  mock?: boolean;
  cards?: SummaryCards;
  error?: string;
}

export type FeedTab = 'fresh' | 'claude' | 'citations' | 'phd';

export interface FeedEntry {
  id: string; // "W..." or "arxiv:<id>"
  arxivId?: string | null;
  title: string;
  authors: string[];
  year?: number | null;
  published?: string | null;
  summary?: string | null;
  url?: string | null;
  pdf?: string | null;
  doi?: string | null;
  citedBy?: number | null;
  categories?: string[];
  matched?: string[];
  inLibraryTopic?: boolean;
  reason?: string | null;
  faculty?: string | null;
  institution?: string | null;
}
export interface FeedResponse {
  date: string | null;
  dates: string[];
  generatedAt: number | null;
  items: FeedEntry[];
  feedback: { paperId: string; feed: string; signal: string }[];
  read: string[];
  rateLimited?: boolean;
}
