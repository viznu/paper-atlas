import { useMemo, useRef, useState, useEffect } from 'react';
import type { Basemap, BasemapTopic, Focus, Overlay } from '../types';
import { buildFieldColors } from '../palette';
import { squarify } from '../treemap';

interface Props {
  basemap: Basemap;
  subfieldId: string;
  overlay: Overlay | null;
  activeTopicId: string | null;
  onNavigate: (focus: Focus) => void;
}

/**
 * A squarified treemap of a subfield's topics — the readable "ontology map". Tiles are sized by
 * how many papers exist in each topic; tiles where the library has coverage glow warm (heat),
 * with a count badge. Clicking a tile drills into that topic. Replaces the tangled on-map labels.
 */
export default function TopicTreemap({
  basemap,
  subfieldId,
  overlay,
  activeTopicId,
  onNavigate,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 640, h: 520 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(200, r.width), h: Math.max(200, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hue = useMemo(() => {
    const sf = basemap.subfields.find((s) => s.id === subfieldId);
    return sf ? (buildFieldColors(basemap).get(sf.field)?.h ?? 210) : 210;
  }, [basemap, subfieldId]);

  const tiles = useMemo(() => {
    const topics = basemap.topics
      .filter((t) => t.subfield === subfieldId)
      .sort((a, b) => b.worksCount - a.worksCount);
    // sqrt-compress so small topics stay clickable while big ones don't dominate entirely
    const items = topics.map((t) => ({ item: t, value: Math.sqrt(t.worksCount || 1) + 2 }));
    return squarify<BasemapTopic>(items, { x: 0, y: 0, w: size.w, h: size.h });
  }, [basemap, subfieldId, size]);

  const cov = overlay?.coverageByTopic ?? {};
  const maxCov = Math.max(1, ...Object.values(cov));

  return (
    <div className="treemap-wrap" ref={ref}>
      <svg width={size.w} height={size.h} className="treemap">
        {tiles.map((tile) => {
          const t = tile.item;
          const c = cov[t.id] ?? 0;
          const heat = c / maxCov;
          const active = t.id === activeTopicId;
          const fill = c > 0 ? `hsl(38 85% ${28 + heat * 22}%)` : `hsl(${hue} 32% 20%)`;
          const pad = 1;
          const showLabel = tile.w > 46 && tile.h > 20;
          return (
            <g
              key={t.id}
              className="tm-tile"
              onClick={() => onNavigate({ kind: 'topic', id: t.id })}
              role="button"
            >
              <rect
                x={tile.x + pad}
                y={tile.y + pad}
                width={Math.max(0, tile.w - pad * 2)}
                height={Math.max(0, tile.h - pad * 2)}
                rx={4}
                fill={fill}
                stroke={active ? '#fff' : c > 0 ? '#f5b642' : 'rgba(255,255,255,0.08)'}
                strokeWidth={active ? 2 : c > 0 ? 1.2 : 0.6}
              />
              {showLabel && (
                <foreignObject
                  x={tile.x + 6}
                  y={tile.y + 5}
                  width={Math.max(0, tile.w - 12)}
                  height={Math.max(0, tile.h - 10)}
                >
                  <div className="tm-label">
                    <span className="tm-name">{t.name}</span>
                    {c > 0 && <span className="tm-count">{c}</span>}
                  </div>
                </foreignObject>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
