import type { Basemap, Overlay } from '../types';

interface Props {
  basemap: Basemap;
  overlay: Overlay | null;
  subfieldId: string;
}

/** Lightweight stats card shown on the right while hovering a territory (before you drill in). */
export default function HoverCard({ basemap, overlay, subfieldId }: Props) {
  const sf = basemap.subfields.find((s) => s.id === subfieldId);
  if (!sf) return null;
  const field = basemap.fields.find((f) => f.id === sf.field);
  const topics = basemap.topics.filter((t) => t.subfield === sf.id);
  const cov = overlay?.coverage[sf.id] ?? 0;
  const topNeighbors = sf.neighbors
    .slice(0, 3)
    .map((n) => basemap.subfields.find((s) => s.id === n.id)?.name)
    .filter(Boolean);

  return (
    <aside className="hovercard">
      <div className="crumb">{field?.name}</div>
      <h3 className="hc-title">{sf.name}</h3>
      <div className="hc-stats">
        <div>
          <span className="hc-num">{sf.worksCount.toLocaleString()}</span>
          <span className="hc-lab">works</span>
        </div>
        <div>
          <span className="hc-num">{topics.length}</span>
          <span className="hc-lab">topics</span>
        </div>
        <div>
          <span className="hc-num" style={{ color: cov > 0 ? '#f5b642' : undefined }}>
            {cov}
          </span>
          <span className="hc-lab">in your library</span>
        </div>
      </div>
      {topNeighbors.length > 0 && (
        <p className="muted small">
          Cites into: {topNeighbors.join(', ')}
        </p>
      )}
      <p className="muted small dim">Click to explore</p>
    </aside>
  );
}
