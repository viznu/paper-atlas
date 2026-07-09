import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractArxivId } from './arxiv.js';
import type { IngestResult, PaperItem } from './types.js';

/** Item types that are references (everything else — attachments, notes — is excluded). */
const EXCLUDED_TYPES = new Set(['attachment', 'note', 'annotation']);

/**
 * Locates the Zotero data directory. Zotero stores a custom path in the profile's prefs.js
 * (extensions.zotero.dataDir); otherwise it defaults to ~/Zotero. PAPER_ATLAS_ZOTERO_DIR
 * overrides everything.
 */
export function findZoteroDataDir(): string | null {
  if (process.env.PAPER_ATLAS_ZOTERO_DIR) return process.env.PAPER_ATLAS_ZOTERO_DIR;

  const home = homedir();
  const profileRoots = [
    join(home, 'Library', 'Application Support', 'Zotero', 'Profiles'), // macOS
    join(home, '.zotero', 'zotero'), // Linux
    join(process.env.APPDATA ?? '', 'Zotero', 'Zotero', 'Profiles'), // Windows
  ].filter((p) => p && existsSync(p));

  for (const root of profileRoots) {
    let profiles: string[] = [];
    try {
      profiles = readdirSync(root);
    } catch {
      continue;
    }
    for (const prof of profiles) {
      const prefs = join(root, prof, 'prefs.js');
      if (!existsSync(prefs)) continue;
      const m = readFileSync(prefs, 'utf8').match(
        /user_pref\("extensions\.zotero\.dataDir",\s*"([^"]+)"\)/,
      );
      if (m?.[1] && existsSync(join(m[1], 'zotero.sqlite'))) return m[1];
    }
  }

  const fallback = join(home, 'Zotero');
  return existsSync(join(fallback, 'zotero.sqlite')) ? fallback : null;
}

/**
 * Reads a Zotero library directly from its sqlite database. Works whether or not Zotero is
 * running: the file is copied to a temp location first, then opened read-only, so the live
 * database is never touched or locked.
 */
export function ingestZoteroSqlite(dataDir?: string): IngestResult {
  const dir = dataDir ?? findZoteroDataDir();
  if (!dir) throw new Error('Could not locate a Zotero data directory. Set PAPER_ATLAS_ZOTERO_DIR.');
  const dbPath = join(dir, 'zotero.sqlite');
  if (!existsSync(dbPath)) throw new Error(`No zotero.sqlite in ${dir}`);

  const tmp = join(mkdtempSync(join(tmpdir(), 'paper-atlas-')), 'zotero.sqlite');
  copyFileSync(dbPath, tmp);
  const db = new DatabaseSync(tmp, { readOnly: true });

  try {
    // Base rows: top-level reference items, excluding trashed ones.
    const rows = db
      .prepare(
        `SELECT i.itemID AS itemID, i.key AS key, it.typeName AS typeName
         FROM items i
         JOIN itemTypes it ON it.itemTypeID = i.itemTypeID
         WHERE i.itemID NOT IN (SELECT itemID FROM deletedItems)
           AND it.typeName NOT IN ('attachment','note','annotation')`,
      )
      .all() as { itemID: number; key: string; typeName: string }[];

    // All field values in one pass, keyed by itemID.
    const fieldRows = db
      .prepare(
        `SELECT id.itemID AS itemID, f.fieldName AS fieldName, idv.value AS value
         FROM itemData id
         JOIN fields f ON f.fieldID = id.fieldID
         JOIN itemDataValues idv ON idv.valueID = id.valueID`,
      )
      .all() as { itemID: number; fieldName: string; value: string }[];
    const fields = new Map<number, Record<string, string>>();
    for (const r of fieldRows) {
      const rec = fields.get(r.itemID) ?? {};
      rec[r.fieldName] = r.value;
      fields.set(r.itemID, rec);
    }

    // Creators (ordered).
    const creatorRows = db
      .prepare(
        `SELECT ic.itemID AS itemID, c.lastName AS lastName, c.firstName AS firstName
         FROM itemCreators ic
         JOIN creators c ON c.creatorID = ic.creatorID
         ORDER BY ic.itemID, ic.orderIndex`,
      )
      .all() as { itemID: number; lastName: string | null; firstName: string | null }[];
    const creators = new Map<number, string[]>();
    for (const r of creatorRows) {
      const name = [r.lastName, r.firstName].filter(Boolean).join(', ') || (r.lastName ?? '');
      if (!name) continue;
      creators.set(r.itemID, [...(creators.get(r.itemID) ?? []), name]);
    }

    // Collections per item.
    const collRows = db
      .prepare(
        `SELECT ci.itemID AS itemID, col.collectionName AS name
         FROM collectionItems ci
         JOIN collections col ON col.collectionID = ci.collectionID`,
      )
      .all() as { itemID: number; name: string }[];
    const collections = new Map<number, string[]>();
    for (const r of collRows) {
      collections.set(r.itemID, [...(collections.get(r.itemID) ?? []), r.name]);
    }

    // Tags per item.
    const tagRows = db
      .prepare(
        `SELECT it.itemID AS itemID, t.name AS name
         FROM itemTags it
         JOIN tags t ON t.tagID = it.tagID`,
      )
      .all() as { itemID: number; name: string }[];
    const tags = new Map<number, string[]>();
    for (const r of tagRows) {
      tags.set(r.itemID, [...(tags.get(r.itemID) ?? []), r.name]);
    }

    // Child attachment paths (filenames carry arXiv ids like 2310.01405v4.pdf).
    const attachRows = db
      .prepare(
        `SELECT ia.parentItemID AS parentID, ia.path AS path
         FROM itemAttachments ia
         WHERE ia.parentItemID IS NOT NULL AND ia.path IS NOT NULL`,
      )
      .all() as { parentID: number; path: string }[];
    const attachments = new Map<number, string[]>();
    for (const r of attachRows) {
      attachments.set(r.parentID, [...(attachments.get(r.parentID) ?? []), r.path]);
    }

    const items: PaperItem[] = rows
      .filter((r) => !EXCLUDED_TYPES.has(r.typeName))
      .map((r) => {
        const f = fields.get(r.itemID) ?? {};
        const doi = f.DOI ?? null;
        const url = f.url ?? null;
        const arxivId = extractArxivId({
          doi,
          url,
          extra: f.extra ?? null,
          attachmentPaths: attachments.get(r.itemID),
        });
        const yearMatch = (f.date ?? '').match(/\d{4}/);
        return {
          key: r.key,
          zoteroKey: r.key,
          title: f.title ?? f.caseName ?? f.subject ?? '(untitled)',
          creators: creators.get(r.itemID) ?? [],
          year: yearMatch ? Number(yearMatch[0]) : null,
          doi,
          arxivId,
          url,
          itemType: r.typeName,
          venue:
            f.publicationTitle ??
            f.proceedingsTitle ??
            f.conferenceName ??
            f.bookTitle ??
            f.publisher ??
            null,
          collections: collections.get(r.itemID) ?? [],
          tags: tags.get(r.itemID) ?? [],
        } satisfies PaperItem;
      });

    return { source: 'zotero-sqlite', library: dir, items };
  } finally {
    db.close();
  }
}
