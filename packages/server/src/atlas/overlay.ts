import type { MatchedItem } from '../enrich/matcher.js';

interface BasemapSubfield {
  id: string;
  name: string;
  field: string;
  neighbors: { id: string; w: number }[];
}
interface Basemap {
  subfields: BasemapSubfield[];
  fields: { id: string; name: string }[];
}

export interface LibraryEntry {
  key: string;
  title: string;
  year: number | null;
  subfield: string | null; // "subfields/1702"
  confidence: number;
}

export interface Overlay {
  stats: { total: number; matched: number; placed: number };
  /** subfieldId -> library items placed there (drawn as glowing dots on the territory). */
  itemsBySubfield: Record<string, LibraryEntry[]>;
  /** subfieldId -> count, for territory brightness. */
  coverage: Record<string, number>;
  /** topicId -> count, for the topic treemap heat. */
  coverageByTopic: Record<string, number>;
  /**
   * Frontier territories: subfields that your covered areas cite heavily but that you have
   * little/no coverage in — ranked candidates for "where to explore next".
   */
  frontier: {
    id: string;
    name: string;
    field: string;
    score: number;
    coverage: number;
    viaSubfields: string[]; // names of your covered subfields that cite into this one
  }[];
}

/**
 * Projects a matched library onto the base map and derives coverage + frontier gaps.
 * A frontier territory scores by how strongly your *covered* subfields cite into it
 * (summed citation-flow weight), discounted by how much you already cover it — so the
 * top of the list is "adjacent to what you read, but under-explored".
 */
export function computeOverlay(matched: MatchedItem[], basemap: Basemap): Overlay {
  const subfieldById = new Map(basemap.subfields.map((s) => [s.id, s]));
  const fieldName = new Map(basemap.fields.map((f) => [f.id, f.name]));

  const itemsBySubfield: Record<string, LibraryEntry[]> = {};
  const coverage: Record<string, number> = {};
  const coverageByTopic: Record<string, number> = {};
  let placed = 0;
  const matchedCount = matched.filter((m) => m.work).length;

  for (const m of matched) {
    const sid = m.work?.subfield?.id;
    if (!sid || !subfieldById.has(sid)) continue;
    const entry: LibraryEntry = {
      key: m.item.key,
      title: m.item.title,
      year: m.item.year,
      subfield: sid,
      confidence: m.confidence,
    };
    (itemsBySubfield[sid] ??= []).push(entry);
    coverage[sid] = (coverage[sid] ?? 0) + 1;
    const tid = m.work?.topic?.id;
    if (tid) coverageByTopic[tid] = (coverageByTopic[tid] ?? 0) + 1;
    placed++;
  }

  // Frontier scoring: accumulate flow from each covered subfield to its neighbors.
  const frontierScore = new Map<string, number>();
  const frontierVia = new Map<string, Set<string>>();
  for (const [coveredId, count] of Object.entries(coverage)) {
    const sf = subfieldById.get(coveredId);
    if (!sf) continue;
    // Weight a source subfield by how much of the library sits there (log to avoid one
    // giant pile dominating), so gaps adjacent to your genuine focus rank highest.
    const srcWeight = Math.log2(count + 1);
    for (const n of sf.neighbors) {
      frontierScore.set(n.id, (frontierScore.get(n.id) ?? 0) + n.w * srcWeight);
      if (!frontierVia.has(n.id)) frontierVia.set(n.id, new Set());
      frontierVia.get(n.id)!.add(sf.name);
    }
  }

  const frontier = [...frontierScore.entries()]
    .map(([id, rawScore]) => {
      const sf = subfieldById.get(id);
      const cov = coverage[id] ?? 0;
      // Discount territories you already cover well; a covered subfield is not a "gap".
      const score = rawScore / (1 + cov);
      return {
        id,
        name: sf?.name ?? id,
        field: sf ? (fieldName.get(sf.field) ?? '') : '',
        score,
        coverage: cov,
        viaSubfields: [...(frontierVia.get(id) ?? [])].slice(0, 4),
      };
    })
    .filter((f) => f.coverage === 0 || f.score > 0.15) // surface true gaps first
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);

  return {
    stats: { total: matched.length, matched: matchedCount, placed },
    itemsBySubfield,
    coverage,
    coverageByTopic,
    frontier,
  };
}
