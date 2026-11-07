/**
 * g03: three linked tables (items, places, movement log). Answer: int. Shapes: `volume`, `net`, `money`.
 *
 * The log refers to an item and a place by id; a group name belongs to the item, an area name to the place.
 * volume: total of qty * pack over log rows of one kind (kindIn or kindOut) matching the filters.
 * net:    same total over incoming rows minus the total over outgoing rows (may be negative).
 * money:  total of qty * price over log rows of one kind.
 * Filters: item group; log date range; area list (core, hard); minimum item price (hard).
 *   base: ~20 items, 6 places, ~1000 log rows over 30 days, group + kind + dates only.
 *   core: ~40 items, 12 places, ~3000 rows over 60 days, one area added.
 *   hard: ~60 items, 20 places, ~8000 rows over 120 days, two areas and a minimum price.
 * solve: index items and places by id, one pass over the log. steps: matched row/item/place counts and totals.
 * Reject: fewer than 6 matching rows, a zero net result.
 * Tables: t1 items (id, group, name, pack, price), t2 places (id, area, street), t3 log (id, date, place id, item id,
 *   kind, qty).
 */
import { Reject, type DataFile, type Fields, type Generator, type Level, type Rng, type Solved, type Vocab } from '../types';
import { drawWords, isoDay, makeTable, tableFile } from './shared/table';

export type Item = { id: number; group: number; name: string; pack: number; price: number };
export type Place = { id: number; area: number; street: string };
export type Move = { id: number; day: number; place: number; item: number; kind: 0 | 1; qty: number };
export type P03 = {
  shape: 'volume' | 'net' | 'money';
  groups: string[];
  areas: string[];
  kinds: [string, string]; // [incoming, outgoing]
  items: Item[];
  places: Place[];
  log: Move[];
  year: number;
  q: { group: number; areas: number[]; kind: 0 | 1; from: number; to: number; minPrice: number };
};

const SIZES = {
  base: { items: 20, places: 6, rows: 1000, days: 30, areas: 3 },
  core: { items: 40, places: 12, rows: 3000, days: 60, areas: 6 },
  hard: { items: 60, places: 20, rows: 5000, days: 120, areas: 8 },
} as const;
const MIN_ROWS = 6;

export const VOCAB03 = { groups: 6, items: 60, areas: 8, streets: 30, kinds: 2 } as const;

type Example = { id: number; date: string; place: number; area: string; street: string; item: string; group: string; pack: number; price: number; kind: string; qty: number; amount: number };
type Eval = { examples: [Example | null, Example | null]; total: number; inTotal: number; outTotal: number; rows: number; items: number; places: number };

function evaluate(p: P03): Eval {
  const itemIx = new Map(p.items.map((i) => [i.id, i]));
  const areaOf = new Map(p.places.map((pl) => [pl.id, pl.area]));
  const wantAreas = new Set(p.q.areas);
  const useAreas = p.q.areas.length > 0;
  const seenItems = new Set<number>();
  const seenPlaces = new Set<number>();
  let inTotal = 0;
  let outTotal = 0;
  let rows = 0;
  const examples: [Example | null, Example | null] = [null, null];
  const placeIx = new Map(p.places.map((pl) => [pl.id, pl]));
  for (const m of p.log) {
    if (m.day < p.q.from || m.day > p.q.to) continue;
    const item = itemIx.get(m.item)!;
    if (item.group !== p.q.group || item.price < p.q.minPrice) continue;
    if (useAreas && !wantAreas.has(areaOf.get(m.place)!)) continue;
    if (p.shape !== 'net' && m.kind !== p.q.kind) continue;
    const amount = m.qty * (p.shape === 'money' ? item.price : item.pack);
    if (examples[m.kind] === null) {
      const pl = placeIx.get(m.place)!;
      examples[m.kind] = {
        id: m.id,
        date: isoDay(p.year, m.day),
        place: m.place,
        area: p.areas[pl.area],
        street: pl.street,
        item: item.name,
        group: p.groups[item.group],
        pack: item.pack,
        price: item.price,
        kind: p.kinds[m.kind],
        qty: m.qty,
        amount,
      };
    }
    if (m.kind === 0) inTotal += amount;
    else outTotal += amount;
    rows++;
    seenItems.add(m.item);
    seenPlaces.add(m.place);
  }
  const total = p.shape === 'net' ? inTotal - outTotal : p.q.kind === 0 ? inTotal : outTotal;
  return { examples, total, inTotal, outTotal, rows, items: seenItems.size, places: seenPlaces.size };
}

