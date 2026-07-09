import type { Basemap, Focus, LibraryState } from '../types';

interface Props {
  basemap: Basemap;
  library: LibraryState | null;
  syncing: boolean;
  onSync: () => void;
  onNavigate: (focus: Focus) => void;
}

/**
 * The library overlay panel: sync status, coverage summary, and the ranked frontier gaps —
 * "where to explore next" — each jumping to that territory on the map.
 */
export default function LibraryPanel({ basemap, library, syncing, onSync, onNavigate }: Props) {
  if (!library) return null;
  const nameOf = (id: string) => basemap.subfields.find((s) => s.id === id)?.name ?? id;
  const fieldOf = (id: string) => {
    const s = basemap.subfields.find((x) => x.id === id);
    return s ? (basemap.fields.find((f) => f.id === s.field)?.name ?? '') : '';
  };

  if (!library.configured) {
    return (
      <aside className="lib-panel">
        <h3>Your library</h3>
        <p className="muted small">
          No Zotero library detected. Set <code>PAPER_ATLAS_ZOTERO_DIR</code> or open Zotero to
          overlay your reading on the map.
        </p>
      </aside>
    );
  }

  const ov = library.overlay;
  return (
    <aside className="lib-panel">
      <div className="lib-head">
        <h3>Your library</h3>
        <button className="sync" onClick={onSync} disabled={syncing}>
          {syncing ? 'syncing…' : 'sync'}
        </button>
      </div>
      {library.error && <p className="muted small">Sync error: {library.error}</p>}
      {ov && (
        <>
          <p className="muted small">
            {ov.stats.matched} of {ov.stats.total} papers matched to OpenAlex ·{' '}
            {ov.stats.placed} shown on this map · {Object.keys(ov.coverage).length} territories
          </p>
          <p className="muted small dim">
            (only {ov.stats.placed} placed because this is the 30-subfield preview map — the full
            map places them all.)
          </p>
          <h4 className="reading">You&apos;re reading in</h4>
          <ol className="covered">
            {Object.entries(ov.coverage)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 8)
              .map(([id, count]) => {
                const max = Math.max(1, ...Object.values(ov.coverage));
                return (
                  <li key={id}>
                    <button onClick={() => onNavigate({ kind: 'subfield', id })}>
                      <span className="cov-bar" style={{ width: `${(count / max) * 100}%` }} />
                      <span className="cov-name">{nameOf(id)}</span>
                      <span className="cov-sub muted small">{fieldOf(id)}</span>
                      <span className="cov-count">{count}</span>
                    </button>
                  </li>
                );
              })}
          </ol>
          <h4>Explore next — frontier gaps</h4>
          <p className="muted small">
            Territories your reading cites into, but that you haven&apos;t explored.
          </p>
          <ol className="frontier">
            {ov.frontier
              .filter((f) => f.coverage === 0)
              .slice(0, 8)
              .map((f) => (
                <li key={f.id}>
                  <button onClick={() => onNavigate({ kind: 'subfield', id: f.id })}>
                    <span className="frontier-name">{f.name}</span>
                    <span className="muted small">
                      {f.field} · via {f.viaSubfields.slice(0, 2).join(', ')}
                    </span>
                  </button>
                </li>
              ))}
          </ol>
        </>
      )}
      {!ov && !syncing && (
        <button className="sync-cta" onClick={onSync}>
          Sync your library onto the map
        </button>
      )}
    </aside>
  );
}
