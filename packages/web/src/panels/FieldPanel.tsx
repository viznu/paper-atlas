import type { Basemap, Focus, Overlay } from '../types';
import { fieldGaps } from '../nav';
import Discover from './Discover';

interface Props {
  basemap: Basemap;
  fieldId: string;
  overlay: Overlay | null;
  onNavigate: (focus: Focus) => void;
  onClose: () => void;
}

/**
 * Facet view for a field (e.g. Computer Science): lists its subfields, sorted by how much of
 * the library sits in each, so the most-covered area is obvious. Each subfield drills in.
 */
export default function FieldPanel({ basemap, fieldId, overlay, onNavigate, onClose }: Props) {
  const field = basemap.fields.find((f) => f.id === fieldId);
  if (!field) return null;
  const subfields = basemap.subfields
    .filter((s) => s.field === fieldId)
    .map((s) => ({ s, cov: overlay?.coverage[s.id] ?? 0 }))
    .sort((a, b) => b.cov - a.cov || b.s.worksCount - a.s.worksCount);
  const totalCov = subfields.reduce((a, x) => a + x.cov, 0);
  const maxCov = Math.max(1, ...subfields.map((x) => x.cov));

  return (
    <aside className="panel">
      <button className="close" onClick={onClose}>
        ×
      </button>
      <div className="crumb">Facet</div>
      <h2>{field.name}</h2>
      <p className="muted">
        {subfields.length} subfields
        {totalCov > 0 && ` · ${totalCov} of your items here`}
      </p>
      <h3>Subfields {totalCov > 0 ? '(bars show your coverage)' : ''}</h3>
      <ul className="subfield-list">
        {subfields.map(({ s, cov }) => (
          <li key={s.id}>
            <button onClick={() => onNavigate({ kind: 'subfield', id: s.id })}>
              <span className="sf-name">{s.name}</span>
              {cov > 0 && <span className="sf-count">{cov}</span>}
              <span className="sf-bar" style={{ width: `${(cov / maxCov) * 100}%` }} />
            </button>
          </li>
        ))}
      </ul>
      <h3 className="explore">Discover</h3>
      <Discover
        gaps={overlay ? fieldGaps(fieldId, basemap, overlay.coverage) : []}
        arxivQuery={field.name}
        onNavigate={onNavigate}
      />
    </aside>
  );
}
