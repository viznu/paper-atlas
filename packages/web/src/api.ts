import type { ArxivPaper, Basemap, LibraryState, WorkSummary } from './types';

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
