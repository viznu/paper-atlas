import { useEffect, useState } from 'react';
import { fetchArxiv } from '../api';
import type { ArxivPaper, Focus } from '../types';
import type { LocalGap } from '../nav';

interface Props {
  gaps: LocalGap[];
  arxivQuery: string;
  onNavigate: (focus: Focus) => void;
}

type Tab = 'gaps' | 'arxiv';

function timeAgo(iso: string): string {
  const d = new Date(iso).getTime();
  const days = Math.floor((Date.now() - d) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** Tabbed discovery: frontier gaps to read vs. the freshest arXiv preprints in this area. */
export default function Discover({ gaps, arxivQuery, onNavigate }: Props) {
  const [tab, setTab] = useState<Tab>(gaps.length ? 'gaps' : 'arxiv');
  const [papers, setPapers] = useState<ArxivPaper[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (tab !== 'arxiv') return;
    let live = true;
    setPapers(null);
    setError(false);
    fetchArxiv(arxivQuery)
      .then((p) => live && setPapers(p))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [tab, arxivQuery]);

  return (
    <div className="discover">
      <div className="disc-tabs">
        {gaps.length > 0 && (
          <button className={tab === 'gaps' ? 'disc-tab active' : 'disc-tab'} onClick={() => setTab('gaps')}>
            Explore next
          </button>
        )}
        <button className={tab === 'arxiv' ? 'disc-tab active' : 'disc-tab'} onClick={() => setTab('arxiv')}>
          Fresh on arXiv
        </button>
      </div>

      {tab === 'gaps' && (
        <>
          <p className="muted small">Neighbouring areas you cite but haven&apos;t explored.</p>
          <ol className="frontier">
            {gaps.map((g) => (
              <li key={g.id}>
                <button onClick={() => onNavigate({ kind: 'subfield', id: g.id })}>
                  <span className="frontier-name">{g.name}</span>
                  <span className="muted small">
                    {g.field}
                    {g.via.length ? ` · via ${g.via.join(', ')}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}

      {tab === 'arxiv' && (
        <div className="arxiv-list">
          <p className="muted small">Newest preprints mentioning “{arxivQuery}”.</p>
          {error && <p className="muted small">Couldn&apos;t reach arXiv.</p>}
          {!papers && !error && <p className="muted small">Loading from arXiv…</p>}
          {papers && papers.length === 0 && <p className="muted small">No recent preprints found.</p>}
          {papers?.map((p) => (
            <a key={p.id} className="arxiv-item" href={p.url} target="_blank" rel="noreferrer">
              <div className="arxiv-title">{p.title}</div>
              <div className="arxiv-meta">
                {p.authors[0] ?? '?'}
                {p.authors.length > 1 ? ' et al.' : ''} · {timeAgo(p.published)} · arXiv
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
