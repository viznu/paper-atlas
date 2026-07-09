import { extractArxivId } from './arxiv.js';
import type { IngestResult, PaperItem } from './types.js';

const LOCAL_API = 'http://localhost:23119/api';

/** True if Zotero is running with its local HTTP API enabled (Settings → Advanced). */
export async function localApiAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${LOCAL_API}/users/0/items?limit=1`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Reads the library via Zotero's local HTTP API. Requires Zotero to be running with the local
 * API enabled. The direct-sqlite connector is preferred (works with Zotero closed); this is a
 * fallback for users who keep Zotero open and have not granted file access.
 */
export async function ingestZoteroLocalApi(): Promise<IngestResult> {
  const items: PaperItem[] = [];
  const start = 0;
  const limit = 100;
  for (let offset = start; ; offset += limit) {
    const res = await fetch(
      `${LOCAL_API}/users/0/items/top?limit=${limit}&start=${offset}&include=data`,
    );
    if (!res.ok) throw new Error(`Zotero local API ${res.status}`);
    const page = (await res.json()) as { data: Record<string, unknown> }[];
    if (page.length === 0) break;
    for (const entry of page) {
      const d = entry.data as Record<string, any>;
      if (['attachment', 'note', 'annotation'].includes(d.itemType)) continue;
      const doi = d.DOI ?? null;
      const url = d.url ?? null;
      const yearMatch = String(d.date ?? '').match(/\d{4}/);
      items.push({
        key: d.key,
        zoteroKey: d.key,
        title: d.title ?? d.caseName ?? '(untitled)',
        creators: (d.creators ?? [])
          .map((c: any) => [c.lastName, c.firstName].filter(Boolean).join(', '))
          .filter(Boolean),
        year: yearMatch ? Number(yearMatch[0]) : null,
        doi,
        arxivId: extractArxivId({ doi, url, extra: d.extra ?? null }),
        url,
        itemType: d.itemType,
        venue: d.publicationTitle ?? d.proceedingsTitle ?? d.conferenceName ?? d.bookTitle ?? null,
        collections: [], // collection membership needs extra calls; sqlite path covers this
        tags: (d.tags ?? []).map((t: any) => t.tag).filter(Boolean),
      });
    }
    if (page.length < limit) break;
  }
  return { source: 'zotero-local-api', library: 'My Library', items };
}
