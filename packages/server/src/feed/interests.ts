import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { atlasHome } from '../enrich/cache.js';

/**
 * The reader's interest profile that drives the daily feed. Seeded from the topics the user
 * named, then written to ~/.paper-atlas/interests.json so it can be hand-edited. `terms` are
 * matched against arXiv titles/abstracts; `categories` scope which arXiv sections to pull from.
 */
export interface InterestGroup {
  label: string;
  terms: string[];
}
export interface InterestsConfig {
  /** arXiv categories to gather fresh candidates from. */
  categories: string[];
  /** Interest groups — a paper matching any term in a group "hits" that group. */
  interests: InterestGroup[];
  /** 0..1 — how much weight the ranking gives to overlap with your library's topics. */
  libraryBlend: number;
  /** Target feed size per day. */
  perDay: number;
}

const DEFAULT: InterestsConfig = {
  categories: [
    'cs.LG', // machine learning
    'cs.CL', // computation & language (LLMs)
    'cs.AI', // artificial intelligence
    'cs.IT', // information theory
    'math.IT',
    'cs.CY', // computers & society (governance)
    'cs.MA', // multi-agent systems
    'cs.NE', // neural & evolutionary computing
    'stat.ML',
  ],
  interests: [
    {
      label: 'LLMs',
      terms: [
        'large language model',
        'language model',
        'LLM',
        'transformer',
        'in-context learning',
        'instruction tuning',
        'chain-of-thought',
      ],
    },
    {
      label: 'Information theory',
      terms: [
        'information theory',
        'mutual information',
        'entropy',
        'rate-distortion',
        'channel capacity',
        'minimum description length',
      ],
    },
    {
      label: 'AI governance',
      terms: [
        'AI governance',
        'AI policy',
        'AI regulation',
        'frontier model',
        'compute governance',
        'model evaluation policy',
      ],
    },
    {
      label: 'Population dynamics of AI',
      terms: [
        'model collapse',
        'self-consuming',
        'population dynamics',
        'evolutionary dynamics',
        'AI ecosystem',
        'recursive training',
        'synthetic data feedback',
      ],
    },
    {
      label: 'Alignment & interpretability',
      terms: [
        'alignment',
        'mechanistic interpretability',
        'RLHF',
        'scalable oversight',
        'reward model',
      ],
    },
  ],
  libraryBlend: 0.4,
  perDay: 50,
};

export function interestsPath(): string {
  return join(atlasHome(), 'interests.json');
}

/** Load the interests config, writing the seeded default on first run so the user can edit it. */
export function loadInterests(): InterestsConfig {
  const path = interestsPath();
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify(DEFAULT, null, 2));
    return DEFAULT;
  }
  try {
    const cfg = JSON.parse(readFileSync(path, 'utf8')) as Partial<InterestsConfig>;
    return {
      categories: cfg.categories ?? DEFAULT.categories,
      interests: cfg.interests ?? DEFAULT.interests,
      libraryBlend: cfg.libraryBlend ?? DEFAULT.libraryBlend,
      perDay: cfg.perDay ?? DEFAULT.perDay,
    };
  } catch {
    return DEFAULT;
  }
}
