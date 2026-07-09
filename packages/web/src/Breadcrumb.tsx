import type { Basemap, Focus } from './types';
import { focusLabel } from './nav';

interface Props {
  basemap: Basemap;
  stack: Focus[];
  onGoTo: (index: number) => void; // -1 = world (clear stack)
}

/** World › Field › Subfield › Topic breadcrumb with a back button; every crumb is navigable. */
export default function Breadcrumb({ basemap, stack, onGoTo }: Props) {
  if (stack.length === 0) return null;
  const kindTag = (f: Focus) => (f.kind === 'field' ? 'facet' : f.kind);
  return (
    <nav className="breadcrumb">
      <button className="crumb-back" onClick={() => onGoTo(stack.length - 2)} title="Back">
        ←
      </button>
      <button className="crumb-seg" onClick={() => onGoTo(-1)}>
        Map
      </button>
      {stack.map((f, i) => (
        <span key={`${f.kind}:${f.id}`} className="crumb-wrap">
          <span className="crumb-sep">›</span>
          <button
            className={i === stack.length - 1 ? 'crumb-seg current' : 'crumb-seg'}
            onClick={() => onGoTo(i)}
          >
            {focusLabel(f, basemap)}
            <span className="crumb-kind">{kindTag(f)}</span>
          </button>
        </span>
      ))}
    </nav>
  );
}
