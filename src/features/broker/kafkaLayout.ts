// Pure geometry and wording for the Kafka lab: partition logs as tapes, replicas as chips, consumer groups as lanes.
// Nothing here touches the DOM; the views (KafkaLogs, GroupLanes) only draw what these functions return.
import type { GroupDescription, KafkaSnapshot, PartitionSnapshot } from '@/engine/sim/kafka';

export const TAPE_PAD = 8;
export const TAPE_H = 22;
/** Characters of a mark label are drawn at about this many px each (12 px monospace). */
const CHAR_W = 7.2;
const LABEL_GAP = 6;
/** Per-offset cells with numbers are drawn only while they stay readable. */
const MIN_CELL_W = 20;

export interface Mark {
  /** What stands at this offset: 'logStart' | 'hw' | 'leo' (equal offsets merge into one mark). */
  kinds: ('logStart' | 'hw' | 'leo')[];
  offset: number;
  x: number;
  text: string;
  /** Row of the label above the tape: labels that would overlap go one row higher. */
  lane: number;
  /** Label x clamped into the drawing so that the text stays inside. */
  labelX: number;
  anchor: 'start' | 'middle' | 'end';
}

export interface SegmentView {
  base: number;
  /** First offset after the segment (next base, or the log end for the active one). */
  end: number;
  records: number;
  bytes: number;
  closed: boolean;
  /** Offsets inside the segment that no longer hold a record (compaction). */
  removed: number;
  x0: number;
  x1: number;
}

export interface ReplicaChip {
  broker: number;
  role: 'leader' | 'isr' | 'out';
  up: boolean;
  leo: number;
  /** Records the replica still has to fetch from the leader. */
  behind: number;
  text: string;
}

export interface TapeLayout {
  id: string;
  topic: string;
  partition: number;
  width: number;
  height: number;
  /** Offsets shown: [lo, hi). */
  lo: number;
  hi: number;
  hw: number;
  empty: boolean;
  /** Pixels per offset. */
  unit: number;
  /** Every offset gets a cell with its number. */
  perOffset: boolean;
  /** Region of offsets below the high watermark (visible to consumers) and above it (written, not yet safe). */
  safe: { x: number; w: number };
  pending: { x: number; w: number };
  marks: Mark[];
  segments: SegmentView[];
  /** Offsets before logStart removed by retention. */
  deleted: number;
  replicas: ReplicaChip[];
  leader: number | null;
  epoch: number;
  /** One line for the screen reader and the tooltip. */
  summary: string;
  status: 'ok' | 'underReplicated' | 'offline';
}

const MARK_TEXT = { logStart: 'начало', hw: 'HW', leo: 'LEO' } as const;

/** Greedy label placement: a label goes to the lowest row where it does not touch the previous one. */
function placeMarks(raw: { kinds: Mark['kinds']; offset: number; x: number }[], width: number): Mark[] {
  const rows: { from: number; to: number }[][] = [];
  const out: Mark[] = [];
  for (const m of [...raw].sort((a, b) => a.x - b.x)) {
    const text = m.kinds.map((k) => MARK_TEXT[k]).join(' = ') + ` ${m.offset}`;
    const w = text.length * CHAR_W;
    const anchor: Mark['anchor'] = m.x - w / 2 < 0 ? 'start' : m.x + w / 2 > width ? 'end' : 'middle';
    const from = anchor === 'start' ? m.x : anchor === 'end' ? m.x - w : m.x - w / 2;
    const to = from + w;
    let lane = 0;
    while (rows[lane]?.some((r) => from < r.to + LABEL_GAP && to > r.from - LABEL_GAP)) lane++;
    (rows[lane] ??= []).push({ from, to });
    out.push({ ...m, text, lane, labelX: m.x, anchor });
  }
  return out;
}

const roleOf = (p: PartitionSnapshot, broker: number): ReplicaChip['role'] => (broker === p.leader ? 'leader' : p.isr.includes(broker) ? 'isr' : 'out');

