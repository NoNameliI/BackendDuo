/**
 * Layout of the RabbitMQ scheme: columns producer → exchange(s) → queue → consumer, a barycenter order inside each
 * column, name plates beside the nodes and key plates beside the edges. Pure and deterministic (no rng, no DOM):
 * the same topology and width give the same picture, and every plate keeps clear of edges, nodes and other plates.
 */
import { labelSize } from '@/engine/drill/gen/shared/graphLayout';
import { boxCircleDist, boxGap, boxSegDist, type Box, type Pt, type Seg } from '@/engine/drill/gen/shared/plane';
import type { RabbitSnapshot } from '@/engine/sim/rabbit';
import type { Scenario } from '@/engine/sim/scenario';
import { NODE_DRAW_R, placePlates, shortenKey } from './labels';

export type NodeRole = 'producer' | 'exchange' | 'queue' | 'consumer';

/** Plain description of what the scheme shows; built from the model snapshot and the scenario. */
export interface TopologyInput {
  exchanges: { name: string; type: string }[];
  queues: string[];
  bindings: { source: string; destination: string; destinationType: 'queue' | 'exchange'; routingKey: string; arguments: Record<string, unknown> }[];
  producers: { id: string; exchange: string; routingKey: string }[];
  consumers: { id: string; queue: string; note: string }[];
}

export interface TopoNode {
  id: string;
  role: NodeRole;
  label: string;
  /** Exchange type, for the glyph inside the node. */
  type?: string;
}
export interface TopoEdge {
  from: string;
  to: string;
  /** What the plate says: binding key(s), routing key, prefetch. */
  text: string;
}
export interface Topology {
  nodes: TopoNode[];
  edges: TopoEdge[];
}

export const nodeId = {
  producer: (id: string) => `p:${id}`,
  exchange: (name: string) => `x:${name}`,
  queue: (name: string) => `q:${name}`,
  consumer: (id: string) => `c:${id}`,
};

const DEFAULT_LABEL = '(default)';
const isBuiltin = (name: string) => name === '' || name.startsWith('amq.');

/** Binding text for an edge: the key, or what replaces it for fanout and headers exchanges. */
function bindingText(type: string, key: string, args: Record<string, unknown>): string {
  if (type === 'fanout') return 'fanout';
  if (type === 'headers') {
    const pairs = Object.entries(args)
      .filter(([k]) => k !== 'x-match')
      .map(([k, v]) => `${k}=${String(v)}`)
      .sort();
    const mode = typeof args['x-match'] === 'string' ? args['x-match'] : 'all';
    return [mode, ...pairs].join(' ');
  }
  return key === '' ? '""' : key;
}

export function topologyOf(input: TopologyInput): Topology {
  const used = new Set<string>();
  for (const b of input.bindings) used.add(b.source);
  for (const p of input.producers) used.add(p.exchange);
  const exchanges = input.exchanges.filter((e) => (e.name === '' ? input.producers.some((p) => p.exchange === '') : !isBuiltin(e.name) || used.has(e.name)));
  const typeOf = new Map(input.exchanges.map((e) => [e.name, e.type]));
  const nodes: TopoNode[] = [
    ...input.producers.map((p): TopoNode => ({ id: nodeId.producer(p.id), role: 'producer', label: p.id })),
    ...exchanges.map((e): TopoNode => ({ id: nodeId.exchange(e.name), role: 'exchange', label: e.name === '' ? DEFAULT_LABEL : e.name, type: e.type })),
    ...input.queues.map((q): TopoNode => ({ id: nodeId.queue(q), role: 'queue', label: q })),
    ...input.consumers.map((c): TopoNode => ({ id: nodeId.consumer(c.id), role: 'consumer', label: c.id })),
  ];
  // One consumer may serve several queues: it is one node with several edges.
  const seenNodes = new Set<string>();
  nodes.splice(0, nodes.length, ...nodes.filter((n) => !seenNodes.has(n.id) && !!seenNodes.add(n.id)));
  const known = seenNodes;
  const merged = new Map<string, TopoEdge>();
  const add = (from: string, to: string, text: string) => {
    if (!known.has(from) || !known.has(to) || from === to) return;
    const key = `${from}>${to}`;
    const cur = merged.get(key);
    if (!cur) merged.set(key, { from, to, text });
    else if (!cur.text.split(', ').includes(text)) cur.text = `${cur.text}, ${text}`;
  };
  for (const p of input.producers) add(nodeId.producer(p.id), nodeId.exchange(p.exchange), p.routingKey === '' ? '""' : p.routingKey);
  for (const p of input.producers) {
    if (p.exchange === '' && input.queues.includes(p.routingKey)) add(nodeId.exchange(''), nodeId.queue(p.routingKey), p.routingKey);
  }
  for (const b of input.bindings) {
    const text = bindingText(typeOf.get(b.source) ?? 'direct', b.routingKey, b.arguments);
    add(nodeId.exchange(b.source), b.destinationType === 'queue' ? nodeId.queue(b.destination) : nodeId.exchange(b.destination), text);
  }
  for (const c of input.consumers) add(nodeId.queue(c.queue), nodeId.consumer(c.id), c.note);
  return { nodes, edges: [...merged.values()] };
}

