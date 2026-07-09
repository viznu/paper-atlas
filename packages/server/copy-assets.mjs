// Bundles the built web UI and the basemap data into the publishable package.
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webDist = join(here, '..', 'web', 'dist');
const basemap = join(here, '..', 'basemap-data', 'data', 'basemap.json');
const pub = join(here, 'public');

mkdirSync(pub, { recursive: true });
if (existsSync(webDist)) cpSync(webDist, pub, { recursive: true });
else console.warn('copy-assets: packages/web/dist not found — build the web package first');
if (existsSync(basemap)) cpSync(basemap, join(pub, 'basemap.json'));
else console.warn('copy-assets: basemap.json not found — run `npm run basemap` first');
