export interface Tile<T> {
  item: T;
  value: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Squarified treemap (Bruls, Huizing & van Wijk): lays weighted items into a rectangle keeping
 * tiles close to square, so labels stay readable. Items should be sorted by value descending.
 */
export function squarify<T>(
  items: { item: T; value: number }[],
  rect: { x: number; y: number; w: number; h: number },
): Tile<T>[] {
  const total = items.reduce((a, x) => a + x.value, 0);
  if (total <= 0 || items.length === 0) return [];
  // scale values to area
  const scale = (rect.w * rect.h) / total;
  const scaled = items.map((x) => ({ ...x, area: x.value * scale }));

  const tiles: Tile<T>[] = [];
  let { x, y, w, h } = rect;
  let row: typeof scaled = [];

  const worst = (r: typeof scaled, side: number) => {
    const s = r.reduce((a, v) => a + v.area, 0);
    const maxA = Math.max(...r.map((v) => v.area));
    const minA = Math.min(...r.map((v) => v.area));
    const s2 = s * s;
    const side2 = side * side;
    return Math.max((side2 * maxA) / s2, s2 / (side2 * minA));
  };

  const layoutRow = (r: typeof scaled) => {
    const s = r.reduce((a, v) => a + v.area, 0);
    const horizontal = w >= h;
    if (horizontal) {
      const rowW = s / h;
      let cy = y;
      for (const v of r) {
        const th = v.area / rowW;
        tiles.push({ item: v.item, value: v.value, x, y: cy, w: rowW, h: th });
        cy += th;
      }
      x += rowW;
      w -= rowW;
    } else {
      const rowH = s / w;
      let cx = x;
      for (const v of r) {
        const tw = v.area / rowH;
        tiles.push({ item: v.item, value: v.value, x: cx, y, w: tw, h: rowH });
        cx += tw;
      }
      y += rowH;
      h -= rowH;
    }
  };

  const queue = [...scaled];
  while (queue.length) {
    const side = Math.min(w, h);
    const next = queue[0]!;
    const withNext = [...row, next];
    if (row.length === 0 || worst(withNext, side) <= worst(row, side)) {
      row = withNext;
      queue.shift();
    } else {
      layoutRow(row);
      row = [];
    }
  }
  if (row.length) layoutRow(row);
  return tiles;
}