/** A consumer attached to a queue right now, as the model reports it (channel string ends with the channel id). */
export interface LiveConsumer {
  vhost: string;
  queue: string;
  tag: string;
  prefetch: number;
  /** Actor that owns the channel (scenario consumer) or null for a console consumer. */
  actor: string | null;
}

export const vname = (vhost: string, name: string) => (vhost === '/' ? name : `${vhost}:${name}`);

/** Scenario actors and the live model state in the shape the scheme needs. */
export function topologyInputOf(snap: RabbitSnapshot, scenario: Scenario | null, live: readonly LiveConsumer[]): TopologyInput {
  const input: TopologyInput = { exchanges: [], queues: [], bindings: [], producers: [], consumers: [] };
  for (const v of snap.vhosts) {
    // The default and amq.* exchanges of other vhosts exist everywhere and say nothing there.
    for (const e of v.exchanges) if (v.name === '/' || !(e.name === '' || e.name.startsWith('amq.'))) input.exchanges.push({ name: vname(v.name, e.name), type: e.type });
    for (const q of v.queues) input.queues.push(vname(v.name, q.name));
    for (const b of v.bindings) {
      input.bindings.push({
        source: vname(v.name, b.source),
        destination: vname(v.name, b.destination),
        destinationType: b.destinationType,
        routingKey: b.routingKey,
        arguments: b.arguments,
      });
    }
  }
  for (const a of scenario?.actors ?? []) {
    if (a.kind === 'producer') input.producers.push({ id: a.id, exchange: a.message?.exchange ?? '', routingKey: a.message?.routingKey ?? '' });
  }
  const seen = new Set<string>();
  for (const c of live) {
    const id = c.actor ?? c.tag;
    const queue = vname(c.vhost, c.queue);
    if (seen.has(`${id}>${queue}`)) continue;
    seen.add(`${id}>${queue}`);
    input.consumers.push({ id, queue, note: c.prefetch > 0 ? `prefetch ${c.prefetch}` : 'без лимита' });
  }
  for (const a of scenario?.actors ?? []) {
    if (a.kind !== 'consumer' || !a.queue || seen.has(`${a.id}>${a.queue}`)) continue;
    seen.add(`${a.id}>${a.queue}`);
    const prefetch = Number(a.config.prefetch_count ?? 0);
    input.consumers.push({ id: a.id, queue: a.queue, note: prefetch > 0 ? `prefetch ${prefetch}` : 'без лимита' });
  }
  return input;
}

// ---------------------------------------------------------------- layout

export interface LNode extends TopoNode {
  x: number;
  y: number;
  col: number;
  /** Name as drawn (cut when the column is narrow); the full one is `label`. */
  short: string;
  /** Null in legend mode: the picture is too crowded for name plates and the names are listed under it. */
  name: Box | null;
}
export interface LEdge extends TopoEdge {
  a: number;
  b: number;
  seg: Seg;
  /** Null when the picture is too crowded for a plate: the key is then listed under the scheme. */
  plate: Box | null;
  /** Text of the plate as drawn. */
  shown: string;
}
export interface Layout {
  width: number;
  height: number;
  nodes: LNode[];
  edges: LEdge[];
  /** Every edge has its plate. */
  platesOk: boolean;
  /** Names are not drawn on the scheme: nodes carry numbers and a list under the picture gives the names. */
  legend: boolean;
}

export const PAD_X = 90;
export const MIN_STEP = 130;
/** Wider columns only flatten the edges (angles between neighbours shrink), so the picture stops growing here. */
export const MAX_STEP = 240;
const PAD_Y = 52;
const ROW_GAP = 78;
const MIN_HEIGHT = 190;
const NAME_GAP = 3;

