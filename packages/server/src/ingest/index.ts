import { findZoteroDataDir, ingestZoteroSqlite } from './zoteroSqlite.js';
import { ingestZoteroLocalApi, localApiAvailable } from './zoteroLocalApi.js';
import type { IngestResult } from './types.js';

export type { IngestResult, PaperItem } from './types.js';
export { findZoteroDataDir, ingestZoteroSqlite } from './zoteroSqlite.js';

/**
 * Auto-detects how to read the library and returns its items. Order:
 *   1. Direct sqlite read (works with Zotero closed) — preferred and most complete.
 *   2. Zotero local HTTP API (if Zotero is running and the sqlite file wasn't found).
 * A future connector will handle the Zotero Web API and folders of PDFs.
 */
export async function ingest(opts: { zoteroDir?: string } = {}): Promise<IngestResult> {
  if (opts.zoteroDir || findZoteroDataDir()) {
    return ingestZoteroSqlite(opts.zoteroDir);
  }
  if (await localApiAvailable()) {
    return ingestZoteroLocalApi();
  }
  throw new Error(
    'No library found. Open Zotero (with the local API enabled) or set PAPER_ATLAS_ZOTERO_DIR ' +
      'to your Zotero data directory.',
  );
}
