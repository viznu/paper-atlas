import { useState } from 'react';

export type View = 'atlas' | 'desk';

interface Props {
  view: View;
  onChange: (v: View) => void;
}

const ITEMS: { id: View; icon: string; label: string; sub: string }[] = [
  { id: 'atlas', icon: '🗺', label: 'Atlas', sub: 'the map of science' },
  { id: 'desk', icon: '📚', label: 'Reading Desk', sub: 'your next reads' },
];

/** Collapsible left rail: switch between the Atlas and the Reading Desk. */
export default function SideNav({ view, onChange }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <nav className={open ? 'sidenav open' : 'sidenav'}>
      <button
        className="sidenav-toggle"
        onClick={() => setOpen((o) => !o)}
        title={open ? 'Collapse' : 'Expand'}
        aria-label="Toggle navigation"
      >
        {open ? '‹' : '☰'}
      </button>
      <ul className="sidenav-items">
        {ITEMS.map((it) => (
          <li key={it.id}>
            <button
              className={view === it.id ? 'sidenav-item active' : 'sidenav-item'}
              onClick={() => onChange(it.id)}
              title={it.label}
            >
              <span className="sidenav-icon">{it.icon}</span>
              <span className="sidenav-text">
                <span className="sidenav-label">{it.label}</span>
                <span className="sidenav-sub">{it.sub}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
