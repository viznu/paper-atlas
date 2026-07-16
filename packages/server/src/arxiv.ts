import { ApiCache } from './enrich/apiCache.js';

/**
 * Minimal arXiv client for the "Fresh on arXiv" feed. arXiv's API is free and independent of
 * OpenAlex, so this keeps working even when the OpenAlex daily budget is exhausted. Responses
 * are disk-cached for a few hours so the "latest" feed is fresh without hammering arXiv.
 */
const API = 'https://export.arxiv.org/api/query';
const TTL_MS = 1000 * 60 * 60 * 3;

let cache: ApiCache | null = null;
function diskCache(): ApiCache {
  if (!cache) cache = new ApiCache();
  return cache;
}

let lastRequestAt = 0;
const MIN_SPACING_MS = 3200; // arXiv asks for ~1 request / 3s

export interface ArxivPaper {
  id: string; // arXiv id, e.g. 2401.01234
  title: string;
  authors: string[];
  published: string; // ISO date
  summary: string;
  url: string; // abstract page
  pdf: string; // pdf link
  categories: string[]; // e.g. ["cs.LG", "stat.ML"]
}

const strip = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();

function parseAtom(xml: string): ArxivPaper[] {
  const out: ArxivPaper[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1]!;
    const pick = (tag: string) => {
      const r = e.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return r ? strip(r[1]!) : '';
    };
    const idUrl = pick('id'); // http://arxiv.org/abs/2401.01234v1
    const id = idUrl.replace(/^https?:\/\/arxiv\.org\/abs\//, '').replace(/v\d+$/, '');
    const authors = [...e.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((a) => strip(a[1]!)).slice(0, 6);
    const pdf = (e.match(/<link[^>]*title="pdf"[^>]*href="([^"]+)"/) ?? [])[1] ?? `https://arxiv.org/pdf/${id}`;
    const categories = [...e.matchAll(/<category[^>]*term="([^"]+)"/g)].map((c) => c[1]!);
    out.push({
      id,
      title: pick('title'),
      authors,
      published: pick('published'),
      summary: pick('summary'),
      url: idUrl.replace(/v\d+$/, ''),
      pdf,
      categories: [...new Set(categories)],
    });
  }
  return out;
}

/** Recent arXiv preprints matching a free-text query (subfield/topic name), newest first. */
export async function arxivLatest(query: string, max = 10): Promise<ArxivPaper[]> {
  const q = query.trim();
  if (!q) return [];
  const search = `all:${JSON.stringify(q)}`; // quoted phrase
  const url = `${API}?search_query=${encodeURIComponent(search)}&sortBy=submittedDate&sortOrder=descending&max_results=${max}`;
  const key = `arxiv:${url}`;
  const hit = diskCache().get(key, TTL_MS);
  if (hit !== undefined) return hit as ArxivPaper[];

  const wait = lastRequestAt + MIN_SPACING_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();

  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`arXiv ${res.status}`);
  const papers = parseAtom(await res.text());
  diskCache().set(key, papers);
  return papers;
}

/**
 * Run a raw arXiv `search_query` (e.g. `cat:cs.LG` or `abs:"information theory"`), newest first.
 * Used by the daily-feed generator to gather fresh candidates by category and by interest term.
 * Cached briefly so a same-day regeneration doesn't re-hit arXiv.
 */
export async function arxivQuery(searchQuery: string, max = 40): Promise<ArxivPaper[]> {
  const q = searchQuery.trim();
  if (!q) return [];
  const url = `${API}?search_query=${encodeURIComponent(q)}&sortBy=submittedDate&sortOrder=descending&max_results=${max}`;
  const key = `arxivq:${url}`;
  const hit = diskCache().get(key, TTL_MS);
  if (hit !== undefined) return hit as ArxivPaper[];

  const wait = lastRequestAt + MIN_SPACING_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();

  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`arXiv ${res.status}`);
  const papers = parseAtom(await res.text());
  diskCache().set(key, papers);
  return papers;
}
