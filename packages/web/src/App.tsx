import { useCallback, useEffect, useRef, useState } from 'react';
import AtlasCanvas, { type FlyTarget } from './atlas/AtlasCanvas';
import DetailPanel from './panels/DetailPanel';
import LibraryPanel from './panels/LibraryPanel';
import SearchBox from './SearchBox';
import { fetchBasemap, fetchLibrary, syncLibrary } from './api';
import type { Basemap, LibraryState, Selection } from './types';

export default function App() {
  const [basemap, setBasemap] = useState<Basemap | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [hoverName, setHoverName] = useState<string | null>(null);
  const [flyTarget, setFlyTarget] = useState<FlyTarget | null>(null);
  const [library, setLibrary] = useState<LibraryState | null>(null);
  const [syncing, setSyncing] = useState(false);
  const flyNonce = useRef(0);

  useEffect(() => {
    fetchBasemap()
      .then(setBasemap)
      .catch((e) => setLoadError(String(e)));
  }, []);

  const runSync = useCallback(() => {
    setSyncing(true);
    syncLibrary()
      .then(setLibrary)
      .catch(() => {})
      .finally(() => setSyncing(false));
  }, []);

  // Load library state; if a library is configured but not yet projected, sync it once.
  useEffect(() => {
    fetchLibrary()
      .then((state) => {
        setLibrary(state);
        if (state.configured && !state.overlay && !state.syncing) runSync();
      })
      .catch(() => {});
  }, [runSync]);

  const select = useCallback(
    (sel: Selection, fly = false) => {
      setSelection(sel);
      if (!fly || !sel || !basemap) return;
      const target =
        sel.kind === 'subfield'
          ? basemap.subfields.find((s) => s.id === sel.id)
          : basemap.topics.find((t) => t.id === sel.id);
      if (target) {
        flyNonce.current += 1;
        setFlyTarget({
          x: target.x,
          y: target.y,
          k: sel.kind === 'subfield' ? 4 : 8,
          nonce: flyNonce.current,
        });
      }
    },
    [basemap],
  );

  if (loadError) {
    return (
      <div className="fullscreen-message">
        <h1>paper-atlas</h1>
        <p>Could not load the base map: {loadError}</p>
        <p className="muted">
          Is the paper-atlas server running? Start it with <code>npx paper-atlas</code>.
        </p>
      </div>
    );
  }
  if (!basemap) {
    return (
      <div className="fullscreen-message">
        <h1>paper-atlas</h1>
        <p className="muted">Loading the map of science…</p>
      </div>
    );
  }

  return (
    <div className="app">
      <AtlasCanvas
        basemap={basemap}
        selection={selection}
        overlay={library?.overlay ?? null}
        onSelect={select}
        hoverInfo={setHoverName}
        flyTarget={flyTarget}
      />
      <header className="topbar">
        <div className="brand">
          <span className="brand-name">paper-atlas</span>
          <span className="brand-sub">a map of science, from citation flows</span>
        </div>
        <SearchBox basemap={basemap} onSelect={select} />
      </header>
      {hoverName && !selection && <div className="hover-hint">{hoverName}</div>}
      {!selection && (
        <LibraryPanel
          basemap={basemap}
          library={library}
          syncing={syncing}
          onSync={runSync}
          onSelect={select}
        />
      )}
      <DetailPanel
        basemap={basemap}
        selection={selection}
        onSelect={select}
        onClose={() => setSelection(null)}
      />
      <footer className="credits">
        data: <a href="https://openalex.org">OpenAlex</a> · territories = subfields, neighbors by
        citation flow · scroll to zoom
      </footer>
    </div>
  );
}
