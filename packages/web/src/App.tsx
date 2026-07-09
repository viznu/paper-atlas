import { useCallback, useEffect, useState } from 'react';
import AtlasCanvas from './atlas/AtlasCanvas';
import DetailPanel from './panels/DetailPanel';
import FieldPanel from './panels/FieldPanel';
import LibraryPanel from './panels/LibraryPanel';
import TopicTreemap from './panels/TopicTreemap';
import HoverCard from './panels/HoverCard';
import Breadcrumb from './Breadcrumb';
import SearchBox from './SearchBox';
import { fetchBasemap, fetchLibrary, syncLibrary } from './api';
import { stackFor } from './nav';
import type { Basemap, Focus, LibraryState } from './types';

export default function App() {
  const [basemap, setBasemap] = useState<Basemap | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stack, setStack] = useState<Focus[]>([]);
  const [hoverSub, setHoverSub] = useState<string | null>(null);
  const [library, setLibrary] = useState<LibraryState | null>(null);
  const [syncing, setSyncing] = useState(false);

  const focus = stack.length ? stack[stack.length - 1]! : null;

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

  useEffect(() => {
    fetchLibrary()
      .then((state) => {
        setLibrary(state);
        if (state.configured && !state.overlay && !state.syncing) runSync();
      })
      .catch(() => {});
  }, [runSync]);

  // Navigate to a focus, building the full breadcrumb stack for it.
  const navigate = useCallback(
    (f: Focus) => {
      if (!basemap) return;
      setStack(stackFor(f, basemap));
    },
    [basemap],
  );
  // Jump to a breadcrumb index; -1 clears back to the world map.
  const goTo = useCallback((index: number) => {
    setStack((s) => (index < 0 ? [] : s.slice(0, index + 1)));
  }, []);

  // Escape / backspace go up one level.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stack.length) setStack((s) => s.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stack.length]);

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
        focus={focus}
        overlay={library?.overlay ?? null}
        onNavigate={navigate}
        hoverInfo={setHoverSub}
      />
      <header className="topbar">
        <div className="brand">
          <span className="brand-name">paper-atlas</span>
          <span className="brand-sub">a map of science, from citation flows</span>
        </div>
        <SearchBox basemap={basemap} onNavigate={navigate} />
      </header>

      <Breadcrumb basemap={basemap} stack={stack} onGoTo={goTo} />

      {/* Hover stats on the right (only when no detail panel occupies that space). */}
      {hoverSub && (!focus || focus.kind === 'field') && (
        <HoverCard basemap={basemap} overlay={library?.overlay ?? null} subfieldId={hoverSub} />
      )}

      {!focus && (
        <LibraryPanel
          basemap={basemap}
          library={library}
          syncing={syncing}
          onSync={runSync}
          onNavigate={navigate}
        />
      )}
      {focus?.kind === 'field' && (
        <FieldPanel
          basemap={basemap}
          fieldId={focus.id}
          overlay={library?.overlay ?? null}
          onNavigate={navigate}
          onClose={() => setStack((s) => s.slice(0, -1))}
        />
      )}
      {(focus?.kind === 'subfield' || focus?.kind === 'topic') &&
        (() => {
          const subfieldId =
            focus.kind === 'subfield'
              ? focus.id
              : (basemap.topics.find((t) => t.id === focus.id)?.subfield ?? null);
          const subfieldName = basemap.subfields.find((s) => s.id === subfieldId)?.name;
          return (
            <>
              {subfieldId && (
                <section className="stage">
                  <div className="stage-head">
                    <span className="stage-title">{subfieldName}</span>
                    <span className="stage-sub">
                      topics — tile size = papers, orange = your coverage
                    </span>
                  </div>
                  <TopicTreemap
                    basemap={basemap}
                    subfieldId={subfieldId}
                    overlay={library?.overlay ?? null}
                    activeTopicId={focus.kind === 'topic' ? focus.id : null}
                    onNavigate={navigate}
                  />
                </section>
              )}
              <DetailPanel
                basemap={basemap}
                focus={focus}
                overlay={library?.overlay ?? null}
                onNavigate={navigate}
                onClose={() => setStack((s) => s.slice(0, -1))}
              />
            </>
          );
        })()}

      <footer className="credits">
        data: <a href="https://openalex.org">OpenAlex</a> · click a field to dive in · scroll to
        zoom · esc to go up
      </footer>
    </div>
  );
}
