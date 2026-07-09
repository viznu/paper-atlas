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
