import type { Basemap, Overlay } from './types';

// ---------- mastery (per subfield / field) ----------
export interface Mastery {
  level: 0 | 1 | 2 | 3;
  label: string;
}
export function masteryFor(count: number): Mastery {
  if (count >= 6) return { level: 3, label: 'Deep' };
  if (count >= 3) return { level: 2, label: 'Familiar' };
  if (count >= 1) return { level: 1, label: 'Novice' };
  return { level: 0, label: 'Unexplored' };
}

// ---------- explorer level ----------
const LEVEL_TITLES = [
  'Wanderer',
  'Scout',
  'Explorer',
  'Cartographer',
  'Pathfinder',
  'Voyager',
  'Luminary',
];
export function levelFor(xp: number): { level: number; title: string; into: number; span: number } {
  // xp needed for level n (1-indexed): 100 * (n-1)^2
  let level = 1;
  while (100 * level * level <= xp) level++;
  const floor = 100 * (level - 1) * (level - 1);
  const ceil = 100 * level * level;
  return {
    level,
    title: LEVEL_TITLES[Math.min(level - 1, LEVEL_TITLES.length - 1)]!,
    into: xp - floor,
    span: ceil - floor,
  };
}

export interface Badge {
  id: string;
  name: string;
  icon: string;
  earned: boolean;
  hint: string;
}
export interface Quest {
  id: string;
  text: string;
  targetSubfield: string;
  field: string;
}
export interface GameState {
  explored: number;
  totalSubfields: number;
  percent: number;
  fieldsTouched: number;
  totalFields: number;
  domainsTouched: number;
  papers: number;
  xp: number;
  level: number;
  levelTitle: string;
  levelInto: number;
  levelSpan: number;
  badges: Badge[];
  quests: Quest[];
}

export function computeGame(basemap: Basemap, overlay: Overlay | null): GameState {
  const coverage = overlay?.coverage ?? {};
  const coveredIds = Object.keys(coverage).filter((id) => coverage[id]! > 0);
  const explored = coveredIds.length;
  const totalSubfields = basemap.subfields.length;
  const papers = overlay?.stats.placed ?? 0;

  const fieldsTouched = new Set(
    coveredIds.map((id) => basemap.subfields.find((s) => s.id === id)?.field).filter(Boolean),
  );
  const domainsTouched = new Set(
    coveredIds.map((id) => basemap.subfields.find((s) => s.id === id)?.domain).filter(Boolean),
  );
  const deepest = Math.max(0, ...coveredIds.map((id) => coverage[id]!));

  // a field is "conquered" when every one of its subfields has coverage
  const conqueredField = basemap.fields.find((f) => {
    const members = basemap.subfields.filter((s) => s.field === f.id);
    return members.length > 0 && members.every((s) => (coverage[s.id] ?? 0) > 0);
  });

  const xp = papers * 10 + explored * 25 + fieldsTouched.size * 50 + domainsTouched.size * 40;
  const lvl = levelFor(xp);
  const percent = totalSubfields ? Math.round((explored / totalSubfields) * 100) : 0;

  const badges: Badge[] = [
    { id: 'first', name: 'First Steps', icon: '👣', earned: papers >= 1, hint: 'Add a paper to your library' },
    { id: 'polymath', name: 'Polymath', icon: '🧠', earned: fieldsTouched.size >= 3, hint: 'Read across 3 fields' },
    { id: 'deep', name: 'Deep Diver', icon: '🤿', earned: deepest >= 6, hint: 'Read 6+ papers in one subfield' },
    { id: 'bridge', name: 'Bridge Builder', icon: '🌉', earned: domainsTouched.size >= 2, hint: 'Read across 2 domains' },
    { id: 'carto', name: 'Cartographer', icon: '🗺️', earned: percent >= 25, hint: 'Explore 25% of the map' },
    { id: 'crown', name: 'Field Master', icon: '👑', earned: !!conqueredField, hint: 'Cover every subfield of a field' },
  ];

  const quests: Quest[] = (overlay?.frontier ?? []).slice(0, 4).map((g) => ({
    id: g.id,
    text: `Read a paper in ${g.name}`,
    targetSubfield: g.id,
    field: g.field,
  }));

  return {
    explored,
    totalSubfields,
    percent,
    fieldsTouched: fieldsTouched.size,
    totalFields: basemap.fields.length,
    domainsTouched: domainsTouched.size,
    papers,
    xp,
    level: lvl.level,
    levelTitle: lvl.title,
    levelInto: lvl.into,
    levelSpan: lvl.span,
    badges,
    quests,
  };
}

// ---------- character (cosmetic, stored locally) ----------
export interface Character {
  icon: string;
  name: string;
}
export const AVATARS = ['🧭', '🔭', '🦉', '🧙', '🚀', '🕵️', '🦊', '🐙', '🌌', '📡'];
const KEY = 'paper-atlas-character';

export function loadCharacter(): Character {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { icon: '🧭', name: 'Explorer' };
}
export function saveCharacter(c: Character): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}
