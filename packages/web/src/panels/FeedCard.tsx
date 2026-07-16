import { useState } from 'react';
import { fetchPaper, resolveArxiv } from '../api';
import type { FeedEntry, FeedTab, PaperRef } from '../types';

function initials(name: string | undefined): string {
  if (!name) return '·';
  const parts = name.split(' ').filter(Boolean);
  const last = parts[parts.length - 1] ?? '';
  return (parts[0]?.[0] ?? '') + (last[0] ?? '');
}
function handle(authors: string[]): string {
  const a = authors[0];
  if (!a) return '@unknown';
  const parts = a.toLowerCase().split(' ').filter(Boolean);
  return '@' + (parts[parts.length - 1] ?? 'author') + (authors.length > 1 ? '+' + (authors.length - 1) : '');
}
function when(e: FeedEntry): string {
  if (e.published) {
    const days = Math.floor((Date.now() - new Date(e.published).getTime()) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days}d ago`;
  }
  return e.year ? String(e.year) : '';
}
const extLink = (e: FeedEntry) =>
  e.url ?? (e.doi ? (e.doi.startsWith('http') ? e.doi : `https://doi.org/${e.doi}`) : `https://openalex.org/${e.id}`);

function Reply({ r, onOpen }: { r: PaperRef; onOpen: (id: string) => void }) {
  return (
    <div className="reply">
      <div className="avatar sm">{initials(r.authors[0])}</div>
      <div className="tweet-main">
        <button className="tweet-name linklike" onClick={() => onOpen(r.id)}>
          {r.title}
        </button>
        <div className="tl-meta">
          {r.authors[0] ?? '?'}
          {r.authors.length > 1 ? ' et al.' : ''} · {r.year ?? '—'} · {r.citedBy.toLocaleString()} cites
        </div>
      </div>
    </div>
  );
}

interface Props {
  entry: FeedEntry;
  tab: FeedTab;
  signal: 'more' | 'less' | null;
  read: boolean;
  onOpen: (id: string) => void;
  onFeedback: (id: string, signal: 'more' | 'less' | 'clear', title: string) => void;
  onRead: (id: string, read: boolean) => void;
}

/** One feed item, shared by every tab. Shows whatever fields the source provided. */
export default function FeedCard({ entry, tab, signal, read, onOpen, onFeedback, onRead }: Props) {
  const isWork = entry.id.startsWith('W');
  const [showRefs, setShowRefs] = useState(false);
  const [refs, setRefs] = useState<PaperRef[] | null>(null);
  const [refCount, setRefCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const openThread = async () => {
    if (isWork) return onOpen(entry.id);
    if (entry.arxivId) {
      setBusy(true);
      try {
        const oa = await resolveArxiv(entry.arxivId);
        if (oa) onOpen(oa);
        else window.open(extLink(entry), '_blank', 'noopener');
      } finally {
        setBusy(false);
      }
    } else window.open(extLink(entry), '_blank', 'noopener');
  };

  const toggleRefs = () => {
    if (!showRefs && refs === null) {
      setBusy(true);
      fetchPaper(entry.id)
        .then((r) => {
          const list = (r.paper?.references ?? []).slice().sort((a, b) => b.citedBy - a.citedBy);
          setRefCount(r.paper?.references.length ?? 0);
          setRefs(list.slice(0, 3));
        })
        .catch(() => setRefs([]))
        .finally(() => setBusy(false));
    }
    setShowRefs((s) => !s);
  };

  return (
    <article className={read ? 'tweet read' : 'tweet'}>
      <div className="tweet-row">
        <div className="avatar">{initials(entry.faculty ?? entry.authors[0])}</div>
        <div className="tweet-main">
          <div className="tweet-head">
            <button className="tweet-name linklike" onClick={openThread}>
              {entry.title}
            </button>
            <span className="tweet-handle">
              {handle(entry.authors)} · {when(entry)}
              {entry.arxivId ? ' · arXiv' : ''}
            </span>
          </div>

          {entry.faculty && (
            <div className="tweet-faculty">
              👤 {entry.faculty}
              {entry.institution ? ` · ${entry.institution}` : ''}
            </div>
          )}
          {entry.reason && <div className="tweet-reason">{entry.reason}</div>}
          {entry.summary && <div className="tweet-body">{entry.summary}</div>}

          {(entry.matched?.length || entry.inLibraryTopic || entry.categories?.length) && (
            <div className="tweet-tags">
              {entry.matched?.map((m) => (
                <span key={m} className="tag-int">
                  {m}
                </span>
              ))}
              {entry.inLibraryTopic && <span className="tag-lib">📚 in your topics</span>}
              {entry.categories?.slice(0, 2).map((c) => (
                <span key={c} className="tag-cat">
                  {c}
                </span>
              ))}
            </div>
          )}

          <div className="tweet-actions">
            <button className="tweet-act" onClick={openThread} disabled={busy}>
              🧵 {busy ? '…' : 'Open thread'}
            </button>
            {isWork && (
              <button className="tweet-act" onClick={toggleRefs}>
                💬 {showRefs ? 'Hide' : refCount != null ? `${refCount} cited` : 'Cited papers'}
              </button>
            )}
            <a className="tweet-act" href={extLink(entry)} target="_blank" rel="noreferrer">
              ↗ open
            </a>
            {entry.citedBy != null && (
              <span className="muted xsmall">{entry.citedBy.toLocaleString()} cites</span>
            )}
            <button
              className={read ? 'tweet-act read-on' : 'tweet-act'}
              onClick={() => onRead(entry.id, !read)}
            >
              {read ? '✓ Read' : 'Mark read'}
            </button>
            <span className="feedback">
              <button
                className={signal === 'more' ? 'fb on' : 'fb'}
                title="More like this"
                onClick={() => onFeedback(entry.id, signal === 'more' ? 'clear' : 'more', entry.title)}
              >
                👍
              </button>
              <button
                className={signal === 'less' ? 'fb on' : 'fb'}
                title="Less like this"
                onClick={() => onFeedback(entry.id, signal === 'less' ? 'clear' : 'less', entry.title)}
              >
                👎
              </button>
            </span>
          </div>

          {showRefs && (
            <div className="thread">
              {busy && <p className="muted small reply-pad">Loading cited papers…</p>}
              {refs?.map((r) => (
                <Reply key={r.id} r={r} onOpen={onOpen} />
              ))}
              {refs && refCount != null && refCount > refs.length && (
                <button className="reply-more linklike" onClick={() => onOpen(entry.id)}>
                  View all {refCount} in the thread →
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
