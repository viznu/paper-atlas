import { useEffect, useState } from 'react';
import { fetchWorks } from '../api';
import { subfieldGaps } from '../nav';
import Discover from './Discover';
import type { Basemap, Focus, LibraryEntry, Overlay, WorkSummary } from '../types';

/**
 * The user's own papers placed here — a collapsible dropdown (kept out of the way, since the
 * field/topic structure is the star), still available even when OpenAlex is rate-limited.
 */
function LibraryHere({ items }: { items: LibraryEntry[] }) {
  if (!items.length) return null;
  return (
    <details className="mine-details">
      <summary>
        In your library here <span className="mine-badge">{items.length}</span>
      </summary>
      <div className="mine-list">
        {items.map((it) => {
          const href = it.zoteroKey
            ? `zotero://select/library/items/${it.zoteroKey}`
            : undefined;
          const Row = href ? 'a' : 'div';
          return (
            <Row key={it.key} className="mine-item" {...(href ? { href } : {})}>
              <div className="mine-title">{it.title}</div>
              <div className="mine-meta">
                {it.authors[0] ?? ''}
                {it.authors.length > 1 ? ' et al.' : ''}
                {it.year ? ` · ${it.year}` : ''}
              </div>
            </Row>
          );
        })}
      </div>
    </details>
  );
}

function PaperList({ kind, id }: { kind: 'subfield' | 'topic'; id: string }) {
  const [mode, setMode] = useState<'top' | 'recent'>('top');
  const [works, setWorks] = useState<WorkSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);

  useEffect(() => {
    let live = true;
    setWorks(null);
    setError(false);
    setRateLimited(false);
    fetchWorks(kind, id, mode)
      .then((r) => {
        if (!live) return;
        setRateLimited(r.rateLimited);
        setWorks(r.works);
      })
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [kind, id, mode]);

  return (
    <div className="paper-list">
      <div className="tabs">
        {(['top', 'recent'] as const).map((m) => (
          <button key={m} className={m === mode ? 'tab active' : 'tab'} onClick={() => setMode(m)}>
            {m === 'top' ? 'Most cited' : 'Recent'}
          </button>
        ))}
      </div>
      {error && <p className="muted">Could not load papers (OpenAlex unreachable).</p>}
      {rateLimited && (
        <p className="muted">
          OpenAlex daily limit reached — papers will load again after the midnight-UTC reset.
          Cached views still work.
        </p>
      )}
      {!works && !error && <p className="muted">Loading papers…</p>}
      {works?.map((w) => (
        <a
          key={w.id}
          className="paper"
          href={w.doi ?? w.openAccessUrl ?? `https://openalex.org/${w.id}`}
          target="_blank"
          rel="noreferrer"
        >
          <div className="paper-title">{w.title}</div>
          <div className="paper-meta">
            {w.authors[0] ?? '?'}
            {w.authors.length > 1 ? ' et al.' : ''} · {w.year ?? '—'}
            {w.venue ? ` · ${w.venue}` : ''} · {w.citedBy.toLocaleString()} citations
          </div>
        </a>
      ))}
    </div>
  );
}

interface Props {
  basemap: Basemap;
  focus: Focus | null;
  overlay: Overlay | null;
  onNavigate: (focus: Focus) => void;
  onClose: () => void;
}

export default function DetailPanel({ basemap, focus, overlay, onNavigate, onClose }: Props) {
  if (!focus || focus.kind === 'field') return null;

  if (focus.kind === 'subfield') {
    const sf = basemap.subfields.find((s) => s.id === focus.id);
    if (!sf) return null;
    const field = basemap.fields.find((f) => f.id === sf.field);
    const mine = overlay?.itemsBySubfield[sf.id] ?? [];
    const topics = basemap.topics
      .filter((t) => t.subfield === sf.id)
      .sort((a, b) => b.worksCount - a.worksCount);
    return (
      <aside className="panel">
        <button className="close" onClick={onClose}>
          ×
        </button>
        <button className="crumb linklike" onClick={() => field && onNavigate({ kind: 'field', id: field.id })}>
          ‹ {field?.name}
        </button>
        <h2>{sf.name}</h2>
        <p className="muted">
          {sf.worksCount.toLocaleString()} works in OpenAlex
          {mine.length > 0 && ` · ${mine.length} in your library`}
          {sf.wikipedia && (
            <>
              {' · '}
              <a href={sf.wikipedia} target="_blank" rel="noreferrer">
                Wikipedia
              </a>
            </>
          )}
        </p>
        <h3 className="explore">Discover</h3>
        <Discover
          gaps={overlay ? subfieldGaps(sf.id, basemap, overlay.coverage) : []}
          arxivQuery={sf.name}
          onNavigate={onNavigate}
        />
        <h3>Cites into / cited by</h3>
        <div className="chips">
          {sf.neighbors.slice(0, 8).map((n) => {
            const nb = basemap.subfields.find((s) => s.id === n.id);
            return (
              nb && (
                <button
                  key={n.id}
                  className="chip"
                  onClick={() => onNavigate({ kind: 'subfield', id: n.id })}
                >
                  {nb.name}
                </button>
              )
            );
          })}
        </div>
        <h3>Topics ({topics.length})</h3>
        <div className="chips">
          {topics.slice(0, 16).map((t) => (
            <button
              key={t.id}
              className="chip subtle"
              onClick={() => onNavigate({ kind: 'topic', id: t.id })}
            >
              {t.name}
            </button>
          ))}
        </div>
        <LibraryHere items={mine} />
        <h3>Papers</h3>
        <PaperList kind="subfield" id={sf.id} />
      </aside>
    );
  }

  const topic = basemap.topics.find((t) => t.id === focus.id);
  if (!topic) return null;
  const sf = basemap.subfields.find((s) => s.id === topic.subfield);
  const mine = overlay?.itemsByTopic[topic.id] ?? [];
  return (
    <aside className="panel">
      <button className="close" onClick={onClose}>
        ×
      </button>
      <button
        className="crumb linklike"
        onClick={() => sf && onNavigate({ kind: 'subfield', id: sf.id })}
      >
        ‹ {sf?.name}
      </button>
      <h2>{topic.name}</h2>
      <p className="muted">
        {topic.worksCount.toLocaleString()} works
        {mine.length > 0 && ` · ${mine.length} in your library`}
        {topic.wikipedia && (
          <>
            {' · '}
            <a href={topic.wikipedia} target="_blank" rel="noreferrer">
              Wikipedia
            </a>
          </>
        )}
      </p>
      {topic.summary && <p className="summary">{topic.summary}…</p>}
      {topic.keywords.length > 0 && (
        <>
          <h3>Keywords</h3>
          <div className="chips">
            {topic.keywords.map((kw) => (
              <span key={kw} className="tag">
                {kw}
              </span>
            ))}
          </div>
        </>
      )}
      <h3 className="explore">Discover</h3>
      <Discover gaps={[]} arxivQuery={topic.name} onNavigate={onNavigate} />
      <LibraryHere items={mine} />
      <h3>All papers in this topic</h3>
      <PaperList kind="topic" id={topic.id} />
    </aside>
  );
}
