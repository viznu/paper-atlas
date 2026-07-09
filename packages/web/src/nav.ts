import type { Basemap, Focus } from './types';

/**
 * Expands any focus into a full drill-down stack so the breadcrumb is always complete:
 * a topic yields [field, subfield, topic], a subfield yields [field, subfield], etc.
 */
export function stackFor(focus: Focus, basemap: Basemap): Focus[] {
  if (focus.kind === 'field') return [focus];
  if (focus.kind === 'subfield') {
    const sf = basemap.subfields.find((s) => s.id === focus.id);
    return sf ? [{ kind: 'field', id: sf.field }, focus] : [focus];
  }
  const t = basemap.topics.find((x) => x.id === focus.id);
  const sf = t && basemap.subfields.find((s) => s.id === t.subfield);
  const stack: Focus[] = [];
  if (sf) stack.push({ kind: 'field', id: sf.field });
  if (t) stack.push({ kind: 'subfield', id: t.subfield });
  stack.push(focus);
  return stack;
}

export function focusLabel(focus: Focus, basemap: Basemap): string {
  if (focus.kind === 'field') return basemap.fields.find((f) => f.id === focus.id)?.name ?? focus.id;
  if (focus.kind === 'subfield')
    return basemap.subfields.find((s) => s.id === focus.id)?.name ?? focus.id;
  return basemap.topics.find((t) => t.id === focus.id)?.name ?? focus.id;
}
