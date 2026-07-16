import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { atlasHome } from './enrich/cache.js';
import type { SummaryCards } from './llm.js';

/**
 * The unified, RAG-ready paper store (`~/.paper-atlas/papers.db`). One row per paper, accumulated
 * as you browse: metadata + abstract, the generated summary (so it's produced once and re-read
 * from disk — never regenerated), and a reserved embedding column for future semantic search /
 * retrieval. This is the store-of-record the feeds and any RAG layer read from; the OpenAlex/S2
 * response caches remain separate request-level caches.
 */
/** The four feed tabs, each backed by its own table. */
export const FEED_TABLES = {
  fresh: 'feed_fresh',
  claude: 'feed_claude',
  citations: 'feed_citations',
  phd: 'feed_phd',
} as const;
export type FeedTab = keyof typeof FEED_TABLES;

/** Local (not UTC) YYYY-MM-DD — the feed is "a day" in the reader's timezone. */
export function todayStr(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface StoredSummary {
  model: string;
  cards: SummaryCards;
  at: number;
}
export interface PaperMeta {
  id: string; // OpenAlex W-id or "arxiv:<id>"
  doi?: string | null;
  arxivId?: string | null;
  title?: string | null;
  year?: number | null;
  authors?: string[];
  venue?: string | null;
  topic?: string | null;
  abstract?: string | null;
}

export class PaperStore {
  private db: DatabaseSync;

  constructor(path = join(atlasHome(), 'papers.db')) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS papers (
        id            TEXT PRIMARY KEY,
        doi           TEXT,
        arxiv_id      TEXT,
        title         TEXT,
        year          INTEGER,
        authors       TEXT,   -- JSON string[]
        venue         TEXT,
        topic         TEXT,
        abstract      TEXT,
        summary_model TEXT,
        summary_json  TEXT,   -- JSON SummaryCards
        summary_at    INTEGER,
        embedding     BLOB,   -- reserved: Float32 vector for RAG
        embedding_model TEXT,
        updated_at    INTEGER
      );
    `);
    // One table per feed tab (the user's design: separate tables), each holding DATED snapshots so
    // past days' feeds stay addressable. One-time migration: drop pre-date tables, recreate dated.
    for (const t of Object.values(FEED_TABLES)) {
      const cols = this.db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[];
      if (cols.length && !cols.some((c) => c.name === 'date')) this.db.exec(`DROP TABLE ${t}`);
      this.db.exec(
        `CREATE TABLE IF NOT EXISTS ${t} (date TEXT, id TEXT, rank INTEGER, data TEXT, at INTEGER, PRIMARY KEY (date, id))`,
      );
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS feedback (
        paper_id TEXT, feed TEXT, signal TEXT, title TEXT, at INTEGER,
        PRIMARY KEY (paper_id, feed)
      );
    `);
    // Papers the reader has marked as read (across any feed / the detail view).
    this.db.exec(`CREATE TABLE IF NOT EXISTS reads (paper_id TEXT PRIMARY KEY, at INTEGER)`);
  }

  /** Replace one date's snapshot of a feed tab with a freshly-ranked list (default: today). */
  setFeed(tab: FeedTab, items: { id: string; data: unknown }[], date = todayStr()): void {
    const table = FEED_TABLES[tab];
    const now = Date.now();
    this.db.prepare(`DELETE FROM ${table} WHERE date = ?`).run(date);
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO ${table} (date, id, rank, data, at) VALUES (?, ?, ?, ?, ?)`,
    );
    items.forEach((it, i) => stmt.run(date, it.id, i, JSON.stringify(it.data), now));
  }

  /** The dates a feed tab has snapshots for, newest first. */
  feedDates(tab: FeedTab): string[] {
    const rows = this.db
      .prepare(`SELECT DISTINCT date FROM ${FEED_TABLES[tab]} ORDER BY date DESC`)
      .all() as { date: string }[];
    return rows.map((r) => r.date);
  }

  /**
   * Read a feed tab for a given date (default: the latest snapshot available). Returns the chosen
   * date, when it was generated, the items, and the list of available dates for a date picker.
   */
  getFeed(tab: FeedTab, date?: string): { date: string | null; generatedAt: number | null; items: any[]; dates: string[] } {
    const table = FEED_TABLES[tab];
    const dates = this.feedDates(tab);
    const use = date && dates.includes(date) ? date : (dates[0] ?? null);
    if (!use) return { date: null, generatedAt: null, items: [], dates };
    const rows = this.db
      .prepare(`SELECT data, at FROM ${table} WHERE date = ? ORDER BY rank ASC`)
      .all(use) as { data: string; at: number }[];
    return {
      date: use,
      generatedAt: rows[0]?.at ?? null,
      items: rows.map((r) => JSON.parse(r.data)),
      dates,
    };
  }

  /** Mark a paper read / unread. */
  markRead(paperId: string, read: boolean): void {
    if (read)
      this.db
        .prepare('INSERT INTO reads (paper_id, at) VALUES (?, ?) ON CONFLICT(paper_id) DO NOTHING')
        .run(paperId, Date.now());
    else this.db.prepare('DELETE FROM reads WHERE paper_id = ?').run(paperId);
  }

  /** Ids of all papers marked read. */
  readIds(): string[] {
    return (this.db.prepare('SELECT paper_id FROM reads').all() as { paper_id: string }[]).map(
      (r) => r.paper_id,
    );
  }

  /** Record a reader signal on a paper within a feed ('more' | 'less'). Title powers term-boosting. */
  addFeedback(paperId: string, feed: string, signal: string, title?: string | null): void {
    this.db
      .prepare(
        `INSERT INTO feedback (paper_id, feed, signal, title, at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(paper_id, feed) DO UPDATE SET signal=excluded.signal, title=excluded.title, at=excluded.at`,
      )
      .run(paperId, feed, signal, title ?? null, Date.now());
  }

  /** All feedback signals (across tabs), for the UI to reflect current 👍/👎 state. */
  allFeedback(): { paperId: string; feed: string; signal: string }[] {
    const rows = this.db.prepare('SELECT paper_id, feed, signal FROM feedback').all() as {
      paper_id: string;
      feed: string;
      signal: string;
    }[];
    return rows.map((r) => ({ paperId: r.paper_id, feed: r.feed, signal: r.signal }));
  }

  /**
   * The learned "more/less like this" profile: ids to hide (marked 'less'), and title terms to
   * boost (from papers marked 'more'). Feeds fold this into ranking so the feed adapts to taste.
   */
  feedbackProfile(): { boost: string[]; hide: Set<string> } {
    const rows = this.db.prepare('SELECT paper_id, signal, title FROM feedback').all() as {
      paper_id: string;
      signal: string;
      title: string | null;
    }[];
    const hide = new Set<string>();
    const boost: string[] = [];
    for (const r of rows) {
      if (r.signal === 'less') hide.add(r.paper_id);
      if (r.signal === 'more' && r.title) {
        boost.push(
          ...r.title.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 4),
        );
      }
    }
    return { boost, hide };
  }

  /** Insert or refresh a paper's metadata without ever clobbering an existing summary/embedding. */
  upsertMeta(p: PaperMeta): void {
    this.db
      .prepare(
        `INSERT INTO papers (id, doi, arxiv_id, title, year, authors, venue, topic, abstract, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           doi=coalesce(excluded.doi, doi),
           arxiv_id=coalesce(excluded.arxiv_id, arxiv_id),
           title=coalesce(excluded.title, title),
           year=coalesce(excluded.year, year),
           authors=coalesce(excluded.authors, authors),
           venue=coalesce(excluded.venue, venue),
           topic=coalesce(excluded.topic, topic),
           abstract=coalesce(excluded.abstract, abstract),
           updated_at=excluded.updated_at`,
      )
      .run(
        p.id,
        p.doi ?? null,
        p.arxivId ?? null,
        p.title ?? null,
        p.year ?? null,
        p.authors ? JSON.stringify(p.authors) : null,
        p.venue ?? null,
        p.topic ?? null,
        p.abstract ?? null,
        Date.now(),
      );
  }

  /** A stored summary for this paper produced by `model`, or null (→ caller generates it). */
  getSummary(id: string, model: string): StoredSummary | null {
    const row = this.db
      .prepare('SELECT summary_model, summary_json, summary_at FROM papers WHERE id = ?')
      .get(id) as { summary_model: string | null; summary_json: string | null; summary_at: number | null } | undefined;
    if (!row?.summary_json || row.summary_model !== model) return null;
    return {
      model: row.summary_model,
      cards: JSON.parse(row.summary_json) as SummaryCards,
      at: row.summary_at ?? 0,
    };
  }

  /** Persist a generated summary so it's never regenerated. Upserts the row if metadata isn't there yet. */
  setSummary(id: string, model: string, cards: SummaryCards): void {
    this.db
      .prepare(
        `INSERT INTO papers (id, summary_model, summary_json, summary_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           summary_model=excluded.summary_model,
           summary_json=excluded.summary_json,
           summary_at=excluded.summary_at,
           updated_at=excluded.updated_at`,
      )
      .run(id, model, JSON.stringify(cards), Date.now(), Date.now());
  }

  /** Papers in the given feeds (for a date) that don't yet have a stored summary — the daily task's worklist. */
  pendingSummaries(tabs: FeedTab[], date?: string): { id: string; title: string; abstract: string | null }[] {
    const out: { id: string; title: string; abstract: string | null }[] = [];
    const seen = new Set<string>();
    for (const tab of tabs) {
      for (const it of this.getFeed(tab, date).items) {
        if (seen.has(it.id)) continue;
        seen.add(it.id);
        const row = this.db.prepare('SELECT summary_json FROM papers WHERE id = ?').get(it.id) as
          | { summary_json: string | null }
          | undefined;
        if (row?.summary_json) continue;
        out.push({ id: it.id, title: it.title, abstract: it.summary ?? null });
      }
    }
    return out;
  }

  /** Row count — handy for a "N papers stored" indicator. */
  count(): number {
    const r = this.db.prepare('SELECT COUNT(*) AS n FROM papers').get() as { n: number };
    return r.n;
  }
}

let store: PaperStore | null = null;
/** Process-wide singleton (node:sqlite is single-connection; fine for the local single-user server). */
export function paperStore(): PaperStore {
  if (!store) store = new PaperStore();
  return store;
}
