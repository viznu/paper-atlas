/** A reference-manager item, normalized across ingest sources (Zotero sqlite / API / PDFs). */
export interface PaperItem {
  /** Stable local id (Zotero item key, or a hash for other sources). */
  key: string;
  title: string;
  creators: string[]; // "Lastname, First" as stored
  year: number | null;
  doi: string | null;
  /** Bare arXiv id like "2310.01405" (version stripped), if detected. */
  arxivId: string | null;
  url: string | null;
  itemType: string; // journalArticle, conferencePaper, preprint, …
  venue: string | null;
  collections: string[];
  tags: string[];
  /** Zotero item key for building `zotero://select` deep links, when available. */
  zoteroKey: string | null;
}

export interface IngestResult {
  source: 'zotero-sqlite' | 'zotero-local-api' | 'zotero-web-api' | 'pdf-folder';
  library: string; // human label, e.g. path or "My Library"
  items: PaperItem[];
}
