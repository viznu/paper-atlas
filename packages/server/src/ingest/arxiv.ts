/** Detects a bare arXiv id from any of the messy places Zotero stores it. */
const NEW_ID = /(\d{4}\.\d{4,5})(v\d+)?/; // 2310.01405, 2310.01405v4
const OLD_ID = /([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/i; // hep-th/9901001

export function extractArxivId(sources: {
  doi?: string | null;
  url?: string | null;
  extra?: string | null;
  attachmentPaths?: string[];
}): string | null {
  // 1. DataCite arXiv DOI: 10.48550/arXiv.2310.01405
  const doiMatch = sources.doi?.match(/arxiv[.:]?\s*(\S+)/i);
  if (doiMatch?.[1]) {
    const m = doiMatch[1].match(NEW_ID) ?? doiMatch[1].match(OLD_ID);
    if (m?.[1]) return m[1];
  }
  // 2. "extra" field often has "arXiv: 2310.01405" or a tex.arxivnumber
  if (sources.extra) {
    const m = sources.extra.match(/arxiv[:\s]+([^\s,;]+)/i);
    if (m?.[1]) {
      const id = m[1].match(NEW_ID) ?? m[1].match(OLD_ID);
      if (id?.[1]) return id[1];
    }
  }
  // 3. URL: arxiv.org/abs/2310.01405 or /pdf/2310.01405v4
  if (sources.url && /arxiv\.org/i.test(sources.url)) {
    const m = sources.url.match(NEW_ID) ?? sources.url.match(OLD_ID);
    if (m?.[1]) return m[1];
  }
  // 4. Attachment filename: 2310.01405v4.pdf
  for (const p of sources.attachmentPaths ?? []) {
    const base = p.split('/').pop() ?? p;
    const m = base.match(/^(\d{4}\.\d{4,5})(v\d+)?\.pdf$/i);
    if (m?.[1]) return m[1];
  }
  return null;
}

/** Turns a bare arXiv id into its registered DataCite DOI, for OpenAlex lookup. */
export const arxivDoi = (id: string) => `10.48550/arxiv.${id.toLowerCase()}`;
