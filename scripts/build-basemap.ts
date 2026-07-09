/**
 * Builds the paper-atlas base map: every OpenAlex field/subfield/topic, laid out in 2D so
 * that subfields which cite each other most end up adjacent ("neighbors = most-cited-from").
 *
 * Pipeline:
 *   1. Fetch the OpenAlex taxonomy (26 fields, ~252 subfields, ~4,516 topics).
 *   2. For each subfield, sample its top-cited works (all-time + recent) with their
 *      referenced_works.
 *   3. Batch-resolve every referenced work to its primary subfield -> directed
 *      subfield-to-subfield citation-flow matrix.
 *   4. Normalize + symmetrize flows, keep each subfield's strongest neighbors.
 *   5. ForceAtlas2 layout on the flow graph (seeded by domain/field so runs are stable).
 *   6. Place each subfield's topics on a golden-angle spiral around its centroid.
 *   7. Write packages/basemap-data/data/basemap.json.
 *
 * All HTTP responses are cached under scripts/.cache/, so interrupted runs resume cheaply.
 *
 * Usage:
 *   npx tsx scripts/build-basemap.ts [--subfields N] [--works-per-subfield N] [--out PATH]
 *   OPENALEX_MAILTO=you@example.com npx tsx scripts/build-basemap.ts   # polite pool
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, 'scripts', '.cache');
const API = 'https://api.openalex.org';
const MAILTO = process.env.OPENALEX_MAILTO;

// ---------- CLI args ----------
function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const SUBFIELD_LIMIT = Number(argValue('subfields') ?? 0) || Infinity; // dev: cap subfields
const WORKS_PER_SUBFIELD = Number(argValue('works-per-subfield') ?? 25);
const OUT_PATH = argValue('out') ?? join(ROOT, 'packages', 'basemap-data', 'data', 'basemap.json');

// ---------- polite fetch with cache, retry, throttle ----------
let lastRequestAt = 0;
const MIN_SPACING_MS = 150; // ~6.5 req/s, comfortably under OpenAlex's 10/s polite limit
const MAX_ATTEMPTS = 8;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url: string): Promise<any> {
  const cacheKey = url.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 180);
  const cacheFile = join(CACHE_DIR, `${cacheKey}.json`);
  if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, 'utf8'));

  const withMailto = MAILTO ? `${url}${url.includes('?') ? '&' : '?'}mailto=${MAILTO}` : url;
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const wait = lastRequestAt + MIN_SPACING_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    // exponential backoff with jitter, capped at 30s, for both retryable statuses and throws
    const backoff = Math.min(30_000, 1500 * 2 ** attempt) + Math.floor(attempt * 250);
    try {
      const res = await fetch(withMailto);
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`${res.status} ${res.statusText} for ${url}`);
        if (attempt < MAX_ATTEMPTS - 1) await sleep(backoff);
        continue;
      }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      const json = await res.json();
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(cacheFile, JSON.stringify(json));
      return json;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS - 1) await sleep(backoff);
    }
  }
  throw new Error(`giving up on ${url} after ${MAX_ATTEMPTS} attempts: ${String(lastErr)}`);
}

async function fetchAllPages(entity: string, perPage: number): Promise<any[]> {
  const results: any[] = [];
  for (let page = 1; ; page++) {
    const data = await fetchJson(`${API}/${entity}?per_page=${perPage}&page=${page}`);
    results.push(...data.results);
    if (results.length >= data.meta.count || data.results.length === 0) break;
  }
  return results;
}

const shortId = (openalexUrl: string) => openalexUrl.replace(/^https:\/\/openalex\.org\//, '');

// ---------- 1. taxonomy ----------
console.log('Fetching taxonomy…');
const domains = await fetchAllPages('domains', 25);
const fields = await fetchAllPages('fields', 50);
const subfieldsRaw = (await fetchAllPages('subfields', 100)).slice(
  0,
  SUBFIELD_LIMIT === Infinity ? undefined : SUBFIELD_LIMIT,
);
const topicsRaw = await fetchAllPages('topics', 200);
console.log(
  `  ${domains.length} domains, ${fields.length} fields, ${subfieldsRaw.length} subfields (of 252), ${topicsRaw.length} topics`,
);

const subfieldIds = new Set(subfieldsRaw.map((s) => shortId(s.id)));

// ---------- 2. sample top works per subfield, collect references ----------
console.log('Sampling top works per subfield…');
// refCounts: srcSubfield -> (refWorkId -> times referenced by sampled works of src)
const refCounts = new Map<string, Map<string, number>>();
let sampled = 0;
for (const sf of subfieldsRaw) {
  const sid = shortId(sf.id); // e.g. "subfields/1702"
  const counts = new Map<string, number>();
  refCounts.set(sid, counts);
  const queries = [
    `${API}/works?filter=primary_topic.subfield.id:${sid}&sort=cited_by_count:desc&per_page=${WORKS_PER_SUBFIELD}&select=id,referenced_works`,
    `${API}/works?filter=primary_topic.subfield.id:${sid},from_publication_date:2016-01-01&sort=cited_by_count:desc&per_page=${WORKS_PER_SUBFIELD}&select=id,referenced_works`,
  ];
  for (const q of queries) {
    let data;
    try {
      data = await fetchJson(q);
    } catch (err) {
      // A single flaky query must not abort the whole build; this subfield just gets
      // fewer reference samples. Skipped subfields still appear on the map.
      console.warn(`  ! skipped a query for ${sf.display_name}: ${String(err)}`);
      continue;
    }
    for (const w of data.results) {
      for (const ref of w.referenced_works ?? []) {
        const rid = shortId(ref);
        counts.set(rid, (counts.get(rid) ?? 0) + 1);
      }
    }
  }
  sampled++;
  if (sampled % 25 === 0) console.log(`  ${sampled}/${subfieldsRaw.length} subfields sampled`);
}

// ---------- 3. resolve referenced works -> primary subfield ----------
const allRefIds = new Set<string>();
for (const counts of refCounts.values()) for (const id of counts.keys()) allRefIds.add(id);
console.log(`Resolving ${allRefIds.size} unique referenced works to subfields…`);

const RESOLVE_CACHE = join(CACHE_DIR, 'work-subfield-resolutions.json');
const resolved: Record<string, string | null> = existsSync(RESOLVE_CACHE)
  ? JSON.parse(readFileSync(RESOLVE_CACHE, 'utf8'))
  : {};
const toResolve = [...allRefIds].filter((id) => !(id in resolved));
for (let i = 0; i < toResolve.length; i += 50) {
  const batch = toResolve.slice(i, i + 50);
  try {
    const data = await fetchJson(
      `${API}/works?filter=openalex_id:${batch.join('|')}&per_page=50&select=id,primary_topic`,
    );
    for (const w of data.results) {
      resolved[shortId(w.id)] = w.primary_topic?.subfield?.id
        ? shortId(w.primary_topic.subfield.id)
        : null;
    }
    for (const id of batch) if (!(id in resolved)) resolved[id] = null; // deleted/missing works
  } catch (err) {
    // Skip this batch; those references simply won't contribute to the flow matrix.
    // Leave them unresolved (not cached) so a later run can retry them.
    console.warn(`  ! skipped a resolve batch: ${String(err)}`);
  }
  if ((i / 50) % 40 === 0) {
    writeFileSync(RESOLVE_CACHE, JSON.stringify(resolved));
    console.log(`  ${Math.min(i + 50, toResolve.length)}/${toResolve.length} resolved`);
  }
}
writeFileSync(RESOLVE_CACHE, JSON.stringify(resolved));

// ---------- 4. flow matrix, normalization, neighbors ----------
console.log('Building citation-flow matrix…');
const flow = new Map<string, Map<string, number>>(); // src -> dst -> weight
for (const [src, counts] of refCounts) {
  const row = new Map<string, number>();
  flow.set(src, row);
  for (const [refId, n] of counts) {
    const dst = resolved[refId];
    if (!dst || !subfieldIds.has(dst)) continue;
    row.set(dst, (row.get(dst) ?? 0) + n);
  }
}
const outTotals = new Map<string, number>();
for (const [src, row] of flow) {
  let t = 0;
  for (const [dst, n] of row) if (dst !== src) t += n;
  outTotals.set(src, Math.max(t, 1));
}
// symmetric normalized weight between a pair: share of src's outflow + share of dst's outflow
const pairWeight = new Map<string, number>();
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
for (const [src, row] of flow) {
  for (const [dst, n] of row) {
    if (dst === src || !flow.has(dst)) continue;
    const k = pairKey(src, dst);
    pairWeight.set(k, (pairWeight.get(k) ?? 0) + n / outTotals.get(src)!);
  }
}
// per-subfield ranked neighbor lists (for UI + layout edges)
const neighbors = new Map<string, { id: string; w: number }[]>();
for (const sid of subfieldIds) {
  const list: { id: string; w: number }[] = [];
  for (const [k, w] of pairWeight) {
    const [a, b] = k.split('|') as [string, string];
    if (a === sid) list.push({ id: b, w });
    else if (b === sid) list.push({ id: a, w });
  }
  list.sort((x, y) => y.w - x.w);
  neighbors.set(sid, list.slice(0, 10));
}

// ---------- 5. layout ----------
console.log('Running ForceAtlas2 layout…');
const graph = new Graph({ type: 'undirected' });
// seed positions: domains get quadrants of a circle, fields get angular slots inside their
// domain's arc, subfields start jittered around their field's centroid. Deterministic (no RNG).
const fieldsByDomain = new Map<string, string[]>();
for (const f of fields) {
  const d = shortId(f.domain.id);
  fieldsByDomain.set(d, [...(fieldsByDomain.get(d) ?? []), shortId(f.id)]);
}
const fieldAngle = new Map<string, number>();
let domainStart = 0;
for (const d of domains) {
  const dFields = fieldsByDomain.get(shortId(d.id)) ?? [];
  const arc = (2 * Math.PI * Math.max(dFields.length, 1)) / fields.length;
  dFields.forEach((fid, i) => fieldAngle.set(fid, domainStart + (arc * (i + 0.5)) / dFields.length));
  domainStart += arc;
}
subfieldsRaw.forEach((sf, i) => {
  const sid = shortId(sf.id);
  const angle = fieldAngle.get(shortId(sf.field.id)) ?? 0;
  const R = 400;
  // deterministic jitter from index so subfields of one field don't stack exactly
  const jitterAngle = (i * 2.399963229728653) % (2 * Math.PI);
  const jitterR = 40 + (i % 7) * 12;
  graph.addNode(sid, {
    x: R * Math.cos(angle) + jitterR * Math.cos(jitterAngle),
    y: R * Math.sin(angle) + jitterR * Math.sin(jitterAngle),
    size: Math.sqrt(sf.works_count ?? 1),
  });
});
// edges: union of each node's top-6 neighbors
for (const [sid, list] of neighbors) {
  for (const { id, w } of list.slice(0, 6)) {
    if (graph.hasNode(id) && !graph.hasEdge(sid, id)) graph.addEdge(sid, id, { weight: w });
  }
}
forceAtlas2.assign(graph, {
  iterations: 600,
  settings: {
    ...forceAtlas2.inferSettings(graph),
    edgeWeightInfluence: 1.2,
    gravity: 0.8,
    scalingRatio: 20,
    barnesHutOptimize: true,
  },
});
// rescale into [0,1000]^2
const xs = graph.mapNodes((_, a) => a.x as number);
const ys = graph.mapNodes((_, a) => a.y as number);
const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
const scale = 940 / Math.max(maxX - minX, maxY - minY);
const pos = new Map<string, { x: number; y: number }>();
graph.forEachNode((sid, a) => {
  pos.set(sid, { x: 30 + (a.x - minX) * scale, y: 30 + (a.y - minY) * scale });
});

// ---------- 6. topic placement (golden-angle spiral inside each subfield) ----------
const topicsBySubfield = new Map<string, any[]>();
for (const t of topicsRaw) {
  const sid = shortId(t.subfield.id);
  if (!subfieldIds.has(sid)) continue;
  topicsBySubfield.set(sid, [...(topicsBySubfield.get(sid) ?? []), t]);
}
for (const list of topicsBySubfield.values()) {
  list.sort((a, b) => (b.works_count ?? 0) - (a.works_count ?? 0));
}

// ---------- 7. output ----------
console.log('Writing basemap…');
const GOLDEN = 2.399963229728653;
const out = {
  version: 1,
  generatedAt: new Date().toISOString(),
  params: { worksPerSubfield: WORKS_PER_SUBFIELD, subfields: subfieldsRaw.length },
  source: 'OpenAlex (https://openalex.org), CC0',
  domains: domains.map((d) => ({ id: shortId(d.id), name: d.display_name })),
  fields: fields.map((f) => ({
    id: shortId(f.id),
    name: f.display_name,
    domain: shortId(f.domain.id),
  })),
  subfields: subfieldsRaw.map((sf) => {
    const sid = shortId(sf.id);
    const p = pos.get(sid)!;
    return {
      id: sid,
      name: sf.display_name,
      field: shortId(sf.field.id),
      domain: shortId(sf.domain.id),
      x: Math.round(p.x * 100) / 100,
      y: Math.round(p.y * 100) / 100,
      worksCount: sf.works_count ?? 0,
      wikipedia: sf.ids?.wikipedia ?? null,
      neighbors: (neighbors.get(sid) ?? []).map((n) => ({
        id: n.id,
        w: Math.round(n.w * 1000) / 1000,
      })),
    };
  }),
  topics: [...topicsBySubfield.entries()].flatMap(([sid, list]) => {
    const c = pos.get(sid)!;
    const spread = 14 + Math.sqrt(list.length) * 3;
    return list.map((t, i) => ({
      id: shortId(t.id),
      name: t.display_name,
      subfield: sid,
      worksCount: t.works_count ?? 0,
      x: Math.round((c.x + spread * Math.sqrt((i + 0.5) / list.length) * Math.cos(i * GOLDEN)) * 100) / 100,
      y: Math.round((c.y + spread * Math.sqrt((i + 0.5) / list.length) * Math.sin(i * GOLDEN)) * 100) / 100,
      keywords: (t.keywords ?? []).slice(0, 8),
      summary: (t.description ?? '').slice(0, 300),
      wikipedia: t.ids?.wikipedia ?? null,
    }));
  }),
};
mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(out));
const mb = (JSON.stringify(out).length / 1024 / 1024).toFixed(1);
console.log(`Done: ${OUT_PATH} (${mb} MB, ${out.subfields.length} subfields, ${out.topics.length} topics)`);
