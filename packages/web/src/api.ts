import type { Basemap, WorkSummary } from './types';

export async function fetchBasemap(): Promise<Basemap> {
  const res = await fetch('/api/basemap');
  if (!res.ok) throw new Error(`basemap: ${res.status}`);
  return res.json();
}

export async function fetchWorks(
  kind: 'subfield' | 'topic',
  id: string,
  mode: 'top' | 'recent',
): Promise<WorkSummary[]> {
  const path =
    kind === 'subfield'
      ? `/api/subfields/${id.replace('subfields/', '')}/works?mode=${mode}`
      : `/api/topics/${id}/works?mode=${mode}`;
  const res = await fetch(path);
  if (!res.ok) throw new Error(`works: ${res.status}`);
  return res.json();
}
