import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { atlasHome } from './cache.js';

/**
 * Persistent key/value cache for OpenAlex API responses, so repeat views (and re-runs) cost
 * no budget. Kept in its own sqlite file to avoid write contention with the enrichment cache.
 * Entries never hard-expire — scholarly metadata is stable and stale-but-present beats an
 * error when a user has hit their daily OpenAlex budget.
 */
export class ApiCache {
  private db: DatabaseSync;

  constructor(path = join(atlasHome(), 'api-cache.db')) {
    this.db = new DatabaseSync(path);
    this.db.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, at INTEGER)');
  }

  get(key: string): unknown | undefined {
    const row = this.db.prepare('SELECT v FROM kv WHERE k = ?').get(key) as
      | { v: string }
      | undefined;
    return row ? JSON.parse(row.v) : undefined;
  }

  set(key: string, value: unknown): void {
    this.db
      .prepare('INSERT INTO kv (k, v, at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, at=excluded.at')
      .run(key, JSON.stringify(value), Date.now());
  }
}

/** Thrown when OpenAlex refuses a request because the caller is out of daily budget/credits. */
export class RateLimitError extends Error {
  constructor(public retryAfterSeconds: number | null) {
    super('OpenAlex daily budget exhausted');
    this.name = 'RateLimitError';
  }
}
