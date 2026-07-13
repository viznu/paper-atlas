import type { Basemap, Focus } from './types';

/**
 * Expands any focus into a full drill-down stack so the breadcrumb is always complete:
 * a topic yields [field, subfield, topic], a subfield yields [field, subfield], etc.
 */
export function stackFor(focus: Focus, basemap: Basemap): Focus[] {
  if (focus.kind === 'field') return [focus];
  if (focus.kind === 'subfield') {
    const sf = basemap.subfields.find((s) => s.id === focus.id);
    return sf ? [{ kind: 'field', id: sf.field }, focus] : [focus];
  }
  const t = basemap.topics.find((x) => x.id === focus.id);
  const sf = t && basemap.subfields.find((s) => s.id === t.subfield);
  const stack: Focus[] = [];
  if (sf) stack.push({ kind: 'field', id: sf.field });
  if (t) stack.push({ kind: 'subfield', id: t.subfield });
  stack.push(focus);
  return stack;
}

export function focusLabel(focus: Focus, basemap: Basemap): string {
  if (focus.kind === 'field') return basemap.fields.find((f) => f.id === focus.id)?.name ?? focus.id;
  if (focus.kind === 'subfield')
    return basemap.subfields.find((s) => s.id === focus.id)?.name ?? focus.id;
  return basemap.topics.find((t) => t.id === focus.id)?.name ?? focus.id;
}

export interface LocalGap {
  id: string;
  name: string;
  field: string;
  weight: number;
  via: string[];
}

const fieldNameOf = (basemap: Basemap, subfieldId: string) => {
  const s = basemap.subfields.find((x) => x.id === subfieldId);
  return s ? (basemap.fields.find((f) => f.id === s.field)?.name ?? '') : '';
};

export interface TopicGap {
  id: string;
  name: string;
  works: number;
}

/**
 * A subfield's topics, sorted by size, with dominant outliers removed. OpenAlex occasionally
 * mis-files a huge catch-all topic under the wrong subfield (e.g. a 3.9M-work "Geochemistry"
 * topic tagged Artificial Intelligence); such a topic dwarfs every real one, so we drop any
 * leading topic that is more than 3× the next largest.
 */
export function cleanSubfieldTopics(subfieldId: string, basemap: Basemap) {
  const sorted = basemap.topics
    .filter((t) => t.subfield === subfieldId)
    .sort((a, b) => b.worksCount - a.worksCount);
  while (sorted.length >= 3 && sorted[0]!.worksCount > 3 * sorted[1]!.worksCount) sorted.shift();
  return sorted;
}

/** Biggest topics WITHIN a subfield that you haven't read yet — the immediate next reads. */
export function topicGaps(
  subfieldId: string,
  basemap: Basemap,
  coverageByTopic: Record<string, number>,
): TopicGap[] {
  return cleanSubfieldTopics(subfieldId, basemap)
    .filter((t) => (coverageByTopic[t.id] ?? 0) === 0)
    .slice(0, 6)
    .map((t) => ({ id: t.id, name: t.name, works: t.worksCount }));
}

/** "Explore next" from a subfield: its citation-flow neighbours you have not read into. */
export function subfieldGaps(
  subfieldId: string,
  basemap: Basemap,
  coverage: Record<string, number>,
): LocalGap[] {
  const sf = basemap.subfields.find((s) => s.id === subfieldId);
  if (!sf) return [];
  return sf.neighbors
    .filter((n) => (coverage[n.id] ?? 0) === 0)
    .map((n) => {
      const nb = basemap.subfields.find((s) => s.id === n.id);
      return nb
        ? { id: n.id, name: nb.name, field: fieldNameOf(basemap, n.id), weight: n.w, via: [sf.name] }
        : null;
    })
    .filter((g): g is LocalGap => !!g)
    .slice(0, 6);
}

/** "Explore next" from a field: uncovered subfields its members cite into, ranked by flow. */
export function fieldGaps(
  fieldId: string,
  basemap: Basemap,
  coverage: Record<string, number>,
): LocalGap[] {
  const members = basemap.subfields.filter((s) => s.field === fieldId);
  const score = new Map<string, number>();
  const via = new Map<string, Set<string>>();
  for (const m of members) {
    for (const n of m.neighbors) {
      if ((coverage[n.id] ?? 0) > 0) continue; // only gaps
      if (n.id === m.id) continue;
      score.set(n.id, (score.get(n.id) ?? 0) + n.w);
      (via.get(n.id) ?? via.set(n.id, new Set()).get(n.id)!).add(m.name);
    }
  }
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([id, weight]) => {
      const nb = basemap.subfields.find((s) => s.id === id);
      return nb
        ? { id, name: nb.name, field: fieldNameOf(basemap, id), weight, via: [...(via.get(id) ?? [])].slice(0, 2) }
        : null;
    })
    .filter((g): g is LocalGap => !!g);
}
