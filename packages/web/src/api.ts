import type {
  ArxivPaper,
  Basemap,
  FeedResponse,
  FeedTab,
  LibraryState,
  PaperDetail,
  PaperSummary,
  RecommendationsResponse,
  WorkSummary,
} from './types';

export async function fetchArxiv(query: string): Promise<ArxivPaper[]> {
  const res = await fetch(`/api/arxiv?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`arxiv: ${res.status}`);
  const data = (await res.json()) as { papers: ArxivPaper[] };
  return data.papers ?? [];
}

export async function fetchLibrary(): Promise<LibraryState> {
  const res = await fetch('/api/library');
  if (!res.ok) throw new Error(`library: ${res.status}`);
  return res.json();
}

export async function syncLibrary(): Promise<LibraryState> {
  const res = await fetch('/api/library/sync', { method: 'POST' });
  if (!res.ok) throw new Error(`sync: ${res.status}`);
  return res.json();
}

export async function fetchBasemap(): Promise<Basemap> {
  const res = await fetch('/api/basemap');
  if (!res.ok) throw new Error(`basemap: ${res.status}`);
  return res.json();
}

export interface WorksResponse {
  works: WorkSummary[];
  rateLimited: boolean;
  retryAfterSeconds?: number | null;
}

export async function fetchWorks(
  kind: 'subfield' | 'topic',
  id: string,
  mode: 'top' | 'recent',
): Promise<WorksResponse> {
  const path =
    kind === 'subfield'
      ? `/api/subfields/${id.replace('subfields/', '')}/works?mode=${mode}`
      : `/api/topics/${id}/works?mode=${mode}`;
  const res = await fetch(path);
  if (!res.ok) throw new Error(`works: ${res.status}`);
  return res.json();
}

// ---- Reading Desk ----
export async function fetchConfig(): Promise<{ summaries: boolean }> {
  const res = await fetch('/api/config');
  if (!res.ok) throw new Error(`config: ${res.status}`);
  return res.json();
}

export async function fetchRecommendations(): Promise<RecommendationsResponse> {
  const res = await fetch('/api/recommendations');
  if (!res.ok) throw new Error(`recommendations: ${res.status}`);
  return res.json();
}

export async function fetchPaper(
  id: string,
): Promise<{ paper: PaperDetail | null; rateLimited?: boolean; error?: string }> {
  const res = await fetch(`/api/paper/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`paper: ${res.status}`);
  return res.json();
}

export async function fetchPaperSummary(id: string): Promise<PaperSummary> {
  const res = await fetch(`/api/paper/${encodeURIComponent(id)}/summary`);
  if (!res.ok) throw new Error(`summary: ${res.status}`);
  return res.json();
}

export async function fetchFeedTab(tab: FeedTab, date?: string): Promise<FeedResponse> {
  const res = await fetch(`/api/feed/${tab}${date ? `?date=${encodeURIComponent(date)}` : ''}`);
  if (!res.ok) throw new Error(`feed: ${res.status}`);
  return res.json();
}

export async function markRead(id: string, read: boolean): Promise<void> {
  await fetch('/api/read', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, read }),
  });
}

export async function generateFeedTab(tab: FeedTab): Promise<FeedResponse> {
  const res = await fetch(`/api/feed/${tab}/generate`, { method: 'POST' });
  if (!res.ok) throw new Error(`feed generate: ${res.status}`);
  return res.json();
}

export async function sendFeedback(
  id: string,
  tab: FeedTab,
  signal: 'more' | 'less' | 'clear',
  title?: string,
): Promise<void> {
  await fetch('/api/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, tab, signal, title }),
  });
}

/** Resolve an arXiv id to an OpenAlex work id (null if not yet indexed). */
export async function resolveArxiv(id: string): Promise<string | null> {
  const res = await fetch(`/api/paper/by-arxiv/${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { id: string | null };
  return data.id;
}
