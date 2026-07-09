import { useEffect, useMemo, useRef } from 'react';
import { Delaunay } from 'd3-delaunay';
import type { Basemap, BasemapSubfield, BasemapTopic, Focus, Overlay } from '../types';
import {
  buildFieldColors,
  chaikin,
  heatGradient,
  labelColor,
  paintBackground,
  territoryGradient,
  territoryGlow,
  territoryStroke,
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
interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Props {
  basemap: Basemap;
  focus: Focus | null; // null = world level
  overlay: Overlay | null;
  hoverInfo: (text: string | null) => void;
  onNavigate: (focus: Focus) => void;
}

export default function AtlasCanvas({ basemap, focus, overlay, onNavigate, hoverInfo }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View>({ x: 0, y: 0, k: 1 });
  const hoverRef = useRef<number | null>(null); // subfield index
  const dirtyRef = useRef(true);
  const animRef = useRef<{ from: View; to: View; start: number } | null>(null);
  const focusRef = useRef<Focus | null>(focus);
  focusRef.current = focus;
  const overlayRef = useRef<Overlay | null>(overlay);
  overlayRef.current = overlay;
  // Screen-space hitboxes for clickable field labels, refreshed each draw.
  const fieldHitsRef = useRef<{ id: string; x: number; y: number; w: number; h: number }[]>([]);

  const geo = useMemo(() => {
    const subfields = basemap.subfields;
    const seeds: [number, number][] = subfields.map((s) => [s.x, s.y]);
    const seedDelaunay = Delaunay.from(seeds);
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
    // Smoothed (soft-continent) outlines + a rough radius for gradient sizing.
    const smoothCells = cells.map((c) => (c ? chaikin(c.slice(0, -1), 2) : null));
    const cellRadius = subfields.map((s, i) => {
      const c = cells[i];
      if (!c) return 40;
      let m = 0;
      for (const [px, py] of c) m = Math.max(m, Math.hypot(px - s.x, py - s.y));
      return Math.max(20, m);
    });
    const fieldColors = buildFieldColors(basemap);
    const colorOf = (s: BasemapSubfield) =>
      fieldColors.get(s.field) ?? { h: 210, s: 60, l: 46 };
    const subfieldIndex = new Map(subfields.map((s, i) => [s.id, i]));
    const membersByField = new Map<string, number[]>();
    subfields.forEach((s, i) => {
      membersByField.set(s.field, [...(membersByField.get(s.field) ?? []), i]);
    });
    const fieldAnchors = basemap.fields
      .map((f) => {
        const members = (membersByField.get(f.id) ?? []).map((i) => subfields[i]!);
        if (!members.length) return null;
        const wsum = members.reduce((a, s) => a + Math.sqrt(s.worksCount || 1), 0);
        return {
          id: f.id,
          name: f.name,
          x: members.reduce((a, s) => a + s.x * Math.sqrt(s.worksCount || 1), 0) / wsum,
          y: members.reduce((a, s) => a + s.y * Math.sqrt(s.worksCount || 1), 0) / wsum,
          weight: wsum,
        };
      })
      .filter((f): f is NonNullable<typeof f> => !!f);
    const topicsBySubfield = new Map<string, BasemapTopic[]>();
    for (const t of basemap.topics) {
      topicsBySubfield.set(t.subfield, [...(topicsBySubfield.get(t.subfield) ?? []), t]);
    }
    const topicIndex = new Map(basemap.topics.map((t) => [t.id, t]));
    return {
      seeds,
      delaunay,
      cells,
      smoothCells,
      cellRadius,
      colorOf,
      subfieldIndex,
      membersByField,
      fieldAnchors,
      topicsBySubfield,
      topicIndex,
    };
  }, [basemap]);

  // ---------- bounds helpers for the drill-down camera ----------
  const cellBounds = (i: number): Bounds | null => {
    const cell = geo.cells[i];
    if (!cell) return null;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const [px, py] of cell) {
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
    return { minX, minY, maxX, maxY };
  };

  const boundsForFocus = (f: Focus | null): Bounds => {
    if (!f) return { minX: 30, minY: 30, maxX: 970, maxY: 970 };
    if (f.kind === 'field') {
      const members = geo.membersByField.get(f.id) ?? [];
      let b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      for (const i of members) {
        const cb = cellBounds(i);
        if (cb) b = union(b, cb);
      }
      return isFinite(b.minX) ? pad(b, 40) : boundsForFocus(null);
    }
    if (f.kind === 'subfield') {
      // Frame the topic cluster (so topic labels are readable), not the whole territory.
      const topics = geo.topicsBySubfield.get(f.id) ?? [];
      if (topics.length) {
        let b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        for (const t of topics)
          b = union(b, { minX: t.x, minY: t.y, maxX: t.x, maxY: t.y });
        return pad(b, 22);
      }
      const s = basemap.subfields[geo.subfieldIndex.get(f.id) ?? -1];
      if (s) return { minX: s.x - 60, minY: s.y - 60, maxX: s.x + 60, maxY: s.y + 60 };
    }
    if (f.kind === 'topic') {
      const t = geo.topicIndex.get(f.id);
      const s = t && basemap.subfields[geo.subfieldIndex.get(t.subfield) ?? -1];
      if (s) return { minX: s.x - 70, minY: s.y - 70, maxX: s.x + 70, maxY: s.y + 70 };
    }
    return boundsForFocus(null);
  };

  // ---------- rendering ----------
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      dirtyRef.current = true;
    };
    const viewForBounds = (b: Bounds): View => {
      const { width, height } = canvas.getBoundingClientRect();
      const k = Math.min(width / (b.maxX - b.minX), height / (b.maxY - b.minY)) * 0.92;
      return { k, x: (b.minX + b.maxX) / 2 - width / k / 2, y: (b.minY + b.maxY) / 2 - height / k / 2 };
    };
    resize();
    viewRef.current = viewForBounds(boundsForFocus(focusRef.current));
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
      paintBackground(ctx, width, height);
      ctx.setTransform(dpr * k, 0, 0, dpr * k, -view.x * dpr * k, -view.y * dpr * k);

      const f = focusRef.current;
      const fieldFocus = f?.kind === 'field' ? f.id : null;
      const focusSubId =
        f?.kind === 'subfield'
          ? f.id
          : f?.kind === 'topic'
            ? (geo.topicIndex.get(f.id)?.subfield ?? null)
            : null;
      const focusIdx = focusSubId != null ? (geo.subfieldIndex.get(focusSubId) ?? null) : null;
      const focusSubfield = focusIdx != null ? basemap.subfields[focusIdx]! : null;
      const neighborIds = new Set(focusSubfield?.neighbors.slice(0, 6).map((n) => n.id) ?? []);

      const inFocusField = (s: BasemapSubfield) =>
        fieldFocus ? s.field === fieldFocus : true;

      // territories: soft, smoothly-bordered continents with a gently-lit radial fill
      for (let i = 0; i < basemap.subfields.length; i++) {
        const cell = geo.smoothCells[i];
        if (!cell) continue;
        const s = basemap.subfields[i]!;
        const color = geo.colorOf(s);
        const isHover = hoverRef.current === i;
        const isFocus = focusIdx === i;
        const isNeighbor = neighborIds.has(s.id);
        const dim =
          (fieldFocus != null && !inFocusField(s)) ||
          (focusSubfield != null && !isFocus && !isNeighbor && !isHover);
        traceSmooth(ctx, cell);
        ctx.fillStyle = territoryGradient(ctx, s.x, s.y, geo.cellRadius[i]!, color, {
          hover: isHover,
          focus: isFocus,
          dim,
        });
        if (isFocus || isNeighbor) {
          ctx.save();
          ctx.shadowColor = territoryGlow(color);
          ctx.shadowBlur = (isFocus ? 26 : 14) * k;
          ctx.fill();
          ctx.restore();
        } else {
          ctx.fill();
        }
        ctx.strokeStyle = isFocus || isNeighbor ? territoryGlow(color) : territoryStroke(color, dim);
        ctx.lineWidth = (isFocus ? 1.8 : isNeighbor ? 1.2 : 0.7) / k;
        ctx.globalAlpha = isFocus ? 0.95 : isNeighbor ? 0.6 : 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // library overlay: coverage heat, frontier rings, library dots
      const ov = overlayRef.current;
      if (ov) {
        const maxCov = Math.max(1, ...Object.values(ov.coverage));
        const frontierRank = new Map(ov.frontier.map((g, i) => [g.id, i]));
        for (let i = 0; i < basemap.subfields.length; i++) {
          const cell = geo.smoothCells[i];
          if (!cell) continue;
          const s = basemap.subfields[i]!;
          if (fieldFocus && !inFocusField(s)) continue;
          const count = ov.coverage[s.id] ?? 0;
          const rank = frontierRank.get(s.id);
          if (count === 0 && rank != null && rank < 10) {
            traceSmooth(ctx, cell);
            ctx.strokeStyle = '#f5b642';
            ctx.globalAlpha = 0.85 - rank * 0.06;
            ctx.lineWidth = 1.8 / k;
            ctx.setLineDash([6 / k, 4 / k]);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
          }
          if (count > 0) {
            const rr = geo.cellRadius[i]!;
            // warm heat bloom — a radial gradient centred on the territory, filling its own
            // smoothed path (no clip, so no risk of leaking clip state into later draws)
            traceSmooth(ctx, cell);
            ctx.fillStyle = heatGradient(ctx, s.x, s.y, rr, count / maxCov);
            ctx.fill();
            const dots = Math.min(count, 40);
            const spread = 9 + Math.sqrt(count) * 2.3;
            for (let d = 0; d < dots; d++) {
              const r = spread * Math.sqrt((d + 0.5) / dots);
              const a = d * 2.399963229728653;
              ctx.beginPath();
              ctx.arc(s.x + r * Math.cos(a), s.y + r * Math.sin(a), Math.max(0.7, 2.2 / Math.sqrt(k)), 0, 2 * Math.PI);
              ctx.fillStyle = '#fff7e6';
              ctx.globalAlpha = 0.95;
              ctx.fill();
              ctx.globalAlpha = 1;
            }
          }
        }
      }

      // neighbor flow arcs from the focused subfield
      if (focusSubfield) {
        for (const n of focusSubfield.neighbors.slice(0, 6)) {
          const j = geo.subfieldIndex.get(n.id);
          if (j == null) continue;
          const t = basemap.subfields[j]!;
          const midX = (focusSubfield.x + t.x) / 2;
          const midY =
            (focusSubfield.y + t.y) / 2 - Math.hypot(t.x - focusSubfield.x, t.y - focusSubfield.y) * 0.12;
          ctx.beginPath();
          ctx.moveTo(focusSubfield.x, focusSubfield.y);
          ctx.quadraticCurveTo(midX, midY, t.x, t.y);
          ctx.strokeStyle = territoryGlow(geo.colorOf(focusSubfield));
          ctx.globalAlpha = 0.5;
          ctx.lineWidth = Math.max(0.6, 6 * n.w) / k;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      // ---------- labels (screen space) ----------
      // Defensively clear any canvas state (shadow/alpha) left by the fill passes so text
      // renders crisply.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
      ctx.globalAlpha = 1;
      const toScreen = (wx: number, wy: number): [number, number] => [(wx - view.x) * k, (wy - view.y) * k];
      const placed: { x: number; y: number; w: number; h: number }[] = [];
      const overlaps = (x: number, y: number, w: number, h: number) =>
        placed.some((p) => Math.abs(p.x - x) < (p.w + w) / 2 && Math.abs(p.y - y) < (p.h + h) / 2);
      const halo = (text: string, x: number, y: number, size: number, alpha: number, weight = 600) => {
        ctx.font = `${weight} ${size}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = 'rgba(4, 8, 16, 0.9)';
        ctx.lineWidth = Math.max(2.5, size / 5);
        ctx.strokeText(text, x, y);
        ctx.fillStyle = labelColor;
        ctx.fillText(text, x, y);
        ctx.globalAlpha = 1;
      };

      fieldHitsRef.current = [];

      if (!f) {
        // world: clickable field labels
        const alpha = k < 2.4 ? 1 : Math.max(0, (3.2 - k) / 0.8);
        for (const fa of geo.fieldAnchors) {
          const [sx, sy] = toScreen(fa.x, fa.y);
          if (sx < -140 || sx > width + 140 || sy < 0 || sy > height) continue;
          const size = Math.min(24, 12 + fa.weight / 320);
          halo(fa.name, sx, sy, size, alpha, 700);
          ctx.font = `700 ${size}px system-ui, sans-serif`;
          const w = ctx.measureText(fa.name).width;
          fieldHitsRef.current.push({ id: fa.id, x: sx - w / 2, y: sy - size / 2, w, h: size + 8 });
        }
        // subfield labels appear as you zoom in
        if (k >= 1.6) {
          const a = Math.min(1, (k - 1.6) / 0.8);
          for (let i = 0; i < basemap.subfields.length; i++) {
            const s = basemap.subfields[i]!;
            const [sx, sy] = toScreen(s.x, s.y);
            if (sx < -150 || sx > width + 150 || sy < -20 || sy > height + 20) continue;
            const size = 12;
            if (overlaps(sx, sy, ctx.measureText(s.name).width, size)) continue;
            halo(s.name, sx, sy, size, a * (hoverRef.current === i ? 1 : 0.85));
            placed.push({ x: sx, y: sy, w: ctx.measureText(s.name).width + 8, h: size + 6 });
          }
        }
      } else if (fieldFocus) {
        // field facet: label every member subfield clearly
        for (const i of geo.membersByField.get(fieldFocus) ?? []) {
          const s = basemap.subfields[i]!;
          const [sx, sy] = toScreen(s.x, s.y);
          const cov = overlayRef.current?.coverage[s.id] ?? 0;
          const label = cov > 0 ? `${s.name}  ·  ${cov}` : s.name;
          halo(label, sx, sy, hoverRef.current === i ? 15 : 13, 1, cov > 0 ? 700 : 600);
          placed.push({ x: sx, y: sy, w: ctx.measureText(label).width + 8, h: 20 });
        }
      }
      // Subfield/topic focus renders its topics as the readable treemap overlay (TopicTreemap),
      // so the canvas stays a clean context view — no tangled on-map topic labels.
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
    // expose for the focus-change effect
    flyTo.current = (b: Bounds) => {
      animRef.current = { from: { ...viewRef.current }, to: viewForBounds(b), start: performance.now() };
    };
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap, geo]);

  const flyTo = useRef<(b: Bounds) => void>(() => {});

  // fly the camera whenever the focus changes
  useEffect(() => {
    flyTo.current(boundsForFocus(focus));
    dirtyRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.kind, focus?.id]);

  useEffect(() => {
    dirtyRef.current = true;
  }, [overlay]);

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
    const screenXY = (e: MouseEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };

    const subfieldAt = (wx: number, wy: number): number | null => {
      const i = geo.delaunay.find(wx, wy);
      if (i < basemap.subfields.length) {
        const s = basemap.subfields[i]!;
        if (Math.hypot(s.x - wx, s.y - wy) < WATER_MIN_DIST * 2.5) return i;
      }
      return null;
    };
    const topicAt = (wx: number, wy: number): string | null => {
      const v = viewRef.current;
      if (v.k <= 3) return null;
      const i = subfieldAt(wx, wy);
      if (i == null) return null;
      const sf = basemap.subfields[i]!;
      let best: { id: string; d: number } | null = null;
      for (const near of [sf.id, ...sf.neighbors.slice(0, 3).map((n) => n.id)]) {
        for (const t of geo.topicsBySubfield.get(near) ?? []) {
          const d = Math.hypot(t.x - wx, t.y - wy);
          if (d < 10 / Math.sqrt(v.k) && (!best || d < best.d)) best = { id: t.id, d };
        }
      }
      return best?.id ?? null;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const factor = Math.exp(-e.deltaY * 0.0016);
      const k = Math.max(0.3, Math.min(28, v.k * factor));
      const [wx, wy] = toWorld(e);
      const r = canvas.getBoundingClientRect();
      viewRef.current = { k, x: wx - (e.clientX - r.left) / k, y: wy - (e.clientY - r.top) / k };
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
        if (Math.abs(e.clientX - last[0]) + Math.abs(e.clientY - last[1]) > 3) moved = true;
        viewRef.current = { ...v, x: v.x - (e.clientX - last[0]) / v.k, y: v.y - (e.clientY - last[1]) / v.k };
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
      // field-label hover cursor at world level
      const [sx, sy] = screenXY(e);
      const overField = fieldHitsRef.current.some(
        (h) => sx >= h.x && sx <= h.x + h.w && sy >= h.y && sy <= h.y + h.h,
      );
      canvas.style.cursor = idx != null || overField ? 'pointer' : 'grab';
    };
    const onUp = (e: MouseEvent) => {
      const wasDrag = moved;
      dragging = false;
      if (wasDrag) return;
      // 1. clickable field label (world level)
      const [sx, sy] = screenXY(e);
      const hitField = fieldHitsRef.current.find(
        (h) => sx >= h.x && sx <= h.x + h.w && sy >= h.y && sy <= h.y + h.h,
      );
      if (hitField) {
        onNavigate({ kind: 'field', id: hitField.id });
        return;
      }
      // 2. topic dot / label
      const [wx, wy] = toWorld(e);
      const topicId = topicAt(wx, wy);
      if (topicId) {
        onNavigate({ kind: 'topic', id: topicId });
        return;
      }
      // 3. subfield territory
      const idx = subfieldAt(wx, wy);
      if (idx != null) onNavigate({ kind: 'subfield', id: basemap.subfields[idx]!.id });
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
  }, [basemap, geo, onNavigate, hoverInfo]);

  return <canvas ref={canvasRef} className="atlas-canvas" />;
}

function traceSmooth(ctx: CanvasRenderingContext2D, cell: [number, number][]) {
  ctx.beginPath();
  ctx.moveTo(cell[0]![0], cell[0]![1]);
  for (const [px, py] of cell.slice(1)) ctx.lineTo(px, py);
  ctx.closePath();
}
function union(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}
function pad(b: Bounds, p: number): Bounds {
  return { minX: b.minX - p, minY: b.minY - p, maxX: b.maxX + p, maxY: b.maxY + p };
}
