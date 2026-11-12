// The lab suite: fixture screens built from the public lab primitives (src/features/broker) in deterministic states,
// including stress fixtures. No course files are read. Later stages register the real lab views here.
import { useSyncExternalStore, type ReactElement } from 'react';
import { labelSize, NODE_R } from '@/engine/drill/gen/shared/graphLayout';
import { boxCircleDist, boxSegDist, type Box, type Pt, type Seg } from '@/engine/drill/gen/shared/plane';
import { JournalView, type JournalRow } from '@/features/broker/JournalView';
import { NODE_DRAW_R, placeWithShortening, shortenKey } from '@/features/broker/labels';
import { MetricChart, type ChartSeries } from '@/features/broker/MetricChart';
import { PlayerControls } from '@/features/broker/PlayerControls';
import type { AuditCase } from './api';
import { registerSuite, settle, type AuditSuite } from './suites';

// --- scheme fixture ---------------------------------------------------------------------------------------------

interface SchemeSpec {
  /** Node names per column: producer, exchange, queue, consumer. */
  columns: string[][];
  keys: (i: number) => string;
  gap: number;
  /** Distance between columns. */
  colW?: number;
}

const COL_X = 120;
const ROLE_COLOR = ['var(--nav)', 'var(--amber)', 'var(--ok)', 'var(--fg)'];

