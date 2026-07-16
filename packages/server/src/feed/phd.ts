import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openalexRaw, reconstructAbstract, stripMarkup } from '../openalex.js';
import { RateLimitError } from '../enrich/apiCache.js';
import { atlasHome } from '../enrich/cache.js';
import { paperStore } from '../store.js';
import type { FeedEntry } from './types.js';

/**
 * PhD-faculty targets: the people whose recent papers you want to follow (e.g. potential advisors
 * at programs you're applying to). Each is resolved to an OpenAlex author and their recent works
 * are pulled into the "PhD faculty" tab. Edit the list — including the `why` note shown on each
 * card — in ~/.paper-atlas/phd-faculty.json (created with the examples below on first run).
 */
interface Faculty {
  name: string;
  institution: string;
  instMatch: string; // substring to disambiguate the OpenAlex author by institution
  why: string;
}
const DEFAULT_FACULTY: Faculty[] = [
  { name: 'Yoshua Bengio', institution: 'Université de Montréal / Mila', instMatch: 'montr', why: 'Foundational deep learning and AI safety.' },
  { name: 'Percy Liang', institution: 'Stanford University', instMatch: 'stanford', why: 'Foundation models, evaluation, robustness.' },
  { name: 'Been Kim', institution: 'Google DeepMind', instMatch: 'deepmind', why: 'Interpretability and human-centred ML.' },
];

/** Load the faculty list from local config (seeding the example defaults on first run). */
function loadFaculty(): Faculty[] {
  const path = join(atlasHome(), 'phd-faculty.json');
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify(DEFAULT_FACULTY, null, 2));
    return DEFAULT_FACULTY;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Faculty[];
  } catch {
    return DEFAULT_FACULTY;
  }
}

const WORK_FIELDS =
  'id,doi,display_name,publication_year,cited_by_count,primary_topic,authorships,primary_location,open_access,abstract_inverted_index';

async function resolveAuthorId(f: Faculty): Promise<string | null> {
  const data: any = await openalexRaw(`/authors?search=${encodeURIComponent(f.name)}&per_page=5`);
  const results: any[] = data.results ?? [];
  const instHit = (a: any) =>
    (a.last_known_institutions ?? a.affiliations?.map((x: any) => x.institution) ?? []).some(
      (i: any) => (i?.display_name ?? '').toLowerCase().includes(f.instMatch),
    );
  const pick = results.find(instHit) ?? results[0];
  return pick?.id ? (pick.id as string).replace('https://openalex.org/', '') : null;
}

const shorten = (s: string | null, n = 260) => (s && s.length > n ? s.slice(0, n) + '…' : s);

export interface PhdFeedResult {
  count: number;
  faculty: number;
  rateLimited: boolean;
}

/** Build the PhD-faculty feed: recent works of each target professor. Budget-aware (partial on limit). */
export async function generatePhdFeed(): Promise<PhdFeedResult> {
  const FACULTY = loadFaculty();
  const { hide } = paperStore().feedbackProfile();
  const entries: FeedEntry[] = [];
  const seen = new Set<string>();
  const seenTitles = new Set<string>(); // collapse preprint+published duplicates
  const normTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  let rateLimited = false;

  outer: for (const f of FACULTY) {
    try {
      const authorId = await resolveAuthorId(f);
      if (!authorId) continue;
      const data: any = await openalexRaw(
        `/works?filter=author.id:${authorId}&sort=publication_date:desc&per_page=5&select=${WORK_FIELDS}`,
      );
      for (const w of data.results ?? []) {
        const id = (w.id as string).replace('https://openalex.org/', '');
        const nt = normTitle(w.display_name ?? '');
        if (seen.has(id) || hide.has(id) || (nt && seenTitles.has(nt))) continue;
        seen.add(id);
        if (nt) seenTitles.add(nt);
        entries.push({
          id,
          title: w.display_name ? stripMarkup(w.display_name) : '(untitled)',
          authors: (w.authorships ?? []).slice(0, 6).map((a: any) => a.author?.display_name ?? '?'),
          year: w.publication_year ?? null,
          summary: shorten(reconstructAbstract(w.abstract_inverted_index)) ?? w.primary_topic?.display_name ?? null,
          doi: w.doi ?? null,
          url: w.doi ?? `https://openalex.org/${id}`,
          pdf: w.open_access?.oa_url ?? null,
          citedBy: w.cited_by_count ?? 0,
          faculty: f.name,
          institution: f.institution,
          reason: f.why,
        });
      }
    } catch (err) {
      if (err instanceof RateLimitError) {
        rateLimited = true;
        break outer;
      }
      // skip this faculty on a transient error
    }
  }

  paperStore().setFeed(
    'phd',
    entries.map((e) => ({ id: e.id, data: e })),
  );
  return { count: entries.length, faculty: FACULTY.length, rateLimited };
}
