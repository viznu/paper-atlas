import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { arxivQuery } from '../arxiv.js';
import { atlasHome } from '../enrich/cache.js';
import { paperStore } from '../store.js';
import type { FeedEntry } from './types.js';

/**
 * "Recommended" — a curated feed built from a set of research themes, each a few search terms plus
 * a short `why` note shown on the card. Themes let you steer the feed toward a specific research
 * direction rather than broad interests. Edit them in ~/.paper-atlas/claude-themes.json (created
 * with the examples below on first run). Papers are real and fresh (arXiv, budget-free).
 */
interface Theme {
  label: string;
  terms: string[];
  why: string;
}
const DEFAULT_THEMES: Theme[] = [
  {
    label: 'Scalable oversight',
    terms: ['scalable oversight', 'weak-to-strong generalization', 'AI debate', 'recursive reward modeling'],
    why: 'Supervising models that are hard for humans to check directly.',
  },
  {
    label: 'Reward-model robustness',
    terms: ['reward model', 'reward hacking', 'reward overoptimization', 'RLHF robustness'],
    why: 'When and how reward models fail, and how to make them robust.',
  },
  {
    label: 'Interpretability & monitoring',
    terms: ['mechanistic interpretability', 'activation steering', 'linear probes representations', 'latent monitoring'],
    why: 'Reading and monitoring a model’s internal computation.',
  },
  {
    label: 'Deception & sandbagging',
    terms: ['sandbagging', 'deceptive alignment', 'alignment faking', 'strategic underperformance'],
    why: 'Detecting models that hide capability or intent.',
  },
  {
    label: 'Agent security',
    terms: ['LLM agent security', 'prompt injection defense', 'least privilege agent', 'tool-use safety'],
    why: 'Keeping tool-using LLM agents safe under adversarial pressure.',
  },
];

/** Load themes from local config (seeding the example defaults on first run). */
function loadThemes(): Theme[] {
  const path = join(atlasHome(), 'claude-themes.json');
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify(DEFAULT_THEMES, null, 2));
    return DEFAULT_THEMES;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Theme[];
  } catch {
    return DEFAULT_THEMES;
  }
}

const tokenize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
function titleSim(a: string, b: string): number {
  const ta = new Set(tokenize(a).split(' ').filter((w) => w.length > 3));
  const tb = new Set(tokenize(b).split(' ').filter((w) => w.length > 3));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  return inter / (ta.size + tb.size - inter);
}
const shorten = (s: string, n = 260) => (s.length > n ? s.slice(0, n) + '…' : s);

export interface ClaudeFeedResult {
  count: number;
  themes: number;
}

/** Build the Claude-recommended feed from the research-agenda themes. arXiv-only (budget-free). */
export async function generateClaudeFeed(now = new Date()): Promise<ClaudeFeedResult> {
  const THEMES = loadThemes();
  const { boost, hide } = paperStore().feedbackProfile();
  const boostSet = new Set(boost);
  const nowMs = now.getTime();

  const scored: (FeedEntry & { score: number })[] = [];
  const seen = new Set<string>();
  for (const theme of THEMES) {
    let papers;
    try {
      papers = await arxivQuery(theme.terms.map((t) => `abs:${JSON.stringify(t)}`).join(' OR '), 20);
    } catch {
      continue;
    }
    for (const p of papers) {
      const id = `arxiv:${p.id}`;
      if (seen.has(id) || hide.has(id)) continue;
      seen.add(id);
      const text = tokenize(`${p.title} ${p.summary}`);
      let boostHits = 0;
      if (boostSet.size) for (const w of new Set(text.split(' '))) if (boostSet.has(w)) boostHits++;
      const ageDays = Math.max(0, (nowMs - new Date(p.published).getTime()) / 86400000);
      const freshness = 1 / (1 + ageDays / 6);
      scored.push({
        id,
        arxivId: p.id,
        title: p.title,
        authors: p.authors,
        published: p.published,
        summary: shorten(p.summary),
        url: p.url,
        pdf: p.pdf,
        categories: p.categories,
        matched: [theme.label],
        reason: theme.why,
        score: (1 + Math.min(boostHits, 4) * 0.4) * freshness,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const kept: FeedEntry[] = [];
  for (const item of scored) {
    if (kept.some((k) => titleSim(k.title, item.title) > 0.6)) continue;
    kept.push(item);
    if (kept.length >= 40) break;
  }

  paperStore().setFeed(
    'claude',
    kept.map((e) => ({ id: e.id, data: e })),
  );
  return { count: kept.length, themes: THEMES.length };
}