function columnsOf(topo: Topology): Map<string, number> {
  const exchanges = topo.nodes.filter((n) => n.role === 'exchange');
  const depth = new Map(exchanges.map((n) => [n.id, 0]));
  for (let pass = 0; pass < exchanges.length; pass++) {
    let changed = false;
    for (const e of topo.edges) {
      const from = depth.get(e.from);
      const to = depth.get(e.to);
      if (from === undefined || to === undefined || from + 1 <= to || from + 1 > exchanges.length) continue;
      depth.set(e.to, from + 1);
      changed = true;
    }
    if (!changed) break;
  }
  const deepest = Math.max(0, ...depth.values());
  const raw = (n: TopoNode) => (n.role === 'producer' ? 0 : n.role === 'exchange' ? 1 + (depth.get(n.id) ?? 0) : n.role === 'queue' ? 2 + deepest : 3 + deepest);
  const used = [...new Set(topo.nodes.map(raw))].sort((a, b) => a - b);
  return new Map(topo.nodes.map((n) => [n.id, used.indexOf(raw(n))]));
}

/** Order inside columns by the mean position of neighbours: forward, backward, forward again. */
function orderColumns(topo: Topology, col: Map<string, number>, count: number): string[][] {
  const cols: string[][] = Array.from({ length: count }, () => []);
  const byLabel = [...topo.nodes].sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : a.id < b.id ? -1 : 1));
  for (const n of byLabel) cols[col.get(n.id)!].push(n.id);
  const neighbours = new Map<string, string[]>();
  for (const n of topo.nodes) neighbours.set(n.id, []);
  for (const e of topo.edges) {
    neighbours.get(e.from)!.push(e.to);
    neighbours.get(e.to)!.push(e.from);
  }
  const index = () => {
    const at = new Map<string, number>();
    for (const c of cols) c.forEach((id, i) => at.set(id, c.length > 1 ? i / (c.length - 1) : 0.5));
    return at;
  };
  const sweep = (c: number, side: -1 | 1) => {
    const at = index();
    const key = new Map<string, number>();
    for (const id of cols[c]) {
      const near = neighbours.get(id)!.filter((o) => col.get(o) === c + side);
      key.set(id, near.length ? near.reduce((s, o) => s + at.get(o)!, 0) / near.length : at.get(id)!);
    }
    const before = new Map(cols[c].map((id, i) => [id, i]));
    cols[c] = [...cols[c]].sort((a, b) => key.get(a)! - key.get(b)! || before.get(a)! - before.get(b)!);
  };
  for (let c = 1; c < count; c++) sweep(c, -1);
  for (let c = count - 2; c >= 0; c--) sweep(c, 1);
  for (let c = 1; c < count; c++) sweep(c, -1);
  return cols;
}

type Side = 'below' | 'above' | 'alternate';

/** Name plates: below or above the node, or beside it at the picture's edge; the first free spot, in the order `side` prefers. Key plates are already placed. */
function placeNames(nodes: LNode[], segs: readonly Seg[], plates: readonly Box[], count: number, width: number, height: number, maxChars: number, side: Side): { boxes: Box[]; shorts: string[]; clean: boolean } {
  const centres: Pt[] = nodes.map((n) => ({ x: n.x, y: n.y }));
  const shorts = nodes.map((n) => shortenKey(n.label, maxChars));
  const boxes: Box[] = [];
  let clean = true;
  nodes.forEach((n, i) => {
    const { w, h } = labelSize(shorts[i]);
    const free = (b: Box) =>
      b.x >= 0 &&
      b.y >= 0 &&
      b.x + b.w <= width &&
      b.y + b.h <= height &&
      segs.every((s) => boxSegDist(b, s) >= NAME_GAP) &&
      centres.every((q) => boxCircleDist(b, q, NODE_DRAW_R) >= NAME_GAP) &&
      boxes.every((o) => boxGap(b, o) >= NAME_GAP) &&
      plates.every((o) => boxGap(b, o) >= NAME_GAP);
    const tries: Box[] = [];
    const down = side === 'below' || (side === 'alternate' && (n.col + i) % 2 === 0);
    for (const d of [6, 14, 22, 30, 40]) {
      const below: Box = { x: n.x - w / 2, y: n.y + NODE_DRAW_R + d, w, h };
      const above: Box = { x: n.x - w / 2, y: n.y - NODE_DRAW_R - d - h, w, h };
      tries.push(...(down ? [below, above] : [above, below]));
    }
    // Beside the node: edges leave on one side, so a plate on the other (or a little off the axis) is often free.
    const right = (dy: number): Box => ({ x: n.x + NODE_DRAW_R + 6, y: n.y - h / 2 + dy, w, h });
    const left = (dy: number): Box => ({ x: n.x - NODE_DRAW_R - 6 - w, y: n.y - h / 2 + dy, w, h });
    for (const dy of [0, -14, 14, -26, 26]) tries.push(...(n.col >= count - 1 ? [right(dy), left(dy)] : [left(dy), right(dy)]));
    const pick = tries.find(free);
    if (!pick) clean = false;
    boxes.push(pick ?? tries[0]);
  });
  return { boxes, shorts, clean };
}

