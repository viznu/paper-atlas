# paper-atlas

**Work in progress.** A local tool for exploring a map of science and reading
against it.

paper-atlas renders an interactive atlas of research fields, subfields, and
topics, where neighbouring territories are the areas that most cite each other,
and overlays a personal reference library (a [Zotero](https://www.zotero.org)
library) on top of it to show which territories it covers and which nearby ones
it does not. On the same data it builds a **Reading Desk** — a set of paper
feeds for discovering what to read next.

The field/subfield/topic structure and citation data come from
[OpenAlex](https://openalex.org), an open catalogue of the global research
system that was built by citation-clustering tens of millions of works, so
"neighbouring = most-cited-from" is native to it. Everything runs locally; no
account is required, and the core works with no API keys.

This is an "overlay map of science" (a technique from bibliometrics) applied to
a *personal* library, packaged as a local app.

---

## What it does

- **Atlas** — a honeycomb map of the ~250 subfields and ~4,500 topics of
  science, coloured by field, laid out so citation-neighbours sit together. A
  Zotero library is projected onto it: covered territories brighten, and
  "frontier" territories (heavily cited by covered areas but under-read) are
  surfaced as suggestions.
- **Reading Desk** — a paper feed with four tabs:
  - **Fresh** — new [arXiv](https://arxiv.org) papers at the intersection of a
    configured interest profile and the library's own topics.
  - **Recommended** — a curated feed built from configurable research *themes*
    (search terms plus a short rationale shown on each card).
  - **From your citations** — works the library cites most often but does not
    own, ranked by how many library papers cite them.
  - **Faculty** — recent papers from a configurable list of researchers (for
    example, potential PhD advisors), resolved through OpenAlex.
- **Paper detail** — for any paper, its references are drawn as a vertical,
  year-sorted timeline; where [Semantic Scholar](https://www.semanticscholar.org)
  has them, the sentences in which the paper cites each reference are shown.
- **Summaries** — an optional five-card summary per paper (problem, contribution,
  results, limitations, future work). Disabled by default; see *Summaries* below.
- **Feedback and read state** — 👍/👎 on any feed card ("more/less like this")
  feeds back into ranking, and papers can be marked read. Feeds are stored per
  day and are addressable by date.

---

## Requirements

- **Node.js 22.12+** (uses the built-in `node:sqlite` module).
- Optional: a **Zotero** installation, for the library overlay and the
  citation-based feeds. paper-atlas reads the local Zotero database directly and
  works whether Zotero is open or closed.
- Optional: an **OpenAI API key**, only for the paper summaries.

No API key is needed for the atlas, the arXiv feeds, or the citation feeds.

---

## Getting started

```sh
git clone https://github.com/viznu/paper-atlas.git
cd paper-atlas
npm install
```

### Run in development (two processes)

```sh
# terminal 1 — the API server (Fastify) on http://localhost:4517
OPENALEX_MAILTO=you@example.com npm run dev:server

# terminal 2 — the web app (Vite) on http://localhost:5183
npm run dev:web
```

Then open **http://localhost:5183**. Setting `OPENALEX_MAILTO` is optional but
joins OpenAlex's faster "polite pool".

### Run as a single server (built)

```sh
npm run build
OPENALEX_MAILTO=you@example.com node packages/server/dist/cli.js
```

This serves the built UI and the API together on http://localhost:4517.

### First use

The atlas renders immediately from committed base-map data. If a Zotero library
is present it is detected automatically; the **Reading Desk** tabs are populated
by pressing **generate**/**refresh** on each tab (or by the daily job below).

---

## Configuration

Local state and config live in `~/.paper-atlas/` (override with
`PAPER_ATLAS_HOME`). Three JSON files there are created with example defaults on
first run and are meant to be edited:

| File | Controls |
|---|---|
| `interests.json` | arXiv categories and interest term-groups for the **Fresh** feed, plus how much library topics are weighted. |
| `claude-themes.json` | The research themes (label, search terms, rationale) behind the **Recommended** feed. |
| `phd-faculty.json` | The researchers behind the **Faculty** feed (name, institution, and a note shown on each card). |

Also in `~/.paper-atlas/`: `cache.db`, `api-cache.db`, `s2-cache.db` (response
caches) and `papers.db` (the paper store — metadata, summaries, per-day feeds,
feedback, and read state).

### Summaries (optional, off by default)

Summaries are disabled unless explicitly enabled. To turn them on with OpenAI:

```sh
export OPENAI_API_KEY=sk-...
export PAPER_ATLAS_LLM=real          # otherwise placeholder summaries are shown
export OPENAI_MODEL=gpt-4o           # optional; default gpt-4o
```

Each summary is generated once and stored in `papers.db`, so it is not
regenerated on later views. Without `PAPER_ATLAS_LLM=real`, the app shows clearly
labelled placeholder summaries and makes no API calls.

### Daily feed refresh

The feeds can be regenerated from the command line:

```sh
node packages/server/dist/cli.js feed      # regenerate the arXiv feeds (no API budget used)
node packages/server/dist/cli.js daily     # regenerate every feed and list papers needing a summary
```

On macOS this can be scheduled with a LaunchAgent so a fresh feed is ready each
morning. The arXiv-based feeds cost nothing; the citation and faculty feeds use
OpenAlex.

---

## Data sources

- **OpenAlex** — the taxonomy, the base map, citation data, and paper metadata.
  Free and keyless. OpenAlex enforces a modest daily request budget; responses
  are cached on disk, and when the budget is exhausted the app degrades to
  cached data rather than failing.
- **arXiv** — fresh preprints for the discovery feeds. Free.
- **Semantic Scholar** — citation-context sentences for the reference timeline.
  Free and best-effort (see limitations).
- **OpenAI** — optional, only for summaries.

---

## Scope and limitations

- **Library matching is imperfect.** Library items are matched to OpenAlex by
  DOI, then arXiv id, then a title search. Title matching can produce false
  positives, and items OpenAlex does not index are left unplaced.
- **The base map is a snapshot.** It is precomputed and committed; it does not
  update as OpenAlex changes, and it ships as a reduced sample rather than the
  full taxonomy.
- **Citation contexts are partial.** Semantic Scholar only has them for papers
  whose full text it has parsed, and its keyless API is rate-limited; many
  papers (older or closed-access) show a reference timeline with no context
  sentences.
- **The feeds are heuristic.** They rank by keyword/topic match, freshness, and
  feedback — not by a learned model — and are intended as discovery aids, not
  authoritative recommendations.
- **Summaries reflect the abstract only** and are optional; placeholder text is
  shown until they are enabled.
- **Coverage bias.** OpenAlex, arXiv, and Semantic Scholar each under-represent
  parts of the literature, and the map inherits those biases.

---

## Development

```sh
npm run typecheck    # type-check both packages
npm run build        # build web + server, bundle the UI into the server
npm test             # unit tests (vitest)
```

The monorepo has two workspaces: `packages/server` (Node + Fastify API and CLI)
and `packages/web` (Vite + React). Base-map data lives in
`packages/basemap-data` and can be regenerated with `npm run basemap`.

## License

MIT.
