import OpenAI from 'openai';
import { paperStore } from './store.js';
import type { PaperDetail } from './paper.js';

/**
 * Optional LLM layer (OpenAI). Two modes, chosen by PAPER_ATLAS_LLM:
 *   - 'real'  → call OpenAI (needs OPENAI_API_KEY). Grounded strictly in the abstract.
 *   - default → 'mock': return clearly-labelled placeholder cards and make NO network calls.
 * Mock mode is the prototyping default so we can iterate on layout without spending API budget;
 * flip to real with PAPER_ATLAS_LLM=real. Real summaries are cached per (model, paper) forever.
 */
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const MODE: 'real' | 'mock' = process.env.PAPER_ATLAS_LLM === 'real' ? 'real' : 'mock';

let client: OpenAI | null = null;
function getClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!client) client = new OpenAI();
  return client;
}

/** Summaries render whenever we can produce them — always in mock mode, or with a key in real mode. */
export function llmEnabled(): boolean {
  return MODE === 'mock' || !!process.env.OPENAI_API_KEY;
}

export interface SummaryCards {
  problem: string;
  achieved: string;
  showed: string;
  limitations: string;
  future: string;
}

export interface PaperSummary {
  enabled: boolean;
  model?: string;
  /** True when there was no abstract to summarise. */
  noAbstract?: boolean;
  /** True when the cards are placeholder prototype text, not a real LLM analysis. */
  mock?: boolean;
  cards?: SummaryCards;
  error?: string;
}

// Deterministic placeholder pools — realistic-length one-liners so the layout looks real, but
// generic on purpose (never claimed as an accurate reading of the paper). Badged in the UI.
const MOCK_POOL: Record<keyof SummaryCards, string[]> = {
  problem: [
    'How to learn useful representations from data without dense human labelling.',
    'Whether large models generalise beyond the distribution they were trained on.',
    'The trade-off between sample efficiency and asymptotic performance at scale.',
    'How to make an intractable inference problem tractable without losing fidelity.',
    'Bridging the gap between a clean theoretical model and messy real-world data.',
  ],
  achieved: [
    'The authors introduce a method and a training objective that operationalises the idea.',
    'A new architecture is proposed alongside a procedure for fitting it at scale.',
    'They build an estimator with a tractable bound and show how to optimise it.',
    'A framework is developed that unifies several previously separate approaches.',
    'The work contributes both an algorithm and a benchmark to evaluate it on.',
  ],
  showed: [
    'Consistent gains over strong baselines across the datasets they evaluate on.',
    'The approach scales predictably and the reported ablations isolate what matters.',
    'State-of-the-art results at the time, with the effect holding across settings.',
    'Empirical evidence that the proposed quantity tracks the outcome of interest.',
    'Competitive accuracy at substantially lower cost than prior methods.',
  ],
  limitations: [
    'Evaluation is limited to a handful of domains; broader transfer is untested.',
    'The method assumes conditions that may not hold outside the studied setting.',
    'Compute and data requirements are high, which the paper acknowledges.',
    'Failure modes on out-of-distribution inputs are noted but not fully characterised.',
    'Results are strong in aggregate but variance across seeds is not deeply explored.',
  ],
  future: [
    'Extending the approach to larger, multimodal, or streaming settings.',
    'Tightening the theory to explain when and why the method works.',
    'Reducing the compute cost so the technique is practical at smaller scale.',
    'Combining this signal with complementary objectives for further gains.',
    'Testing robustness under distribution shift and adversarial conditions.',
  ],
};

/** Stable hash of the paper id so each paper gets the same placeholder cards every render. */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function mockSummary(detail: PaperDetail): PaperSummary {
  const h = hash(detail.id);
  const pick = (arr: string[], salt: number) => arr[(h + salt) % arr.length]!;
  return {
    enabled: true,
    mock: true,
    model: 'prototype',
    cards: {
      problem: pick(MOCK_POOL.problem, 0),
      achieved: pick(MOCK_POOL.achieved, 1),
      showed: pick(MOCK_POOL.showed, 2),
      limitations: pick(MOCK_POOL.limitations, 3),
      future: pick(MOCK_POOL.future, 4),
    },
  };
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    problem: { type: 'string', description: 'The problem or question the paper set out to address.' },
    achieved: { type: 'string', description: 'What the authors built or did — their contribution.' },
    showed: { type: 'string', description: 'The key results or findings they demonstrated.' },
    limitations: {
      type: 'string',
      description: 'What the paper did NOT show or acknowledges it cannot do. If the abstract is silent, say so.',
    },
    future: { type: 'string', description: 'Future directions suggested or implied. If none stated, say so.' },
  },
  required: ['problem', 'achieved', 'showed', 'limitations', 'future'],
} as const;

/**
 * Summarise one paper into five cards. Reads the paper store first — if a summary from this model
 * is already stored, it's returned WITHOUT any API call (generate once, re-read forever). Mock mode
 * returns deterministic placeholders and never calls the API.
 */
export async function summarizePaper(detail: PaperDetail): Promise<PaperSummary> {
  const store = paperStore();

  // A summary written by the daily Claude cowork task wins over mock/OpenAlex generation.
  const claudeHit = store.getSummary(detail.id, 'claude');
  if (claudeHit) return { enabled: true, model: 'claude', cards: claudeHit.cards };

  if (MODE === 'mock') {
    const hit = store.getSummary(detail.id, 'prototype');
    if (hit) return { enabled: true, mock: true, model: 'prototype', cards: hit.cards };
    const mock = mockSummary(detail);
    if (mock.cards) store.setSummary(detail.id, 'prototype', mock.cards);
    return mock;
  }

  const c = getClient();
  if (!c) return { enabled: false };
  if (!detail.abstract) return { enabled: true, model: MODEL, noAbstract: true };

  // Check the DB before spending an API call.
  const hit = store.getSummary(detail.id, MODEL);
  if (hit) return { enabled: true, model: MODEL, cards: hit.cards };

  const prompt = [
    `Title: ${detail.title}`,
    detail.authors.length ? `Authors: ${detail.authors.slice(0, 6).join(', ')}` : '',
    detail.venue ? `Venue: ${detail.venue}` : '',
    detail.year ? `Year: ${detail.year}` : '',
    '',
    'Abstract:',
    detail.abstract,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const resp = await c.chat.completions.create({
      model: MODEL,
      max_tokens: 700,
      messages: [
        {
          role: 'system',
          content:
            'You explain research papers to a knowledgeable reader. Base every statement strictly on ' +
            'the abstract provided. Be concise (one or two sentences per field). Do not invent numbers, ' +
            'methods, or claims that are not in the abstract — if the abstract does not cover a field ' +
            '(especially limitations or future work), say plainly that the abstract does not state it.',
        },
        { role: 'user', content: prompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'paper_summary', strict: true, schema: SCHEMA },
      },
    });
    const raw = resp.choices[0]?.message?.content;
    if (!raw) return { enabled: true, model: MODEL, error: 'empty response' };
    const cards = JSON.parse(raw) as SummaryCards;
    store.setSummary(detail.id, MODEL, cards);
    return { enabled: true, model: MODEL, cards };
  } catch (err) {
    return { enabled: true, model: MODEL, error: String(err) };
  }
}
