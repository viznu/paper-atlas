import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { basemapRaw } from './basemap.js';
import { worksFor, RateLimitError } from './openalex.js';

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
