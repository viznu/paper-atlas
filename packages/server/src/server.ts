import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { basemapRaw } from './basemap.js';
import { worksFor, openalexRaw, RateLimitError } from './openalex.js';
import { libraryState, syncLibrary } from './library.js';
import { arxivLatest } from './arxiv.js';
import { fetchRecommendations } from './recs.js';
import { fetchPaperDetail } from './paper.js';
import { summarizePaper, llmEnabled } from './llm.js';
import { generateFeed } from './feed/generate.js';
import { generateClaudeFeed } from './feed/claudeRecs.js';
import { generatePhdFeed } from './feed/phd.js';
import { generateCitationsFeed } from './feed/citations.js';
import { paperStore, FEED_TABLES, type FeedTab } from './store.js';

/** Wraps a live OpenAlex fetch so a daily-budget exhaustion degrades to a 200 with a flag. */
async function withRateLimit<T>(reply: { code: (n: number) => unknown }, fn: () => Promise<T>) {
  try {
    return { works: await fn(), rateLimited: false };
  } catch (err) {
    if (err instanceof RateLimitError) {
      return { works: [], rateLimited: true, retryAfterSeconds: err.retryAfterSeconds };
    }
    throw err;
  }
}

export async function buildServer(opts: { dev?: boolean } = {}) {
  const app = Fastify({ logger: opts.dev ? { level: 'info' } : { level: 'warn' } });

  app.get('/api/health', async () => ({ ok: true }));

  // Library overlay: coverage + frontier gaps. Non-blocking — returns current state; a POST
  // to /api/library/sync (re)builds it. Cache-first, so a synced library needs no API calls.
  app.get('/api/library', async () => libraryState());
  app.post<{ Querystring: { refresh?: string } }>('/api/library/sync', async (req) =>
    syncLibrary({ refresh: req.query.refresh === '1' }),
  );

  app.get('/api/basemap', async (_req, reply) => {
    reply.header('content-type', 'application/json').header('cache-control', 'max-age=3600');
    return basemapRaw();
  });

  app.get<{ Params: { id: string }; Querystring: { mode?: string } }>(
    '/api/subfields/:id/works',
    async (req, reply) => {
      const mode = req.query.mode === 'recent' ? 'recent' : 'top';
      return withRateLimit(reply, () =>
        worksFor({ kind: 'subfield', id: `subfields/${req.params.id}` }, mode),
      );
    },
  );

  app.get<{ Params: { id: string }; Querystring: { mode?: string } }>(
    '/api/topics/:id/works',
    async (req, reply) => {
      const mode = req.query.mode === 'recent' ? 'recent' : 'top';
      return withRateLimit(reply, () => worksFor({ kind: 'topic', id: req.params.id }, mode));
    },
  );

  // ---- Reading Desk ----
  // Whether the optional LLM summary layer is available (OPENAI_API_KEY set on the server).
  app.get('/api/config', async () => ({ summaries: llmEnabled(), storedPapers: paperStore().count() }));

  // ---- Feeds (four tabs, each its own table) ----
  const isTab = (t: string): t is FeedTab => t in FEED_TABLES;

  // Read a materialised feed tab for a date (default: latest snapshot). Includes the available
  // dates (for a date picker), feedback signals, and which papers are marked read.
  app.get<{ Params: { tab: string }; Querystring: { date?: string } }>(
    '/api/feed/:tab',
    async (req, reply) => {
      if (!isTab(req.params.tab)) return reply.code(404).send({ error: 'unknown feed' });
      const feed = paperStore().getFeed(req.params.tab, req.query.date);
      const feedback = paperStore()
        .allFeedback()
        .filter((f) => f.feed === req.params.tab);
      return { ...feed, feedback, read: paperStore().readIds() };
    },
  );

  // Mark a paper read / unread.
  app.post<{ Body: { id: string; read: boolean } }>('/api/read', async (req, reply) => {
    const { id, read } = req.body ?? ({} as any);
    if (!id) return reply.code(400).send({ error: 'missing id' });
    paperStore().markRead(id, read !== false);
    return { ok: true };
  });

  // Insert a summary written by the daily Claude task (or any client). Stored keyed by (id, model).
  app.post<{ Params: { id: string }; Body: { model?: string; cards: any } }>(
    '/api/paper/:id/summary/set',
    async (req, reply) => {
      const { model, cards } = req.body ?? ({} as any);
      const need = ['problem', 'achieved', 'showed', 'limitations', 'future'];
      if (!cards || need.some((k) => typeof cards[k] !== 'string')) {
        return reply.code(400).send({ error: 'cards must have problem/achieved/showed/limitations/future' });
      }
      paperStore().setSummary(req.params.id, model || 'claude', cards);
      return { ok: true };
    },
  );

  // (Re)generate a feed tab. Fresh/Claude are arXiv-only (budget-free); Citations/PhD use OpenAlex.
  app.post<{ Params: { tab: string } }>('/api/feed/:tab/generate', async (req, reply) => {
    if (!isTab(req.params.tab)) return reply.code(404).send({ error: 'unknown feed' });
    try {
      if (req.params.tab === 'fresh') await generateFeed();
      else if (req.params.tab === 'claude') await generateClaudeFeed();
      else if (req.params.tab === 'citations') await generateCitationsFeed();
      else if (req.params.tab === 'phd') await generatePhdFeed();
      return { ...paperStore().getFeed(req.params.tab), ok: true };
    } catch (err) {
      if (err instanceof RateLimitError) return { ...paperStore().getFeed(req.params.tab), rateLimited: true };
      throw err;
    }
  });

  // "More / less like this" — records a reader signal that folds into future ranking.
  app.post<{ Body: { id: string; tab: string; signal: string; title?: string } }>(
    '/api/feedback',
    async (req, reply) => {
      const { id, tab, signal, title } = req.body ?? ({} as any);
      if (!id || !isTab(tab) || (signal !== 'more' && signal !== 'less' && signal !== 'clear')) {
        return reply.code(400).send({ error: 'bad feedback' });
      }
      if (signal === 'clear') paperStore().addFeedback(id, tab, '', title);
      else paperStore().addFeedback(id, tab, signal, title);
      return { ok: true };
    },
  );

  // Resolve an arXiv id to its OpenAlex work id (if indexed) so a fresh feed paper can open its
  // citation thread. Returns {id:null} when OpenAlex hasn't indexed it yet.
  app.get<{ Params: { id: string } }>('/api/paper/by-arxiv/:id', async (req) => {
    const id = req.params.id.replace(/[^0-9v.]/gi, '');
    try {
      const w: any = await openalexRaw(`/works/doi:10.48550/arXiv.${id}?select=id`);
      return { id: w?.id ? (w.id as string).replace('https://openalex.org/', '') : null };
    } catch (err) {
      if (err instanceof RateLimitError) return { id: null, rateLimited: true };
      return { id: null };
    }
  });

  // Recommended next reads: works your library cites but doesn't own, ranked by co-citation.
  app.get('/api/recommendations', async (_req, reply) => {
    try {
      return { ...(await fetchRecommendations()), rateLimited: false };
    } catch (err) {
      if (err instanceof RateLimitError) return { papers: [], needsSync: false, rateLimited: true };
      throw err;
    }
  });

  // A paper's "family tree": its references as a year-sorted timeline, with citation contexts.
  app.get<{ Params: { id: string } }>('/api/paper/:id', async (req, reply) => {
    const id = req.params.id.replace(/[^A-Za-z0-9]/g, '');
    try {
      return { paper: await fetchPaperDetail(id), rateLimited: false };
    } catch (err) {
      if (err instanceof RateLimitError) return { paper: null, rateLimited: true };
      reply.code(200);
      return { paper: null, error: String(err) };
    }
  });

  // LLM summary cards for a paper (key-gated; returns {enabled:false} without a key).
  app.get<{ Params: { id: string } }>('/api/paper/:id/summary', async (req) => {
    const id = req.params.id.replace(/[^A-Za-z0-9]/g, '');
    try {
      const paper = await fetchPaperDetail(id);
      return summarizePaper(paper);
    } catch (err) {
      if (err instanceof RateLimitError) return { enabled: llmEnabled(), error: 'openalex rate limited' };
      return { enabled: llmEnabled(), error: String(err) };
    }
  });

  // Fresh arXiv preprints matching a field/subfield/topic name (independent of OpenAlex budget).
  app.get<{ Querystring: { q?: string } }>('/api/arxiv', async (req, reply) => {
    const q = (req.query.q ?? '').slice(0, 120);
    if (!q) return { papers: [] };
    try {
      return { papers: await arxivLatest(q, 10) };
    } catch (err) {
      reply.code(200);
      return { papers: [], error: String(err) };
    }
  });

  // Serve the built web UI when it exists (published package / after `npm run build`).
  const here = dirname(fileURLToPath(import.meta.url));
  const publicDirs = [join(here, '..', 'public'), join(here, '..', '..', 'public')];
  const publicDir = publicDirs.find((p) => existsSync(join(p, 'index.html')));
  if (publicDir) {
    await app.register(fastifyStatic, { root: publicDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}
