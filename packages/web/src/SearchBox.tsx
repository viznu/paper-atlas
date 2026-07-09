import { useMemo, useState } from 'react';
import type { Basemap, Focus } from './types';

interface Props {
  basemap: Basemap;
  onNavigate: (focus: Focus) => void;
}

export default function SearchBox({ basemap, onNavigate }: Props) {
  const [q, setQ] = useState('');

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [];
    const out: { kind: 'field' | 'subfield' | 'topic'; id: string; name: string; extra: string }[] =
      [];
    for (const f of basemap.fields) {
      if (f.name.toLowerCase().includes(needle))
        out.push({ kind: 'field', id: f.id, name: f.name, extra: 'facet' });
    }
    for (const s of basemap.subfields) {
      if (out.length > 6) break;
      if (s.name.toLowerCase().includes(needle))
        out.push({ kind: 'subfield', id: s.id, name: s.name, extra: 'subfield' });
    }
    for (const t of basemap.topics) {
      if (out.length >= 14) break;
      if (
        t.name.toLowerCase().includes(needle) ||
        t.keywords.some((k) => k.toLowerCase().includes(needle))
      ) {
        out.push({ kind: 'topic', id: t.id, name: t.name, extra: 'topic' });
      }
    }
    return out;
  }, [q, basemap]);

  return (
    <div className="search">
      <input
        placeholder="Search fields, subfields, topics…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {results.length > 0 && (
        <ul className="search-results">
          {results.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => {
                  onNavigate({ kind: r.kind, id: r.id });
                  setQ('');
                }}
              >
                {r.name} <span className="muted small">{r.extra}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
