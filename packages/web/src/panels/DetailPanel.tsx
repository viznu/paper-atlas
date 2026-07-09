import { useEffect, useState } from 'react';
import { fetchWorks } from '../api';
import type { Basemap, Selection, WorkSummary } from '../types';

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
  selection: Selection;
  onSelect: (sel: Selection, fly?: boolean) => void;
  onClose: () => void;
}

export default function DetailPanel({ basemap, selection, onSelect, onClose }: Props) {
  if (!selection) return null;

  if (selection.kind === 'subfield') {
    const sf = basemap.subfields.find((s) => s.id === selection.id);
    if (!sf) return null;
    const field = basemap.fields.find((f) => f.id === sf.field);
    const topics = basemap.topics
      .filter((t) => t.subfield === sf.id)
      .sort((a, b) => b.worksCount - a.worksCount);
    return (
      <aside className="panel">
        <button className="close" onClick={onClose}>
          ×
        </button>
        <div className="crumb">{field?.name}</div>
        <h2>{sf.name}</h2>
        <p className="muted">
          {sf.worksCount.toLocaleString()} works in OpenAlex
          {sf.wikipedia && (
            <>
              {' · '}
              <a href={sf.wikipedia} target="_blank" rel="noreferrer">
                Wikipedia
              </a>
            </>
          )}
        </p>
        <h3>Cites into / cited by</h3>
        <p className="muted small">
          Nearest neighbors by citation flow — the subfields this one exchanges the most citations
          with.
        </p>
        <div className="chips">
          {sf.neighbors.slice(0, 8).map((n) => {
            const nb = basemap.subfields.find((s) => s.id === n.id);
            return (
              nb && (
                <button
                  key={n.id}
                  className="chip"
                  onClick={() => onSelect({ kind: 'subfield', id: n.id }, true)}
                >
                  {nb.name}
                </button>
              )
            );
          })}
        </div>
        <h3>Topics ({topics.length})</h3>
        <div className="chips">
          {topics.slice(0, 14).map((t) => (
            <button
              key={t.id}
              className="chip subtle"
              onClick={() => onSelect({ kind: 'topic', id: t.id }, true)}
            >
              {t.name}
            </button>
          ))}
        </div>
        <h3>Papers</h3>
        <PaperList kind="subfield" id={sf.id} />
      </aside>
    );
  }

  const topic = basemap.topics.find((t) => t.id === selection.id);
  if (!topic) return null;
  const sf = basemap.subfields.find((s) => s.id === topic.subfield);
  return (
    <aside className="panel">
      <button className="close" onClick={onClose}>
        ×
      </button>
      <div className="crumb">
        <button
          className="linklike"
          onClick={() => sf && onSelect({ kind: 'subfield', id: sf.id }, true)}
        >
          {sf?.name}
        </button>
      </div>
      <h2>{topic.name}</h2>
      <p className="muted">
        {topic.worksCount.toLocaleString()} works
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
        <div className="chips">
          {topic.keywords.map((kw) => (
            <span key={kw} className="chip subtle static">
              {kw}
            </span>
          ))}
        </div>
      )}
      <h3>Papers</h3>
      <PaperList kind="topic" id={topic.id} />
    </aside>
  );
}
