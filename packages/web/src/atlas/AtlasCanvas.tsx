import { useEffect, useMemo, useRef } from 'react';
import { Delaunay } from 'd3-delaunay';
import type { Basemap, BasemapSubfield, Overlay, Selection } from '../types';
import {
  buildFieldHues,
  labelColor,
  territoryFill,
  territoryGlow,
  territoryStroke,
  WATER,
} from '../palette';

/** World-space bounds of the basemap layout (see scripts/build-basemap.ts). */
const WORLD = { min: -40, max: 1070 };
const WATER_GRID_STEP = 26;
const WATER_MIN_DIST = 40;

interface View {
  x: number; // world coord at canvas left
  y: number; // world coord at canvas top
  k: number; // pixels per world unit
}

export interface FlyTarget {
  x: number;
  y: number;
  k: number;
  nonce: number;
}

interface Props {
  basemap: Basemap;
  selection: Selection;
  overlay: Overlay | null;
  hoverInfo: (text: string | null) => void;
  onSelect: (sel: Selection) => void;
  flyTarget: FlyTarget | null;
}

export default function AtlasCanvas({
  basemap,
  selection,
  overlay,
  onSelect,
  hoverInfo,
  flyTarget,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View>({ x: 0, y: 0, k: 1 });
  const hoverRef = useRef<number | null>(null); // subfield index
  const dirtyRef = useRef(true);
  const animRef = useRef<{ from: View; to: View; start: number } | null>(null);
  const selectionRef = useRef<Selection>(selection);
  selectionRef.current = selection;
  const overlayRef = useRef<Overlay | null>(overlay);
  overlayRef.current = overlay;

  const geo = useMemo(() => {
    const subfields = basemap.subfields;
    const seeds: [number, number][] = subfields.map((s) => [s.x, s.y]);
    const seedDelaunay = Delaunay.from(seeds);
    // water seeds keep territories from stretching to infinity -> continents + sea
    const water: [number, number][] = [];
    let probe = 0;
    for (let gx = WORLD.min; gx <= WORLD.max; gx += WATER_GRID_STEP) {
      for (let gy = WORLD.min; gy <= WORLD.max; gy += WATER_GRID_STEP) {
        probe = seedDelaunay.find(gx, gy, probe);
        const s = subfields[probe]!;
        if (Math.hypot(s.x - gx, s.y - gy) > WATER_MIN_DIST) water.push([gx, gy]);
      }
    }
    const all = [...seeds, ...water];
    const delaunay = Delaunay.from(all);
    const voronoi = delaunay.voronoi([WORLD.min, WORLD.min, WORLD.max, WORLD.max]);
    const cells: ([number, number][] | null)[] = subfields.map(
      (_, i) => (voronoi.cellPolygon(i) as [number, number][] | null) ?? null,
    );
    const fieldHues = buildFieldHues(basemap);
    const hueOf = (s: BasemapSubfield) => fieldHues.get(s.field) ?? 200;
    const subfieldIndex = new Map(subfields.map((s, i) => [s.id, i]));
    // field label anchors: works-weighted centroid of member subfields
    const fieldAnchors = basemap.fields
      .map((f) => {
        const members = subfields.filter((s) => s.field === f.id);
        if (!members.length) return null;
        const wsum = members.reduce((a, s) => a + Math.sqrt(s.worksCount || 1), 0);
        return {
          name: f.name,
          x: members.reduce((a, s) => a + s.x * Math.sqrt(s.worksCount || 1), 0) / wsum,
          y: members.reduce((a, s) => a + s.y * Math.sqrt(s.worksCount || 1), 0) / wsum,
          weight: wsum,
        };
      })
      .filter((f): f is NonNullable<typeof f> => !!f);
    const topicsBySubfield = new Map<string, typeof basemap.topics>();
    for (const t of basemap.topics) {
      topicsBySubfield.set(t.subfield, [...(topicsBySubfield.get(t.subfield) ?? []), t]);
    }
    const topicIndex = new Map(basemap.topics.map((t) => [t.id, t]));
    return { seeds, delaunay, cells, hueOf, subfieldIndex, fieldAnchors, topicsBySubfield, topicIndex };
  }, [basemap]);

  // ---------- rendering ----------
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;

    const fitView = () => {
      const { width, height } = canvas.getBoundingClientRect();
      const k = Math.min(width, height) / (WORLD.max - WORLD.min);
      viewRef.current = {
        k,
        x: WORLD.min - (width / k - (WORLD.max - WORLD.min)) / 2,
        y: WORLD.min - (height / k - (WORLD.max - WORLD.min)) / 2,
      };
    };

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      dirtyRef.current = true;
    };
    resize();
    fitView();
    const ro = new ResizeObserver(() => {
      resize();
      dirtyRef.current = true;
    });
    ro.observe(canvas);

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = canvas.getBoundingClientRect();
      const view = viewRef.current;
      const k = view.k;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = WATER;
      ctx.fillRect(0, 0, width, height);
      ctx.setTransform(dpr * k, 0, 0, dpr * k, -view.x * dpr * k, -view.y * dpr * k);

      const sel = selectionRef.current;
      const selIdx =
        sel?.kind === 'subfield'
          ? (geo.subfieldIndex.get(sel.id) ?? null)
          : sel?.kind === 'topic'
            ? (geo.subfieldIndex.get(geo.topicIndex.get(sel.id)?.subfield ?? '') ?? null)
            : null;
      const selSubfield = selIdx != null ? basemap.subfields[selIdx]! : null;
      const neighborIds = new Set(selSubfield?.neighbors.slice(0, 6).map((n) => n.id) ?? []);

      // territories
      for (let i = 0; i < basemap.subfields.length; i++) {
        const cell = geo.cells[i];
        if (!cell) continue;
        const s = basemap.subfields[i]!;
        const hue = geo.hueOf(s);
        const isHover = hoverRef.current === i;
        const isSel = selIdx === i;
        const isNeighbor = neighborIds.has(s.id);
        const dim = selSubfield != null && !isSel && !isNeighbor && !isHover;
        ctx.beginPath();
        ctx.moveTo(cell[0]![0], cell[0]![1]);
        for (const [px, py] of cell.slice(1)) ctx.lineTo(px, py);
        ctx.closePath();
        ctx.fillStyle = territoryFill(hue, isHover || isSel, dim);
        ctx.fill();
        ctx.strokeStyle = territoryStroke(hue);
        ctx.lineWidth = 0.8 / k;
        ctx.stroke();
        if (isSel || isNeighbor) {
          ctx.strokeStyle = territoryGlow(hue);
          ctx.lineWidth = (isSel ? 2.4 : 1.2) / k;
          ctx.globalAlpha = isSel ? 0.95 : 0.55;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      // library overlay: coverage glow, frontier-gap rings, and library-item dots
      const ov = overlayRef.current;
      if (ov) {
        const frontierRank = new Map(ov.frontier.map((f, i) => [f.id, i]));
        for (let i = 0; i < basemap.subfields.length; i++) {
          const cell = geo.cells[i];
          if (!cell) continue;
          const s = basemap.subfields[i]!;
          const count = ov.coverage[s.id] ?? 0;
          const rank = frontierRank.get(s.id);

          // Frontier gap: amber dashed ring on the top uncovered territories you cite into.
          if (count === 0 && rank != null && rank < 10) {
            ctx.beginPath();
            ctx.moveTo(cell[0]![0], cell[0]![1]);
            for (const [px, py] of cell.slice(1)) ctx.lineTo(px, py);
            ctx.closePath();
            ctx.strokeStyle = '#f5b642';
            ctx.globalAlpha = 0.9 - rank * 0.06;
            ctx.lineWidth = 2 / k;
            ctx.setLineDash([6 / k, 4 / k]);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
          }

          // Covered territory: warm glow proportional to how much you've read there.
          if (count > 0) {
            ctx.beginPath();
            ctx.moveTo(cell[0]![0], cell[0]![1]);
            for (const [px, py] of cell.slice(1)) ctx.lineTo(px, py);
            ctx.closePath();
            ctx.fillStyle = '#e8eefc';
            ctx.globalAlpha = Math.min(0.22, 0.05 + Math.log2(count + 1) * 0.03);
            ctx.fill();
            ctx.globalAlpha = 1;
            // library-item dots on a deterministic spiral around the centroid
            const dots = Math.min(count, 40);
            const spread = 10 + Math.sqrt(count) * 2.5;
            for (let d = 0; d < dots; d++) {
              const r = spread * Math.sqrt((d + 0.5) / dots);
              const a = d * 2.399963229728653;
              ctx.beginPath();
              ctx.arc(s.x + r * Math.cos(a), s.y + r * Math.sin(a), Math.max(0.7, 2.4 / Math.sqrt(k)), 0, 2 * Math.PI);
              ctx.fillStyle = '#ffffff';
              ctx.globalAlpha = 0.92;
              ctx.fill();
              ctx.globalAlpha = 1;
            }
          }
        }
      }

      // neighbor flow arcs from the selected subfield
      if (selSubfield) {
        for (const n of selSubfield.neighbors.slice(0, 6)) {
          const j = geo.subfieldIndex.get(n.id);
          if (j == null) continue;
          const t = basemap.subfields[j]!;
          const midX = (selSubfield.x + t.x) / 2;
          const midY = (selSubfield.y + t.y) / 2 - Math.hypot(t.x - selSubfield.x, t.y - selSubfield.y) * 0.12;
          ctx.beginPath();
          ctx.moveTo(selSubfield.x, selSubfield.y);
          ctx.quadraticCurveTo(midX, midY, t.x, t.y);
          ctx.strokeStyle = territoryGlow(geo.hueOf(selSubfield));
          ctx.globalAlpha = 0.5;
          ctx.lineWidth = Math.max(0.6, 6 * n.w) / k;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      // topic dots when zoomed in
      if (k > 3.2) {
        const worldLeft = view.x;
        const worldTop = view.y;
        const worldRight = view.x + width / k;
        const worldBottom = view.y + height / k;
        for (const s of basemap.subfields) {
          if (s.x < worldLeft - 60 || s.x > worldRight + 60 || s.y < worldTop - 60 || s.y > worldBottom + 60)
            continue;
          const topics = geo.topicsBySubfield.get(s.id) ?? [];
          const hue = geo.hueOf(s);
          for (const t of topics) {
            const r = Math.min(3.2, 0.8 + Math.sqrt(t.worksCount || 1) / 220) / Math.sqrt(k);
            ctx.beginPath();
            ctx.arc(t.x, t.y, r, 0, 2 * Math.PI);
            const isTopicSel = sel?.kind === 'topic' && sel.id === t.id;
            ctx.fillStyle = isTopicSel ? '#fff' : `hsl(${hue} 70% 62%)`;
            ctx.globalAlpha = isTopicSel ? 1 : 0.75;
            ctx.fill();
            ctx.globalAlpha = 1;
          }
        }
      }

      // labels (screen-space text, so reset transform)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const toScreen = (wx: number, wy: number): [number, number] => [(wx - view.x) * k, (wy - view.y) * k];
      const halo = (text: string, x: number, y: number, size: number, alpha: number) => {
        ctx.font = `600 ${size}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = 'rgba(4, 8, 16, 0.85)';
        ctx.lineWidth = Math.max(2, size / 6);
        ctx.strokeText(text, x, y);
        ctx.fillStyle = labelColor;
        ctx.fillText(text, x, y);
        ctx.globalAlpha = 1;
      };
      if (k < 2.2) {
        const alpha = Math.max(0, Math.min(1, (2.2 - k) / 0.7));
        for (const f of geo.fieldAnchors) {
          const [sx, sy] = toScreen(f.x, f.y);
          if (sx < -100 || sx > width + 100 || sy < 0 || sy > height) continue;
          halo(f.name, sx, sy, Math.min(26, 11 + f.weight / 300), alpha);
        }
      }
      if (k >= 1.5) {
        const alpha = Math.min(1, (k - 1.5) / 0.8);
        for (let i = 0; i < basemap.subfields.length; i++) {
          const s = basemap.subfields[i]!;
          const [sx, sy] = toScreen(s.x, s.y);
          if (sx < -150 || sx > width + 150 || sy < -20 || sy > height + 20) continue;
          halo(s.name, sx, sy, 12, alpha * (hoverRef.current === i ? 1 : 0.85));
        }
      }
      if (k > 5.5) {
        const alpha = Math.min(1, (k - 5.5) / 2);
        for (const t of basemap.topics) {
          if ((t.worksCount ?? 0) < 3000 && k < 9) continue;
          const [sx, sy] = toScreen(t.x, t.y);
          if (sx < -150 || sx > width + 150 || sy < -20 || sy > height + 20) continue;
          halo(t.name, sx, sy - 5, 9.5, alpha * 0.9);
        }
      }
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const anim = animRef.current;
      if (anim) {
        const t = Math.min(1, (now - anim.start) / 650);
        const e = 1 - Math.pow(1 - t, 3);
        viewRef.current = {
          x: anim.from.x + (anim.to.x - anim.from.x) * e,
          y: anim.from.y + (anim.to.y - anim.from.y) * e,
          k: anim.from.k + (anim.to.k - anim.from.k) * e,
        };
        dirtyRef.current = true;
        if (t >= 1) animRef.current = null;
      }
      if (dirtyRef.current) {
        dirtyRef.current = false;
        draw();
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [basemap, geo]);

  // redraw on selection / overlay change
  useEffect(() => {
    dirtyRef.current = true;
  }, [selection, overlay]);

  // fly-to
  useEffect(() => {
    if (!flyTarget) return;
    const canvas = canvasRef.current!;
    const { width, height } = canvas.getBoundingClientRect();
    animRef.current = {
      from: { ...viewRef.current },
      to: {
        k: flyTarget.k,
        x: flyTarget.x - width / flyTarget.k / 2,
        y: flyTarget.y - height / flyTarget.k / 2,
      },
      start: performance.now(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTarget?.nonce]);

  // ---------- interaction ----------
  useEffect(() => {
    const canvas = canvasRef.current!;
    let dragging = false;
    let moved = false;
    let last: [number, number] = [0, 0];

    const toWorld = (e: MouseEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      const v = viewRef.current;
      return [v.x + (e.clientX - r.left) / v.k, v.y + (e.clientY - r.top) / v.k];
    };

    const subfieldAt = (wx: number, wy: number): number | null => {
      const i = geo.delaunay.find(wx, wy);
      if (i < basemap.subfields.length) {
        const s = basemap.subfields[i]!;
        // guard against clicks far out at sea snapping to a coast cell
        if (Math.hypot(s.x - wx, s.y - wy) < WATER_MIN_DIST * 2.5) return i;
      }
      return null;
    };

    const topicAt = (wx: number, wy: number): string | null => {
      const v = viewRef.current;
      if (v.k <= 3.2) return null;
      const i = subfieldAt(wx, wy);
      if (i == null) return null;
      const sf = basemap.subfields[i]!;
      let best: { id: string; d: number } | null = null;
      for (const near of [sf.id, ...sf.neighbors.slice(0, 3).map((n) => n.id)]) {
        for (const t of geo.topicsBySubfield.get(near) ?? []) {
          const d = Math.hypot(t.x - wx, t.y - wy);
          if (d < 8 / Math.sqrt(v.k) && (!best || d < best.d)) best = { id: t.id, d };
        }
      }
      return best?.id ?? null;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const factor = Math.exp(-e.deltaY * 0.0016);
      const k = Math.max(0.3, Math.min(24, v.k * factor));
      const [wx, wy] = toWorld(e);
      const r = canvas.getBoundingClientRect();
      viewRef.current = {
        k,
        x: wx - (e.clientX - r.left) / k,
        y: wy - (e.clientY - r.top) / k,
      };
      animRef.current = null;
      dirtyRef.current = true;
    };
    const onDown = (e: MouseEvent) => {
      dragging = true;
      moved = false;
      last = [e.clientX, e.clientY];
    };
    const onMove = (e: MouseEvent) => {
      if (dragging) {
        const v = viewRef.current;
        const dx = (e.clientX - last[0]) / v.k;
        const dy = (e.clientY - last[1]) / v.k;
        if (Math.abs(e.clientX - last[0]) + Math.abs(e.clientY - last[1]) > 3) moved = true;
        viewRef.current = { ...v, x: v.x - dx, y: v.y - dy };
        last = [e.clientX, e.clientY];
        animRef.current = null;
        dirtyRef.current = true;
        return;
      }
      const [wx, wy] = toWorld(e);
      const idx = subfieldAt(wx, wy);
      if (idx !== hoverRef.current) {
        hoverRef.current = idx;
        dirtyRef.current = true;
        hoverInfo(idx != null ? basemap.subfields[idx]!.name : null);
      }
      canvas.style.cursor = idx != null ? 'pointer' : 'grab';
    };
    const onUp = (e: MouseEvent) => {
      const wasDrag = moved;
      dragging = false;
      if (wasDrag) return;
      const [wx, wy] = toWorld(e);
      const topicId = topicAt(wx, wy);
      if (topicId) {
        onSelect({ kind: 'topic', id: topicId });
        return;
      }
      const idx = subfieldAt(wx, wy);
      onSelect(idx != null ? { kind: 'subfield', id: basemap.subfields[idx]!.id } : null);
    };
    const onLeave = () => {
      hoverRef.current = null;
      hoverInfo(null);
      dirtyRef.current = true;
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('mouseleave', onLeave);
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('mouseleave', onLeave);
    };
  }, [basemap, geo, onSelect, hoverInfo]);

  return <canvas ref={canvasRef} className="atlas-canvas" />;
}
