import { useState } from 'react';
import type { Basemap, Focus, LibraryState } from '../types';
import { AVATARS, computeGame, loadCharacter, saveCharacter, type Character } from '../game';

interface Props {
  basemap: Basemap;
  library: LibraryState | null;
  onNavigate: (focus: Focus) => void;
}

/** The gamified explorer HUD: character, level, % of the map explored, badges, and quests. */
export default function ExplorerPanel({ basemap, library, onNavigate }: Props) {
  const [char, setChar] = useState<Character>(() => loadCharacter());
  const [editing, setEditing] = useState(false);
  const game = computeGame(basemap, library?.overlay ?? null);

  const update = (c: Character) => {
    setChar(c);
    saveCharacter(c);
  };

  return (
    <aside className="explorer">
      <div className="xp-head">
        <button className="avatar" onClick={() => setEditing((e) => !e)} title="Customize">
          {char.icon}
        </button>
        <div className="xp-id">
          <div className="xp-name">{char.name}</div>
          <div className="xp-title muted small">
            Lv {game.level} · {game.levelTitle}
          </div>
        </div>
      </div>

      {editing && (
        <div className="char-editor">
          <div className="avatar-grid">
            {AVATARS.map((a) => (
              <button
                key={a}
                className={a === char.icon ? 'av active' : 'av'}
                onClick={() => update({ ...char, icon: a })}
              >
                {a}
              </button>
            ))}
          </div>
          <input
            className="name-input"
            value={char.name}
            maxLength={24}
            onChange={(e) => update({ ...char, name: e.target.value })}
            placeholder="Your explorer name"
          />
          <button className="done-btn" onClick={() => setEditing(false)}>
            Done
          </button>
        </div>
      )}

      <div className="xp-bar" title={`${game.xp} XP`}>
        <div className="xp-fill" style={{ width: `${(game.levelInto / game.levelSpan) * 100}%` }} />
      </div>

      <div className="explore-meter">
        <div className="em-top">
          <span className="em-pct">{game.percent}%</span>
          <span className="muted small">of the map explored</span>
        </div>
        <div className="em-stats muted small">
          {game.explored}/{game.totalSubfields} subfields · {game.fieldsTouched}/{game.totalFields}{' '}
          fields · {game.papers} papers
        </div>
      </div>

      <h4>Badges</h4>
      <div className="badges">
        {game.badges.map((b) => (
          <div key={b.id} className={b.earned ? 'badge earned' : 'badge'} title={b.hint}>
            <span className="badge-icon">{b.icon}</span>
            <span className="badge-name">{b.name}</span>
          </div>
        ))}
      </div>

      {game.quests.length > 0 && (
        <>
          <h4>Quests</h4>
          <ol className="quests">
            {game.quests.map((q) => (
              <li key={q.id}>
                <button onClick={() => onNavigate({ kind: 'subfield', id: q.targetSubfield })}>
                  <span className="quest-check">◇</span>
                  <span>
                    {q.text}
                    <span className="muted small"> · {q.field}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </aside>
  );
}
