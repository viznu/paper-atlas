import { useMemo, useState } from 'react';
import type { Basemap, Selection } from './types';

interface Props {
  basemap: Basemap;
  onSelect: (sel: Selection, fly?: boolean) => void;
}

export default function SearchBox({ basemap, onSelect }: Props) {
  const [q, setQ] = useState('');

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [];
    const out: { kind: 'subfield' | 'topic'; id: string; name: string; extra: string }[] = [];
    for (const s of basemap.subfields) {
      if (s.name.toLowerCase().includes(needle)) {
        out.push({ kind: 'subfield', id: s.id, name: s.name, extra: 'subfield' });
      }
      if (out.length > 5) break;
    }
    for (const t of basemap.topics) {
      if (out.length >= 12) break;
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
                  onSelect({ kind: r.kind, id: r.id }, true);
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