/** Geometry of one partition: the leader's log as a tape of `width` px, marks, segments and one chip per replica. */
export function layoutPartition(p: PartitionSnapshot, width: number, up: ReadonlySet<number> = new Set([1, 2, 3])): TapeLayout {
  const inner = Math.max(40, width - TAPE_PAD * 2);
  const lo = p.logStart;
  const hi = Math.max(p.leo, lo);
  const span = hi - lo;
  const unit = span > 0 ? inner / span : 0;
  const xOf = (o: number) => TAPE_PAD + Math.max(0, Math.min(span, o - lo)) * unit;
  const hw = Math.max(lo, Math.min(p.hw, hi));
  const leaderLog = p.leader === null ? undefined : p.logs[p.leader];
  const merged = new Map<number, Mark['kinds']>();
  const put = (offset: number, kind: Mark['kinds'][number]) => merged.set(offset, [...(merged.get(offset) ?? []), kind]);
  put(lo, 'logStart');
  put(hw, 'hw');
  put(hi, 'leo');
  const marks = placeMarks([...merged].map(([offset, kinds]) => ({ kinds, offset, x: xOf(offset) })), width);

  const bases = (leaderLog?.segments ?? []).map((s) => s.base);
  const segments: SegmentView[] = (leaderLog?.segments ?? []).map((s, i) => {
    const end = i + 1 < bases.length ? bases[i + 1] : Math.max(hi, s.base);
    const from = Math.max(s.base, lo);
    return { base: s.base, end, records: s.records, bytes: s.bytes, closed: s.closed, removed: Math.max(0, end - from - s.records), x0: xOf(from), x1: xOf(end) };
  });

  const replicas: ReplicaChip[] = p.replicas.map((b) => {
    const role = roleOf(p, b);
    const leo = p.logs[b]?.leo ?? 0;
    const behind = role === 'leader' ? 0 : Math.max(0, p.leo - leo);
    const alive = up.has(b);
    const word = role === 'leader' ? 'лидер' : role === 'isr' ? 'в ISR' : 'вне ISR';
    const text = `брокер ${b}: ${word}${alive ? '' : ', остановлен'}, LEO ${leo}${behind > 0 ? `, отстаёт на ${behind}` : ''}`;
    return { broker: b, role, up: alive, leo, behind, text };
  });

  const status: TapeLayout['status'] = p.leader === null ? 'offline' : p.isr.length < p.replicas.length ? 'underReplicated' : 'ok';
  const statusText = status === 'offline' ? 'нет лидера, раздел недоступен' : `ISR ${p.isr.length} из ${p.replicas.length}`;
  return {
    id: `${p.topic}-${p.partition}`,
    topic: p.topic,
    partition: p.partition,
    width,
    height: 18 * Math.max(1, marks.reduce((n, m) => Math.max(n, m.lane + 1), 1)) + TAPE_H + 6,
    lo,
    hi,
    hw,
    empty: span === 0,
    unit,
    perOffset: span > 0 && unit >= MIN_CELL_W,
    safe: { x: TAPE_PAD, w: (hw - lo) * unit },
    pending: { x: xOf(hw), w: (hi - hw) * unit },
    marks,
    segments,
    deleted: lo,
    replicas,
    leader: p.leader,
    epoch: p.epoch,
    summary: `${p.topic}-${p.partition}: смещения с ${lo} по ${Math.max(lo, hi - 1)}, HW ${p.hw}, LEO ${p.leo}, ${p.leader === null ? 'лидера нет' : `лидер — брокер ${p.leader}`}, ${statusText}`,
    status,
  };
}

/** Height of the label rows above the tape for a layout. */
export const labelRows = (t: TapeLayout): number => Math.max(1, ...t.marks.map((m) => m.lane + 1));

// ------------------------------------------------------------------------------------------------ brokers

export interface BrokerPill {
  id: number;
  up: boolean;
  text: string;
}

export function brokerPills(snap: KafkaSnapshot): BrokerPill[] {
  return snap.brokers.map((b) => {
    const text = !b.up ? 'остановлен' : b.stalledUntil > snap.now ? `не отвечает до ${(b.stalledUntil / 1000).toFixed(1).replace('.', ',')} с` : 'работает';
    return { id: b.id, up: b.up, text: `брокер ${b.id}: ${text}` };
  });
}

