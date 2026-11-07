import type { Brute } from '../types';
import type { P03 } from './g03';

/** Row by row: look every reference up by linear search, compare names and dates as the statement says. */
export const brute: Brute<P03> = (p) => {
  const wantedAreas = p.q.areas.map((i) => p.areas[i]);
  let incoming = 0;
  let outgoing = 0;
  for (const m of p.log) {
    let item;
    for (const it of p.items) if (it.id === m.item) item = it;
    let place;
    for (const pl of p.places) if (pl.id === m.place) place = pl;
    if (!item || !place) continue;
    if (p.groups[item.group] !== p.groups[p.q.group]) continue;
    if (item.price < p.q.minPrice) continue;
    if (wantedAreas.length > 0 && !wantedAreas.includes(p.areas[place.area])) continue;
    if (m.day < p.q.from || m.day > p.q.to) continue;
    const unit = p.shape === 'money' ? item.price : item.pack;
    if (m.kind === 0) incoming += m.qty * unit;
    else outgoing += m.qty * unit;
  }
  if (p.shape === 'net') return [String(incoming - outgoing)];
  return [String(p.q.kind === 0 ? incoming : outgoing)];
};