/** Edge pairs between neighbouring columns: every node has a link, deterministic. */
function pairs(columns: string[][], offsets: number[]): [number, number][] {
  const start = columns.map((_, c) => columns.slice(0, c).reduce((n, col) => n + col.length, 0));
  const out: [number, number][] = [];
  for (let c = 0; c + 1 < columns.length; c++) {
    const from = columns[c].length;
    const to = columns[c + 1].length;
    const seen = new Set<string>();
    const add = (a: number, b: number) => {
      const k = `${a}:${b}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push([start[c] + a, start[c + 1] + b]);
      }
    };
    for (let a = 0; a < from; a++) add(a, (a + offsets[c]) % to);
    for (let b = 0; b < to; b++) add(b % from, b);
  }
  return out;
}

function SchemeFixture({ spec, traffic }: { spec: SchemeSpec; traffic: boolean }) {
  const { columns, gap } = spec;
  const colW = spec.colW ?? 210;
  const tallest = Math.max(...columns.map((c) => c.length));
  const height = tallest * gap + 40;
  const width = COL_X * 2 + colW * (columns.length - 1);
  const nodes: Pt[] = [];
  const names: string[] = [];
  const role: number[] = [];
  columns.forEach((col, c) => {
    col.forEach((name, r) => {
      nodes.push({ x: COL_X + c * colW, y: height / 2 + (r - (col.length - 1) / 2) * gap });
      names.push(name);
      role.push(c);
    });
  });
  const links = pairs(columns, [0, 1, 0]);
  const segs: Seg[] = links.map(([a, b]) => ({ a: nodes[a], b: nodes[b] }));
  // Name plates under (else above) each node, on the side where no edge touches them.
  const shortNames = names.map((n) => shortenKey(n, 18));
  const nameBoxes: Box[] = nodes.map((p, i) => {
    const { w, h } = labelSize(shortNames[i]);
    const free = (b: Box) => segs.every((s) => boxSegDist(b, s) >= 3) && nodes.every((q, k) => k === i || boxCircleDist(b, q, NODE_DRAW_R) >= 3);
    const tries: Box[] = [];
    for (const d of [6, 14, 22, 30]) {
      tries.push({ x: p.x - w / 2, y: p.y + NODE_DRAW_R + d, w, h }, { x: p.x - w / 2, y: p.y - NODE_DRAW_R - d - h, w, h });
    }
    return tries.find(free) ?? tries[0];
  });
  const placed = placeWithShortening(nodes, segs, links.map(([, b]) => spec.keys(b)), nameBoxes);
  if (!placed) throw new Error('plates do not fit');
  return (
    <svg data-audit-graph="chain" role="img" aria-label="Схема: фикстура" viewBox={`0 0 ${width} ${height}`} width={width} style={{ maxWidth: '100%', height: 'auto' }}>
      {segs.map((s, i) => (
        <line key={i} data-edge={i} x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y} stroke={traffic && i % 3 === 0 ? 'var(--nav)' : 'var(--dim)'} strokeWidth={traffic && i % 3 === 0 ? 2 : 1.5} />
      ))}
      {traffic &&
        segs.map((s, i) => <circle key={`m${i}`} cx={s.a.x + (s.b.x - s.a.x) * 0.3} cy={s.a.y + (s.b.y - s.a.y) * 0.3} r={4} fill="var(--amber)" />)}
      {placed.boxes.map((b, i) => (
        <g key={`k${i}`} data-edge={i}>
          <title>{spec.keys(links[i][1])}</title>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={4} fill="var(--raised)" stroke="var(--amber)" strokeOpacity={0.55} />
          <text x={b.x + b.w / 2} y={b.y + b.h / 2} textAnchor="middle" dominantBaseline="central" fontSize={13} fill="var(--amber)" style={{ fontFamily: 'var(--font-mono)' }}>
            {placed.texts[i]}
          </text>
        </g>
      ))}
      {nodes.map((p, i) => (
        <circle key={`n${i}`} data-node={i} cx={p.x} cy={p.y} r={NODE_R + 2} fill="var(--raised)" stroke={ROLE_COLOR[role[i]]} strokeWidth={1.5} />
      ))}
      {nameBoxes.map((b, i) => (
        <g key={`t${i}`} data-node-label={i}>
          <title>{names[i]}</title>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={4} fill="var(--panel)" stroke="var(--line-strong)" />
          <text x={b.x + b.w / 2} y={b.y + b.h / 2} textAnchor="middle" dominantBaseline="central" fontSize={13} fill="var(--fg)" style={{ fontFamily: 'var(--font-mono)' }}>
            {shortNames[i]}
          </text>
        </g>
      ))}
    </svg>
  );
}

const nameList = (prefix: string, n: number, long = false) => Array.from({ length: n }, (_, i) => (long ? `${prefix}-service-with-a-long-name-${i + 1}` : `${prefix}${i + 1}`));
const KEYS = ['order.created', 'order.*', '#', 'eu.#.paid', 'invoice', 'payments.refund.failed'];
const LONG_KEYS = (i: number) => `region.${i}.warehouse.shipment.delivery.confirmed.v2`;

// --- data for the charts and the journal ------------------------------------------------------------------------

function wave(seed: number, count: number, span: number, amp: number): [number, number][] {
  return Array.from({ length: count }, (_, i): [number, number] => [
    Math.round((i / (count - 1)) * span),
    Math.round(amp * (1 + Math.sin(i / (6 + seed)) * 0.5 + ((i * 7 + seed * 13) % 11) / 22)),
  ]);
}

const seriesOf = (n: number, long: boolean, count = 60): ChartSeries[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    label: long ? `queue.with.a.very.long.name.number-${i + 1}.depth` : `queue-${i + 1}`,
    points: wave(i, count, 30_000, 20 + i * 15),
  }));

const KINDS = ['publish', 'route', 'enqueue', 'deliver', 'ack', 'nack', 'deadletter', 'fault', 'rebalance', 'leader'];
function journal(count: number, long: boolean): JournalRow[] {
  return Array.from({ length: count }, (_, i) => ({
    seq: i + 1,
    at: i * 137,
    kind: KINDS[i % KINDS.length],
    actor: long ? `consumer-group-with-a-long-name/member-${i % 5}` : `actor-${i % 4}`,
    subject: long ? `exchange.with.long.name.${i % 3}` : `q${i % 3}`,
    msg: `m${(i % 9) + 1}`,
    text: long
      ? `Сообщение m${(i % 9) + 1} доставлено потребителю ${'очень-длинное-имя-'.repeat(2)}${i}, повторная попытка ${i % 4}`
      : `Сообщение m${(i % 9) + 1}: шаг ${i}`,
    rule: i % 3 === 0 ? 'ack-removes' : undefined,
  }));
}

// --- fixture registry -------------------------------------------------------------------------------------------

interface Fixture {
  id: string;
  /** Stress fixtures are reported as `bad` cases. */
  stress: boolean;
  states: string[];
  view(state: number): ReactElement;
}

const noop = () => {};
const player = (playing: boolean, now: number, speed: number, durationMs: number, disabled = false) => (
  <PlayerControls state={{ playing, now, speed }} durationMs={durationMs} onPlay={noop} onPause={noop} onStep={noop} onSpeed={noop} onSeek={noop} onRestart={noop} disabled={disabled} />
);

const FIXTURES: Fixture[] = [
  {
    id: 'scheme',
    stress: false,
    states: ['idle', 'traffic'],
    view: (s) => <SchemeFixture traffic={s === 1} spec={{ columns: [['producer'], ['orders'], ['q.created', 'q.paid'], ['worker-1', 'worker-2']], keys: (i) => KEYS[i % KEYS.length], gap: 90 }} />,
  },
  {
    id: 'scheme-many',
    stress: true,
    states: ['idle', 'traffic'],
    view: (s) => <SchemeFixture traffic={s === 1} spec={{ columns: [nameList('p', 2), nameList('x', 3), nameList('q', 6), nameList('c', 3)], keys: (i) => KEYS[i % KEYS.length], gap: 110, colW: 250 }} />,
  },
  {
    id: 'scheme-long',
    stress: true,
    states: ['idle', 'traffic'],
    view: (s) => <SchemeFixture traffic={s === 1} spec={{ columns: [nameList('prod', 2, true), nameList('exch', 2, true), nameList('queue', 4, true), nameList('cons', 2, true)], keys: LONG_KEYS, gap: 124, colW: 300 }} />,
  },
  {
    id: 'chart',
    stress: false,
    states: ['start', 'middle', 'end'],
    view: (s) => <MetricChart title="Глубина очередей" unit="сообщ." series={seriesOf(2, false)} now={[0, 15_000, 30_000][s]} />,
  },
  {
    id: 'chart-many',
    stress: true,
    states: ['six series', 'long labels', 'dense points'],
    view: (s) =>
      s === 2 ? (
        <MetricChart title="Плотный график" series={seriesOf(3, false, 2000)} now={20_000} />
      ) : (
        <MetricChart title="Много рядов" unit="сообщ." series={seriesOf(6, s === 1)} now={18_000} width={640} height={220} />
      ),
  },
  {
    id: 'player',
    stress: false,
    states: ['paused', 'playing', 'at end', 'disabled', 'long timeline'],
    view: (s) => [player(false, 0, 1, 30_000), player(true, 12_000, 4, 30_000), player(false, 30_000, 1, 30_000), player(false, 5_000, 2, 30_000, true), player(false, 3_600_000, 16, 7_200_000)][s],
  },
  {
    id: 'journal',
    stress: false,
    states: ['rows', 'selected'],
    view: (s) => <JournalView entries={journal(40, false)} selectedMsg={s === 1 ? 'm3' : null} onSelectMsg={noop} ruleTitle={(r) => `Правило ${r}`} />,
  },
  {
    id: 'journal-long',
    stress: true,
    states: ['long rows', 'over the limit'],
    view: (s) => <JournalView entries={journal(s === 0 ? 30 : 500, true)} selectedMsg={s === 0 ? 'm2' : null} onSelectMsg={noop} ruleTitle={(r) => `Правило ${r}`} />,
  },
];

// --- page -------------------------------------------------------------------------------------------------------

let current: { fixture: number; state: number } | null = null;
const listeners = new Set<() => void>();
const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => void listeners.delete(f);
};

export function BrokerAuditPage() {
  const cur = useSyncExternalStore(subscribe, () => current);
  const f = cur ? FIXTURES[cur.fixture] : null;
  return (
    <main className="min-h-full p-4 text-fg">
      {f && cur && (
        <section aria-label="Фикстура лаборатории" className="flex flex-col gap-3">
          {f.view(cur.state)}
        </section>
      )}
    </main>
  );
}

export const brokerSuite: AuditSuite = registerSuite({
  id: 'broker',
  plan(o) {
    const out: AuditCase[] = [];
    FIXTURES.forEach((f, i) => {
      if (o.only && !o.only.includes(i + 1)) return;
      f.states.forEach((state, s) => out.push({ suite: 'broker', n: i + 1, level: 'core', seed: s, tag: f.stress ? 'bad' : 'seed', view: 'task', label: `${f.id}/${state}` }));
    });
    return out;
  },
  async render(c) {
    if (!FIXTURES[c.n - 1]) return 'unknown fixture';
    current = { fixture: c.n - 1, state: c.seed };
    listeners.forEach((l) => l());
    await settle();
    window.scrollTo(0, 0);
    return null;
  },
});