// ------------------------------------------------------------------------------------------------ groups

export interface LaneItem {
  tp: string;
  committed: number | null;
  logEnd: number;
  lag: number | null;
  /** Share of the log (0..1) the group has already passed. */
  done: number;
}

export interface Lane {
  memberId: string;
  /** Short name for the lane title: client id (the member id is long). */
  title: string;
  host: string;
  items: LaneItem[];
  lag: number;
}

export interface GroupModel {
  id: string;
  state: GroupDescription['state'];
  stateText: string;
  protocol: string;
  generation: number;
  coordinator: number;
  rebalancing: boolean;
  lanes: Lane[];
  /** Partitions that belong to the group's topics but have no owner at the moment. */
  orphans: LaneItem[];
  totalLag: number | null;
}

const STATE_TEXT: Record<GroupDescription['state'], string> = {
  Empty: 'нет участников',
  PreparingRebalance: 'ребаланс: ждём участников',
  CompletingRebalance: 'ребаланс: раздаём разделы',
  Stable: 'стабильна',
  Dead: 'удалена',
};

const item = (o: GroupDescription['offsets'][number]): LaneItem => ({
  tp: `${o.topic}-${o.partition}`,
  committed: o.current,
  logEnd: o.logEnd,
  lag: o.lag,
  done: o.logEnd > 0 && o.current !== null ? Math.max(0, Math.min(1, o.current / o.logEnd)) : 0,
});

export function groupModel(g: GroupDescription): GroupModel {
  const byMember = new Map<string, LaneItem[]>();
  const orphans: LaneItem[] = [];
  for (const o of g.offsets) {
    if (o.memberId === null) orphans.push(item(o));
    else byMember.set(o.memberId, [...(byMember.get(o.memberId) ?? []), item(o)]);
  }
  const lanes: Lane[] = g.members.map((m) => {
    const items = (byMember.get(m.memberId) ?? []).sort((a, b) => (a.tp < b.tp ? -1 : a.tp > b.tp ? 1 : 0));
    // A partition may be assigned but not yet in the offsets list (nothing committed, group rebalancing).
    for (const tp of m.assignment) {
      const name = `${tp.topic}-${tp.partition}`;
      if (!items.some((i) => i.tp === name)) items.push({ tp: name, committed: null, logEnd: 0, lag: null, done: 0 });
    }
    return { memberId: m.memberId, title: m.clientId || m.memberId, host: m.host, items, lag: items.reduce((n, i) => n + (i.lag ?? 0), 0) };
  });
  const lags = g.offsets.filter((o) => o.lag !== null);
  return {
    id: g.id,
    state: g.state,
    stateText: STATE_TEXT[g.state],
    protocol: g.protocol ?? '—',
    generation: g.generation,
    coordinator: g.coordinator,
    rebalancing: g.rebalancing || g.state === 'PreparingRebalance' || g.state === 'CompletingRebalance',
    lanes,
    orphans: orphans.sort((a, b) => (a.tp < b.tp ? -1 : a.tp > b.tp ? 1 : 0)),
    totalLag: lags.length ? lags.reduce((n, o) => n + (o.lag ?? 0), 0) : null,
  };
}

// ------------------------------------------------------------------------------------------------ topics

export interface TopicModel {
  name: string;
  configs: string;
  partitions: number;
  replicationFactor: number;
  underReplicated: number;
  offline: number;
}

export function topicModels(snap: KafkaSnapshot): TopicModel[] {
  return snap.topics.map((t) => ({
    name: t.name,
    configs: Object.entries(t.configs)
      .map(([k, v]) => `${k}=${v}`)
      .join(' · '),
    partitions: t.partitions.length,
    replicationFactor: t.partitions[0]?.replicas.length ?? 0,
    underReplicated: t.partitions.filter((p) => p.leader !== null && p.isr.length < p.replicas.length).length,
    offline: t.partitions.filter((p) => p.leader === null).length,
  }));
}
