import { useCallback, useEffect, useState } from 'react';
import { fetchFeedTab, generateFeedTab, markRead, sendFeedback } from '../api';
import PaperView from './PaperView';
import FeedCard from './FeedCard';
import type { FeedEntry, FeedTab, LibraryState } from '../types';

interface Props {
  library: LibraryState | null;
  summariesEnabled: boolean;
  syncing: boolean;
  onSync: () => void;
}

const TABS: { id: FeedTab; label: string; blurb: string; budget: boolean }[] = [
  { id: 'fresh', label: 'Fresh', blurb: 'New arXiv papers at the intersection of your interests and your library.', budget: false },
  { id: 'claude', label: 'Recommended', blurb: 'A curated feed from your research themes — edit them in ~/.paper-atlas/claude-themes.json.', budget: false },
  { id: 'citations', label: 'From your citations', blurb: 'Works your library cites most — expand one to preview the papers it cites.', budget: true },
  { id: 'phd', label: 'PhD faculty', blurb: 'Recent papers from the faculty at your PhD target programs.', budget: true },
];

function prettyDate(d: string): string {
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  if (d === iso) return `Today · ${d}`;
  return d;
}

export default function ReadingDesk({ library, summariesEnabled, syncing, onSync }: Props) {
  const [tab, setTab] = useState<FeedTab>('fresh');
  const [trail, setTrail] = useState<string[]>([]);
  const openId = trail[trail.length - 1] ?? null;

  const [items, setItems] = useState<FeedEntry[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const [date, setDate] = useState<string | null>(null);
  const [signals, setSignals] = useState<Record<string, 'more' | 'less'>>({});
  const [reads, setReads] = useState<Set<string>>(new Set());
  const [state, setState] = useState<'loading' | 'ok' | 'empty' | 'rate' | 'error'>('loading');
  const [generating, setGenerating] = useState(false);

  const meta = TABS.find((t) => t.id === tab)!;

  const load = useCallback((t: FeedTab, d?: string) => {
    setState('loading');
    fetchFeedTab(t, d)
      .then((r) => {
        setItems(r.items);
        setDates(r.dates);
        setDate(r.date);
        const sig: Record<string, 'more' | 'less'> = {};
        for (const f of r.feedback) if (f.signal === 'more' || f.signal === 'less') sig[f.paperId] = f.signal;
        setSignals(sig);
        setReads(new Set(r.read));
        setState(r.items.length ? 'ok' : 'empty');
      })
      .catch(() => setState('error'));
  }, []);

  useEffect(() => {
    if (!openId) load(tab);
  }, [tab, openId, load]);

  const generate = () => {
    setGenerating(true);
    generateFeedTab(tab)
      .then((r) => {
        setItems(r.items);
        setDates(r.dates);
        setDate(r.date);
        if (r.rateLimited) setState('rate');
        else setState(r.items.length ? 'ok' : 'empty');
      })
      .catch(() => setState('error'))
      .finally(() => setGenerating(false));
  };

  const onFeedback = (id: string, signal: 'more' | 'less' | 'clear', title: string) => {
    setSignals((s) => {
      const next = { ...s };
      if (signal === 'clear') delete next[id];
      else next[id] = signal;
      return next;
    });
    sendFeedback(id, tab, signal, title).catch(() => {});
  };

  const onRead = (id: string, read: boolean) => {
    setReads((s) => {
      const next = new Set(s);
      if (read) next.add(id);
      else next.delete(id);
      return next;
    });
    markRead(id, read).catch(() => {});
  };

  const open = (id: string) => setTrail((t) => [...t, id]);
  const back = () => setTrail((t) => t.slice(0, -1));
  const home = () => setTrail([]);

  if (openId) {
    return (
      <div className="desk">
        <div className="feed-col">
          <div className="desk-nav">
            <button className="linklike" onClick={back}>
              ‹ Back
            </button>
            {trail.length > 1 && (
              <button className="linklike subtle" onClick={home}>
                Feed
              </button>
            )}
          </div>
          <PaperView id={openId} summariesEnabled={summariesEnabled} onOpen={open} />
        </div>
      </div>
    );
  }

  const unread = items.filter((e) => !reads.has(e.id)).length;

  return (
    <div className="desk">
      <div className="feed-col">
        <header className="feed-head">
          <h1>Your feed</h1>
          <div className="feed-tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={tab === t.id ? 'feed-tab active' : 'feed-tab'}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </header>

        <div className="feed-controls">
          {dates.length > 0 && (
            <select
              className="date-picker"
              value={date ?? ''}
              onChange={(e) => load(tab, e.target.value)}
            >
              {dates.map((d) => (
                <option key={d} value={d}>
                  {prettyDate(d)}
                </option>
              ))}
            </select>
          )}
          {state === 'ok' && (
            <span className="muted xsmall">
              {unread} unread · {items.length} papers
            </span>
          )}
          <button className="linklike" onClick={generate} disabled={generating}>
            {generating ? 'refreshing…' : state === 'empty' ? 'generate' : 'refresh'}
          </button>
          {meta.budget && <span className="muted xsmall">uses OpenAlex</span>}
        </div>

        <p className="muted feed-note">{meta.blurb}</p>

        {state === 'loading' && <p className="muted">Loading…</p>}
        {state === 'error' && <p className="muted">Couldn’t load this feed.</p>}
        {state === 'rate' && (
          <p className="muted">OpenAlex daily limit reached — try again after the midnight-UTC reset.</p>
        )}
        {state === 'empty' && (
          <div className="desk-empty">
            {tab === 'citations' && library && !library.configured ? (
              <p className="muted">No Zotero library detected — this tab uses your citations.</p>
            ) : (
              <>
                <p className="muted">Nothing here yet.</p>
                <button className="rec-sync" onClick={generate} disabled={generating}>
                  {generating ? 'Building…' : `Build ${meta.label}`}
                </button>
                {tab === 'citations' && library?.configured && !library.overlay && (
                  <button className="rec-sync" onClick={onSync} disabled={syncing} style={{ marginLeft: 8 }}>
                    {syncing ? 'Syncing…' : 'Sync library'}
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {state === 'ok' && (
          <div className="feed">
            {items.map((e) => (
              <FeedCard
                key={e.id}
                entry={e}
                tab={tab}
                signal={signals[e.id] ?? null}
                read={reads.has(e.id)}
                onOpen={open}
                onFeedback={onFeedback}
                onRead={onRead}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
