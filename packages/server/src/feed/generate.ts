import { arxivQuery, type ArxivPaper } from '../arxiv.js';
import { loadInterests, type InterestsConfig } from './interests.js';
import { matchedWorks } from '../library.js';
import { ingest, findZoteroDataDir } from '../ingest/index.js';
import { matchLibrary } from '../enrich/matcher.js';
import { paperStore } from '../store.js';
import type { FeedEntry } from './types.js';

export interface DailyFeed {
  date: string; // YYYY-MM-DD
  generatedAt: string; // ISO
  items: FeedEntry[];
  profile: { interests: string[]; categories: string[]; libraryTerms: number };
}

const tokenize = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Terms drawn from your library — the topic and subfield names of every matched work. These are
 * the "blend" side of the ranking: candidates that overlap what you already read score higher.
 * Uses the in-memory match if present (server), else ingests + matches cache-first (CLI).
 */
async function libraryTerms(): Promise<Set<string>> {
  let works = matchedWorks();
  if (works.length === 0 && findZoteroDataDir()) {
    try {
      const { items } = await ingest();
      works = (await matchLibrary(items)).filter((m) => m.work);
    } catch {
      /* no library — blend just contributes nothing */
    }
  }
  const terms = new Set<string>();
  for (const m of works) {
    if (m.work?.topic?.name) terms.add(tokenize(m.work.topic.name));
    if (m.work?.subfield?.name) terms.add(tokenize(m.work.subfield.name));
  }
  terms.delete('');
  return terms;
}

/** Gather fresh candidates: one OR-query per interest group, plus one recency pull across categories. */
async function gatherCandidates(cfg: InterestsConfig): Promise<Map<string, ArxivPaper>> {
  const byId = new Map<string, ArxivPaper>();
  const add = (papers: ArxivPaper[]) => {
    for (const p of papers) if (!byId.has(p.id)) byId.set(p.id, p);
  };
  for (const g of cfg.interests) {
    const q = g.terms.map((t) => `abs:${JSON.stringify(t)}`).join(' OR ');
    try {
      add(await arxivQuery(q, 30));
    } catch {
      /* skip this group on a transient arXiv error */
    }
  }
  try {
    const catQ = cfg.categories.map((c) => `cat:${c}`).join(' OR ');
    add(await arxivQuery(catQ, 60));
  } catch {
    /* skip category pull */
  }
  return byId;
}

/** Jaccard similarity of two titles' word sets — used to drop near-duplicate submissions. */
function titleSim(a: string, b: string): number {
  const ta = new Set(tokenize(a).split(' ').filter((w) => w.length > 3));
  const tb = new Set(tokenize(b).split(' ').filter((w) => w.length > 3));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/**
 * Build the day's feed: score each candidate by interest match × freshness, blended with library
 * overlap, then MMR-dedup near-identical titles and keep the top `perDay`. arXiv-only, so it costs
 * no OpenAlex budget and is safe to run unattended on a schedule.
 */
export async function generateFeed(now = new Date()): Promise<DailyFeed> {
  const cfg = loadInterests();
  const libTerms = await libraryTerms();
  const candidates = await gatherCandidates(cfg);
  const { boost, hide } = paperStore().feedbackProfile();
  const boostSet = new Set(boost);

  const nowMs = now.getTime();
  const scored: (FeedEntry & { score: number })[] = [];
  for (const p of candidates.values()) {
    const feedId = `arxiv:${p.id}`;
    if (hide.has(feedId)) continue; // reader marked this (or its kind) "less like this"
    const text = tokenize(`${p.title} ${p.summary}`);
    // Interest match: count distinct groups hit (so one paper matching 5 LLM terms ≠ 5 points).
    const matched: string[] = [];
    for (const g of cfg.interests) {
      if (g.terms.some((t) => text.includes(tokenize(t)))) matched.push(g.label);
    }
    const inCategory = p.categories.some((c) => cfg.categories.includes(c));
    let libHits = 0;
    for (const t of libTerms) if (t.length > 4 && text.includes(t)) libHits++;
    const inLibraryTopic = libHits > 0;
    // "More like this": bonus when the paper shares terms with your liked papers.
    let boostHits = 0;
    if (boostSet.size) for (const w of new Set(text.split(' '))) if (boostSet.has(w)) boostHits++;

    const relevance =
      matched.length * 1.0 +
      (inCategory ? 0.4 : 0) +
      cfg.libraryBlend * Math.min(libHits, 3) * 0.5 +
      Math.min(boostHits, 4) * 0.5;
    if (relevance <= 0) continue;

    const ageDays = Math.max(0, (nowMs - new Date(p.published).getTime()) / 86400000);
    const freshness = 1 / (1 + ageDays / 4); // ~half-weight after 4 days
    scored.push({
      id: feedId,
      arxivId: p.id,
      title: p.title,
      authors: p.authors,
      published: p.published,
      summary: p.summary,
      url: p.url,
      pdf: p.pdf,
      categories: p.categories,
      matched,
      inLibraryTopic,
      score: relevance * freshness,
    });
  }

  scored.sort((a, b) => b.score - a.score);

  // MMR-style dedup: keep the highest scorer, drop later near-duplicate titles.
  const kept: FeedEntry[] = [];
  for (const item of scored) {
    if (kept.some((k) => titleSim(k.title, item.title) > 0.6)) continue;
    kept.push(item);
    if (kept.length >= cfg.perDay) break;
  }

  paperStore().setFeed(
    'fresh',
    kept.map((e) => ({ id: e.id, data: e })),
  );

  const date = now.toISOString().slice(0, 10);
  return {
    date,
    generatedAt: now.toISOString(),
    items: kept,
    profile: {
      interests: cfg.interests.map((g) => g.label),
      categories: cfg.categories,
      libraryTerms: libTerms.size,
    },
  };
}