function build(rng: Rng, level: Level, shape: P03['shape'], vocab: Vocab): P03 {
  const s = SIZES[level];
  const groups = drawWords(rng, vocab, 'groups', 6);
  const names = drawWords(rng, vocab, 'items', s.items);
  const areas = drawWords(rng, vocab, 'areas', s.areas);
  const streets = drawWords(rng, vocab, 'streets', 30);
  const kinds = drawWords(rng, vocab, 'kinds', 2) as [string, string];
  const items: Item[] = names.map((name, i) => ({
    id: 1001 + i * 3 + rng.int(0, 2),
    group: i % groups.length,
    name,
    pack: rng.int(2, 40) * 50,
    price: rng.int(10, 500),
  }));
  const places: Place[] = Array.from({ length: s.places }, (_, i) => ({
    id: i + 1,
    area: i < areas.length ? i : rng.int(0, areas.length - 1),
    street: streets[i % streets.length],
  }));
  const log: Move[] = [];
  for (let i = 0; i < s.rows; i++) {
    log.push({
      id: i + 1,
      day: rng.int(0, s.days - 1),
      place: rng.int(1, s.places),
      item: items[rng.int(0, items.length - 1)].id,
      kind: rng.chance(0.5) ? 0 : 1,
      qty: rng.int(1, 30),
    });
  }
  log.sort((a, b) => a.day - b.day || a.id - b.id);
  log.forEach((m, i) => (m.id = i + 1));

  const p: P03 = { shape, groups, areas, kinds, items, places, log, year: rng.int(2021, 2025), q: { group: 0, areas: [], kind: 0, from: 0, to: 0, minPrice: 0 } };
  for (let attempt = 0; attempt < 8; attempt++) {
    const span = Math.max(5, Math.floor(s.days * (0.25 + rng.next() * 0.3)));
    const from = rng.int(0, s.days - span);
    const areaCount = level === 'base' ? 0 : level === 'core' ? 1 : 2;
    p.q = {
      group: rng.int(0, groups.length - 1),
      areas: areaCount === 0 ? [] : rng.shuffle(areas.map((_, i) => i)).slice(0, areaCount).sort((a, b) => a - b),
      kind: rng.chance(0.5) ? 0 : 1,
      from,
      to: from + span - 1,
      minPrice: level === 'hard' ? rng.int(5, 20) * 10 : 0,
    };
    if (evaluate(p).rows >= MIN_ROWS) return p;
  }
  throw new Reject('too few rows');
}

function solve(p: P03): Solved {
  const e = evaluate(p);
  if (e.rows < MIN_ROWS) throw new Reject('too few rows');
  if (p.shape === 'net' && e.total === 0) throw new Reject('zero net');
  return {
    answer: String(e.total),
    steps: {
      rows: e.rows,
      itemCount: e.items,
      placeCount: e.places,
      inTotal: e.inTotal,
      outTotal: e.outTotal,
      total: e.total,
      totalNeg: e.total < 0,
      totalAbs: Math.abs(e.total),
      neg: e.total < 0,
      abs: Math.abs(e.total),
      inBigger: e.inTotal > e.outTotal,
      diffAbs: Math.abs(e.inTotal - e.outTotal),
      example: (p.shape === 'net' ? e.examples[0] : e.examples[p.q.kind]) as Fields,
      exampleOut: e.examples[1] as Fields | null ?? false,
      groupItems: p.items.filter((i) => i.group === p.q.group && i.price >= p.q.minPrice).length,
    },
  };
}

function fields(p: P03): Fields {
  const { q } = p;
  return {
    askVolume: p.shape === 'volume',
    askNet: p.shape === 'net',
    askMoney: p.shape === 'money',
    group: p.groups[q.group],
    hasAreas: q.areas.length > 0,
    areas: q.areas.map((i) => p.areas[i]),
    kind: p.kinds[q.kind],
    kindIn: p.kinds[0],
    kindOut: p.kinds[1],
    from: isoDay(p.year, q.from),
    to: isoDay(p.year, q.to),
    hasMinPrice: q.minPrice > 0,
    minPrice: q.minPrice,
    itemCount: p.items.length,
    placeCount: p.places.length,
    logCount: p.log.length,
  };
}

function files(p: P03): DataFile[] {
  return [
    tableFile(
      makeTable('t1', 5, p.items.map((i) => [i.id, p.groups[i.group], i.name, i.pack, i.price])),
      makeTable('t2', 3, p.places.map((pl) => [pl.id, p.areas[pl.area], pl.street])),
      makeTable('t3', 6, p.log.map((m) => [m.id, isoDay(p.year, m.day), m.place, m.item, p.kinds[m.kind], m.qty])),
    ),
  ];
}

export const g03: Generator<P03> = {
  id: 'g03',
  answer: { kind: 'int' },
  shapes: ['volume', 'net', 'money'],
  vocab: VOCAB03,
  generate: (rng, level, shape, vocab) => {
    if (shape !== 'volume' && shape !== 'net' && shape !== 'money') throw new Error(`g03: unknown shape "${shape}"`);
    return build(rng, level, shape, vocab);
  },
  solve,
  fields,
  files,
};
