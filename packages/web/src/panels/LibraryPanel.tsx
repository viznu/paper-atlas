import type { Basemap, LibraryState, Selection } from '../types';

interface Props {
  basemap: Basemap;
  library: LibraryState | null;
  syncing: boolean;
  onSync: () => void;
  onSelect: (sel: Selection, fly?: boolean) => void;
}

/**
 * The library overlay panel: sync status, coverage summary, and the ranked frontier gaps —
 * "where to explore next" — each jumping to that territory on the map.
 */
export default function LibraryPanel({ basemap, library, syncing, onSync, onSelect }: Props) {
  if (!library) return null;

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
            {ov.stats.placed} of {ov.stats.total} items placed ·{' '}
            {Object.keys(ov.coverage).length} territories covered
          </p>
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
                  <button onClick={() => onSelect({ kind: 'subfield', id: f.id }, true)}>
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
