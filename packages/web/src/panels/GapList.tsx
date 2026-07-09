import type { Focus } from '../types';
import type { LocalGap } from '../nav';

interface Props {
  gaps: LocalGap[];
  onNavigate: (focus: Focus) => void;
  blurb?: string;
}

/** A ranked "Explore next" list of frontier subfields, each drilling in on click. */
export default function GapList({ gaps, onNavigate, blurb }: Props) {
  if (!gaps.length) return null;
  return (
    <>
      <h3 className="explore">Explore next</h3>
      {blurb && <p className="muted small">{blurb}</p>}
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
  );
}
