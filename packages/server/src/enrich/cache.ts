import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Location of paper-atlas's own state (cache, config). Override with PAPER_ATLAS_HOME. */
export function atlasHome(): string {
  const dir = process.env.PAPER_ATLAS_HOME ?? join(homedir(), '.paper-atlas');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Persistent cache of OpenAlex enrichment, keyed by the library item key. Lets re-syncs skip
 * items already resolved. Stored as JSON blobs so the schema can evolve without migrations.
 */
export class EnrichCache {
  private db: DatabaseSync;

  constructor(path = join(atlasHome(), 'cache.db')) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS enrichment (
        itemKey TEXT PRIMARY KEY,
        matchMethod TEXT,        -- 'doi' | 'arxiv' | 'title' | 'none'
        confidence REAL,
        work TEXT,               -- JSON WorkRecord, or NULL when unmatched
        updatedAt INTEGER
      );
    `);
  }

  get(itemKey: string): { matchMethod: string; confidence: number; work: unknown | null } | null {
    const row = this.db
      .prepare('SELECT matchMethod, confidence, work FROM enrichment WHERE itemKey = ?')
      .get(itemKey) as { matchMethod: string; confidence: number; work: string | null } | undefined;
    if (!row) return null;
    return {
      matchMethod: row.matchMethod,
      confidence: row.confidence,
      work: row.work ? JSON.parse(row.work) : null,
    };
  }

  set(
    itemKey: string,
    matchMethod: string,
    confidence: number,
    work: unknown | null,
  ): void {
    this.db
      .prepare(
        `INSERT INTO enrichment (itemKey, matchMethod, confidence, work, updatedAt)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(itemKey) DO UPDATE SET
           matchMethod = excluded.matchMethod,
           confidence = excluded.confidence,
           work = excluded.work,
           updatedAt = excluded.updatedAt`,
      )
      .run(itemKey, matchMethod, confidence, work ? JSON.stringify(work) : null, Date.now());
  }

  close(): void {
    this.db.close();
  }
}