const inside = (b: Box, w: number, h: number) => b.x >= 0 && b.y >= 0 && b.x + b.w <= w && b.y + b.h <= h;

export function layoutTopology(topo: Topology, containerWidth: number): Layout {
  const col = columnsOf(topo);
  const count = topo.nodes.length ? Math.max(...col.values()) + 1 : 1;
  const cols = orderColumns(topo, col, count);
  const tallest = Math.max(1, ...cols.map((c) => c.length));
  const height = Math.max(MIN_HEIGHT, tallest * ROW_GAP + 2 * PAD_Y - 20);
  const width = Math.min(Math.max(Math.round(containerWidth), 2 * PAD_X + (count - 1) * MIN_STEP), 2 * PAD_X + Math.max(1, count - 1) * MAX_STEP);
  const step = count > 1 ? (width - 2 * PAD_X) / (count - 1) : 0;
  const at = new Map<string, LNode>();
  const nodes: LNode[] = [];
  const byId = new Map(topo.nodes.map((n) => [n.id, n]));
  cols.forEach((ids, c) => {
    ids.forEach((id, r) => {
      const n = byId.get(id)!;
      const node: LNode = {
        ...n,
        col: c,
        x: Math.round(count > 1 ? PAD_X + c * step : width / 2),
        y: Math.round(PAD_Y + ((r + 0.5) * (height - 2 * PAD_Y)) / ids.length),
        short: n.label,
        name: null,
      };
      at.set(id, node);
      nodes.push(node);
    });
  });
  const edges: LEdge[] = topo.edges.map((e) => {
    const a = nodes.indexOf(at.get(e.from)!);
    const b = nodes.indexOf(at.get(e.to)!);
    return { ...e, a, b, seg: { a: nodes[a], b: nodes[b] }, plate: null, shown: e.text };
  });
  const segs = edges.map((e) => e.seg);
  const maxFit = Math.max(8, Math.min(20, Math.floor(((step || width) - 22) / 7.8)));
  type Names = ReturnType<typeof placeNames>;
  /** Names for the given key plates: the longest cut and the side that fit. */
  const namesFor = (plates: readonly Box[]): Names | null => {
    for (const maxChars of [maxFit, 14, 10, 8, 6]) {
      for (const side of ['below', 'above', 'alternate'] as const) {
        const names = placeNames(nodes, segs, plates, count, width, height, Math.min(maxChars, maxFit), side);
        if (names.clean) return names;
      }
    }
    return null;
  };
  let names: Names | null = null;
  let platesOk = edges.length === 0;
  if (edges.length === 0) names = namesFor([]);
  for (const max of edges.length === 0 ? [] : [Infinity, 24, 16, 10, 6]) {
    const shown = edges.map((e) => shortenKey(e.text, max));
    const boxes = placePlates(nodes, segs, shown);
    if (!boxes || !boxes.every((b) => inside(b, width, height))) continue;
    names = namesFor(boxes);
    if (!names) continue;
    edges.forEach((e, i) => {
      e.plate = boxes[i];
      e.shown = shown[i];
    });
    platesOk = true;
    break;
  }
  // No room for both: names win, the keys go to a list under the scheme; failing that, the names are listed instead.
  names ??= namesFor([]);
  nodes.forEach((n, i) => {
    n.name = names ? names.boxes[i] : null;
    n.short = names ? names.shorts[i] : n.label;
  });
  return { width, height, nodes, edges, platesOk, legend: names === null };
}
