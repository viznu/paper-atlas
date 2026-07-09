#!/usr/bin/env node
import open from 'open';
import { buildServer } from './server.js';

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));

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
