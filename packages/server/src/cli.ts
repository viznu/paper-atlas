#!/usr/bin/env node
import open from 'open';
import { buildServer } from './server.js';

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const subcommand = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;

// `paper-atlas feed` — regenerate today's daily feed and exit. This is what a scheduled job runs;
// it's arXiv-only, so it costs no OpenAlex budget.
if (subcommand === 'feed') {
  const { generateFeed } = await import('./feed/generate.js');
  const { generateClaudeFeed } = await import('./feed/claudeRecs.js');
  const feed = await generateFeed();
  const claude = await generateClaudeFeed();
  console.log(
    `  fresh: ${feed.items.length} papers (interests: ${feed.profile.interests.join(', ')}; ` +
      `${feed.profile.libraryTerms} library terms) · claude: ${claude.count} papers`,
  );
  process.exit(0);
}

// `paper-atlas daily` — regenerate every feed for today and write the list of papers still needing
// a summary to ~/.paper-atlas/pending-summaries.json. The Claude cowork task runs this, summarises
// each pending paper, then pipes the results back through `paper-atlas set-summary`.
if (subcommand === 'daily') {
  const { generateFeed } = await import('./feed/generate.js');
  const { generateClaudeFeed } = await import('./feed/claudeRecs.js');
  const { generatePhdFeed } = await import('./feed/phd.js');
  const { generateCitationsFeed } = await import('./feed/citations.js');
  const { paperStore } = await import('./store.js');
  const { writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { atlasHome } = await import('./enrich/cache.js');

  const fresh = await generateFeed();
  const claude = await generateClaudeFeed();
  let phd = 0;
  try {
    phd = (await generatePhdFeed()).count;
  } catch {
    /* budget / transient — keep going */
  }
  try {
    await generateCitationsFeed();
  } catch {
    /* needs a synced library / budget */
  }
  const pending = paperStore().pendingSummaries(['claude', 'phd']);
  const out = join(atlasHome(), 'pending-summaries.json');
  writeFileSync(out, JSON.stringify(pending, null, 2));
  console.log(
    `  daily: fresh ${fresh.items.length}, claude ${claude.count}, phd ${phd} · ` +
      `${pending.length} papers need summaries → ${out}`,
  );
  process.exit(0);
}

// `paper-atlas set-summary` — read JSON on stdin (one object or an array of {id, model?, cards})
// and store each summary. Used by the Claude cowork task to write the summaries it generates.
if (subcommand === 'set-summary') {
  const { paperStore } = await import('./store.js');
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  const parsed = raw ? JSON.parse(raw) : [];
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  let n = 0;
  for (const s of arr) {
    if (s?.id && s?.cards) {
      paperStore().setSummary(s.id, s.model || 'claude', s.cards);
      n++;
    }
  }
  console.log(`  stored ${n} summaries`);
  process.exit(0);
}

const port = Number(argValue('port') ?? process.env.PORT ?? 4517);
const dev = flags.has('--dev');

const server = await buildServer({ dev });
try {
  await server.listen({ port, host: '127.0.0.1' });
} catch (err) {
  server.log.error(err);
  process.exit(1);
}

const url = `http://localhost:${port}`;
console.log(`\n  paper-atlas is running at ${url}\n`);
if (!flags.has('--no-open')) {
  await open(url).catch(() => console.log('  (could not open a browser automatically)'));
}
