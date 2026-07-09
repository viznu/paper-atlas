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
  title: string;
  year: number | null;
  subfield: string | null;
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
  coverage: Record<string, number>;
  frontier: FrontierGap[];
}
export interface LibraryState {
  configured: boolean;
  overlay: Overlay | null;
  error: string | null;
  syncing: boolean;
}
