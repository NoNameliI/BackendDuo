import type { Rng } from '../../drill/types';
import type { JournalDraft } from '../types';
import { ASSIGNORS, chooseStrategy, cooperativeSticky, range, roundRobin, sticky, type TP } from './group';
import type { Header } from './log';
import { cfgBool, cfgNum, cfgStr, type Cfg } from './producer';
import { kerr, type KafkaError, type Partition } from './replication';
import type { KafkaRule } from './rules';

export type StrategyName = keyof typeof ASSIGNORS;
export type GroupState = 'Empty' | 'PreparingRebalance' | 'CompletingRebalance' | 'Stable' | 'Dead';

export interface Rec {
  topic: string;
  partition: number;
  offset: number;
  timestamp: number;
  key: string | null;
  value: string | null;
  headers: Header[];
  msg?: string;
  n?: number;
}

export interface ConsumerConfig {
  groupId: string | null;
  strategies: StrategyName[];
  autoCommit: boolean;
  autoCommitMs: number;
  maxPollRecords: number;
  reset: 'latest' | 'earliest' | 'none';
  sessionMs: number;
  heartbeatMs: number;
  maxPollIntervalMs: number;
  initialDelayMs: number;
  metadataMaxAgeMs: number;
  autoCreateTopics: boolean;
}

const SHORT: Record<string, StrategyName> = {
  range: 'range',
  rangeassignor: 'range',
  roundrobin: 'roundrobin',
  roundrobinassignor: 'roundrobin',
  sticky: 'sticky',
  stickyassignor: 'sticky',
  'cooperative-sticky': 'cooperative-sticky',
  cooperativesticky: 'cooperative-sticky',
  cooperativestickyassignor: 'cooperative-sticky',
};

export function parseStrategies(v: string): StrategyName[] {
  return v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map((s) => {
      const name = SHORT[(s.split('.').pop() as string).toLowerCase()];
      if (!name) throw new Error(`Invalid value ${s} for configuration partition.assignment.strategy: class ${s} could not be found.`);
      return name;
    });
}

export function parseConsumerConfig(c: Cfg): ConsumerConfig {
  const reset = cfgStr(c, 'auto.offset.reset', 'latest');
  if (reset !== 'latest' && reset !== 'earliest' && reset !== 'none') {
    throw new Error(`Invalid value ${reset} for configuration auto.offset.reset: String must be one of: latest, earliest, none`);
  }
  const strategies = c['partition.assignment.strategy'] === undefined ? (['range', 'cooperative-sticky'] as StrategyName[]) : parseStrategies(cfgStr(c, 'partition.assignment.strategy', ''));
  const gid = cfgStr(c, 'group.id', '');
  return {
    groupId: gid === '' ? null : gid,
    strategies,
    autoCommit: cfgBool(c, 'enable.auto.commit', true),
    autoCommitMs: cfgNum(c, 'auto.commit.interval.ms', 5000),
    maxPollRecords: cfgNum(c, 'max.poll.records', 500),
    reset,
    sessionMs: cfgNum(c, 'session.timeout.ms', 45000),
    heartbeatMs: cfgNum(c, 'heartbeat.interval.ms', 3000),
    maxPollIntervalMs: cfgNum(c, 'max.poll.interval.ms', 300000),
    initialDelayMs: cfgNum(c, 'group.initial.rebalance.delay.ms', 3000),
    metadataMaxAgeMs: cfgNum(c, 'metadata.max.age.ms', 300000),
    autoCreateTopics: cfgBool(c, 'allow.auto.create.topics', true),
  };
}

const key = (tp: TP): string => `${tp.topic}/${tp.partition}`;
const cmp = (a: TP, b: TP): number => (a.topic < b.topic ? -1 : a.topic > b.topic ? 1 : a.partition - b.partition);
const fmt = (tps: readonly TP[]): string => (tps.length ? tps.map((t) => `${t.topic}-${t.partition}`).join(', ') : 'ничего');

export interface GroupEnv {
  readonly now: number;
  schedule(delay: number, cls: 0 | 1 | 2 | 3, kind: string, data: Record<string, unknown>): number;
  cancel(id: number): void;
  rng(stream: string): Rng;
  topicPartitions(topic: string): number | null;
  partition(topic: string, p: number): Partition | undefined;
  brokerUp(id: number): boolean;
  /** Creates a missing topic when the broker allows auto-creation. */
  autoCreate(topic: string, actor: string): boolean;
  log(d: JournalDraft & { rule?: KafkaRule }): void;
}

interface Member {
  id: string;
  consumer: Consumer;
  topics: string[];
  strategies: StrategyName[];
  joinedAt: number;
  /** What the member currently holds (cooperative keeps it across rebalances). */
  assignment: TP[];
  /** Assignment of the last generation, sent as sticky user data. */
  last: TP[];
  pending: TP[] | null;
  joined: boolean;
  rejoinNeeded: boolean;
  alive: boolean;
  sessionEv: number | null;
}

interface Committed {
  topic: string;
  partition: number;
  offset: number;
}

export class Group {
  state: GroupState = 'Empty';
  generation = 0;
  protocol: StrategyName | null = null;
  leader: string | null = null;
  readonly members = new Map<string, Member>();
  readonly offsets = new Map<string, Committed>();
  /** Completion not before this time (group.initial.rebalance.delay.ms for a new group). */
  notBefore = 0;
  round = 0;
  constructor(readonly id: string) {}
}

export interface GroupDescription {
  id: string;
  state: GroupState;
  protocol: StrategyName | null;
  coordinator: number;
  generation: number;
  rebalancing: boolean;
  members: { memberId: string; clientId: string; host: string; assignment: TP[] }[];
  offsets: { topic: string; partition: number; current: number | null; logEnd: number; lag: number | null; memberId: string | null; clientId: string | null; host: string | null }[];
}

/** Java String.hashCode over UTF-16 units. */
export function javaHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

const nextHeartbeat = (m: Member, hb: number, now: number): number => m.joinedAt + Math.ceil(Math.max(0, now - m.joinedAt) / hb) * hb;

/** Group coordinator living inside the model: classic protocol, offsets store, rebalance state machine. */
export class Coordinator {
  readonly groups = new Map<string, Group>();
  private nextMember = 1;

  constructor(private readonly env: GroupEnv) {}

  group(id: string): Group {
    let g = this.groups.get(id);
    if (!g) this.groups.set(id, (g = new Group(id)));
    return g;
  }

  coordinatorOf(groupId: string): number {
    const h = javaHash(groupId);
    const p = (h === -2147483648 ? 0 : Math.abs(h)) % 50;
    for (let i = 0; i < 3; i++) {
      const b = ((p + i) % 3) + 1;
      if (this.env.brokerUp(b)) return b;
    }
    return (p % 3) + 1;
  }

  private log(kind: string, actor: string, text: string, o: { rule?: KafkaRule; data?: Record<string, string | number | boolean | null>; subject?: string } = {}): void {
    this.env.log({ kind, actor, text, ...o });
  }

  // ------------------------------------------------------------------ membership

  /** JoinGroup of a new member; null with an error when its strategies are incompatible. */
  join(c: Consumer): KafkaError | null {
    const g = this.group(c.cfg.groupId as string);
    const lists = [...g.members.values()].map((m) => m.strategies as string[]);
    if (lists.length > 0 && chooseStrategy([...lists, c.cfg.strategies]) === null) {
      return kerr(23);
    }
    const id = `${c.id}-${this.uuid()}`;
    const m: Member = {
      id,
      consumer: c,
      topics: [...c.topics],
      strategies: c.cfg.strategies,
      joinedAt: this.env.now,
      assignment: [],
      last: [],
      pending: null,
      joined: true,
      rejoinNeeded: false,
      alive: true,
      sessionEv: null,
    };
    g.members.set(id, m);
    c.memberId = id;
    this.log('rebalance', c.id, `${c.id} присоединяется к группе ${g.id} как ${id}`, { subject: g.id });
    this.trigger(g, `новый участник ${c.id}`, m);
    return null;
  }

  private uuid(): string {
    const r = this.env.rng('memberId');
    const hex = (n: number): string => Array.from({ length: n }, () => r.int(0, 15).toString(16)).join('');
    this.nextMember++;
    return `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`;
  }

  /** Graceful LeaveGroup (close / stop): the rebalance starts at once for the others. */
  leave(c: Consumer, why: string): void {
    const g = c.cfg.groupId ? this.groups.get(c.cfg.groupId) : undefined;
    const m = g && c.memberId ? g.members.get(c.memberId) : undefined;
    if (!g || !m) return;
    this.remove(g, m, why);
  }

  /** The consumer process died: heartbeats stop, the session expires on the heartbeat grid. */
  died(c: Consumer): void {
    const g = c.cfg.groupId ? this.groups.get(c.cfg.groupId) : undefined;
    const m = g && c.memberId ? g.members.get(c.memberId) : undefined;
    if (!g || !m || !m.alive) return;
    m.alive = false;
    const last = m.joinedAt + Math.floor((this.env.now - m.joinedAt) / c.cfg.heartbeatMs) * c.cfg.heartbeatMs;
    const at = Math.max(this.env.now, last + c.cfg.sessionMs);
    m.sessionEv = this.env.schedule(at - this.env.now, 1, 'group.session', { group: g.id, member: m.id });
    this.log('fault', c.id, `${c.id}: heartbeat прекратились, сессия истечёт через ${at - this.env.now} мс (session.timeout.ms=${c.cfg.sessionMs})`, { rule: 'session-timeout', subject: g.id });
  }

  private remove(g: Group, m: Member, why: string): void {
    if (m.sessionEv !== null) this.env.cancel(m.sessionEv);
    g.members.delete(m.id);
    m.consumer.memberId = null;
    m.consumer.onRemoved();
    this.log('rebalance', m.consumer.id, `${m.consumer.id} покидает группу ${g.id}: ${why}`, { subject: g.id });
    if (g.members.size === 0) {
      g.state = 'Empty';
      g.protocol = null;
      g.leader = null;
      g.round++;
      return;
    }
    this.trigger(g, `${m.consumer.id} ушёл (${why})`);
  }

  sessionExpired(groupId: string, memberId: string): void {
    const g = this.groups.get(groupId);
    const m = g?.members.get(memberId);
    if (!g || !m || m.alive) return;
    m.sessionEv = null;
    this.remove(g, m, 'истёк session.timeout.ms');
  }

  /** Member stopped polling longer than max.poll.interval.ms: it leaves, the next poll rejoins. */
  pollExpired(c: Consumer): void {
    const g = c.cfg.groupId ? this.groups.get(c.cfg.groupId) : undefined;
    const m = g && c.memberId ? g.members.get(c.memberId) : undefined;
    if (!g || !m || !m.alive) return;
    this.log('error', c.id, `${c.id}: между вызовами poll прошло больше max.poll.interval.ms=${c.cfg.maxPollIntervalMs}, участник исключён из группы`, { rule: 'session-timeout', subject: g.id });
    this.remove(g, m, 'превышен max.poll.interval.ms');
  }

  // ------------------------------------------------------------------ rebalance

  /** Starts a rebalance round; the joiner (if any) has already joined. Others notice on their next heartbeat. */
  trigger(g: Group, why: string, joiner?: Member, immediate = false): void {
    if (g.state === 'Empty' || g.state === 'Dead') {
      g.notBefore = this.env.now + (joiner?.consumer.cfg.initialDelayMs ?? 3000);
    }
    if (g.state === 'PreparingRebalance') {
      this.maybeComplete(g);
      return;
    }
    g.state = 'PreparingRebalance';
    g.round++;
    this.log('rebalance', 'coordinator', `${g.id}: начат ребаланс — ${why}`, { rule: 'eager-revoke-all', subject: g.id, data: { generation: g.generation } });
    for (const m of g.members.values()) {
      if (m === joiner) continue;
      m.joined = false;
      m.rejoinNeeded = false;
      if (!m.alive) continue;
      const at = immediate ? this.env.now : nextHeartbeat(m, m.consumer.cfg.heartbeatMs, this.env.now);
      this.env.schedule(at - this.env.now, 1, 'group.notice', { group: g.id, member: m.id, round: g.round });
    }
    const rto = Math.max(...[...g.members.values()].map((m) => m.consumer.cfg.maxPollIntervalMs), 0);
    this.env.schedule(rto, 1, 'group.rto', { group: g.id, round: g.round });
    if (g.notBefore > this.env.now) this.env.schedule(g.notBefore - this.env.now, 1, 'group.check', { group: g.id });
    this.maybeComplete(g);
  }

  notice(groupId: string, memberId: string, round: number): void {
    const g = this.groups.get(groupId);
    const m = g?.members.get(memberId);
    if (!g || !m || g.round !== round || g.state !== 'PreparingRebalance' || !m.alive) return;
    if (!m.joined) m.rejoinNeeded = true;
  }

  /** Rebalance timeout: members that did not rejoin are removed. */
  rebalanceTimeout(groupId: string, round: number): void {
    const g = this.groups.get(groupId);
    if (!g || g.round !== round || g.state !== 'PreparingRebalance') return;
    for (const m of [...g.members.values()]) if (!m.joined) this.remove(g, m, 'не успел присоединиться к ребалансу');
    if (g.state === 'PreparingRebalance') this.maybeComplete(g);
  }

  /** Called by a consumer inside poll(): it sends JoinGroup (eager consumers have revoked everything). */
  rejoined(c: Consumer): void {
    const g = c.cfg.groupId ? this.groups.get(c.cfg.groupId) : undefined;
    const m = g && c.memberId ? g.members.get(c.memberId) : undefined;
    if (!g || !m) return;
    m.joined = true;
    m.rejoinNeeded = false;
    if (g.protocol !== 'cooperative-sticky') m.assignment = [];
    m.topics = [...c.topics];
    this.maybeComplete(g);
  }

  check(groupId: string): void {
    const g = this.groups.get(groupId);
    if (g) this.maybeComplete(g);
  }

  private maybeComplete(g: Group): void {
    if (g.state !== 'PreparingRebalance') return;
    if (this.env.now < g.notBefore) return;
    for (const m of g.members.values()) if (!m.joined) return;
    this.complete(g);
  }

  private complete(g: Group): void {
    const members = [...g.members.values()];
    const leader = members.find((m) => m.id === g.leader) ?? members[0];
    const ordered = [leader, ...members.filter((m) => m !== leader)];
    const strategy = chooseStrategy(ordered.map((m) => m.strategies as string[])) as StrategyName | null;
    g.leader = leader.id;
    if (strategy === null) return;
    g.protocol = strategy;
    const counts: Record<string, number> = {};
    for (const m of members) for (const t of m.topics) {
      const n = this.env.topicPartitions(t);
      if (n !== null) counts[t] = n;
    }
    const input = members.map((m) => ({ id: m.id, topics: m.topics, owned: strategy === 'cooperative-sticky' ? m.assignment : m.last }));
    let result: Record<string, TP[]>;
    let withheld = 0;
    if (strategy === 'cooperative-sticky') {
      const { target } = cooperativeSticky(input, counts);
      const owner = new Map<string, string>();
      for (const m of members) for (const tp of m.assignment) owner.set(key(tp), m.id);
      result = {};
      for (const m of members) {
        result[m.id] = target[m.id].filter((tp) => {
          const o = owner.get(key(tp));
          const hold = o !== undefined && o !== m.id;
          if (hold) withheld++;
          return !hold;
        });
      }
    } else {
      const fn = strategy === 'range' ? range : strategy === 'roundrobin' ? roundRobin : sticky;
      result = fn(input, counts);
    }
    g.generation++;
    g.state = 'Stable';
    this.log(
      'rebalance',
      'coordinator',
      `${g.id}: поколение ${g.generation}, стратегия ${strategy}, лидер группы ${leader.consumer.id} посчитал назначение, SyncGroup раздал его${withheld > 0 ? `; ${withheld} разд. придержано до отзыва у прежнего владельца (вторая волна)` : ''}`,
      { rule: strategy === 'cooperative-sticky' ? 'coop-two-waves' : 'default-strategy', subject: g.id, data: { generation: g.generation, members: members.length } },
    );
    for (const m of members) {
      m.pending = [...(result[m.id] ?? [])].sort(cmp);
      m.last = m.pending;
      this.log('assign', m.consumer.id, `${m.consumer.id}: назначено ${fmt(m.pending)}`, { subject: g.id });
    }
  }

  /** A member got the wave-1 assignment and gave something up: a second round follows at once. */
  requestWave(c: Consumer): void {
    const g = c.cfg.groupId ? this.groups.get(c.cfg.groupId) : undefined;
    if (!g || g.state !== 'Stable') return;
    const m = g.members.get(c.memberId as string);
    if (!m) return;
    this.trigger(g, 'вторая волна cooperative-ребаланса: освобождённые разделы ещё не розданы', undefined, true);
  }

  takePending(c: Consumer): TP[] | null {
    const g = c.cfg.groupId ? this.groups.get(c.cfg.groupId) : undefined;
    const m = g && c.memberId ? g.members.get(c.memberId) : undefined;
    if (!m || !m.pending) return null;
    const p = m.pending;
    m.pending = null;
    m.assignment = [...p];
    return p;
  }

  memberState(c: Consumer): { stable: boolean; rejoin: boolean; joined: boolean; pending: boolean } | null {
    const g = c.cfg.groupId ? this.groups.get(c.cfg.groupId) : undefined;
    const m = g && c.memberId ? g.members.get(c.memberId) : undefined;
    if (!g || !m) return null;
    return { stable: g.state === 'Stable', rejoin: m.rejoinNeeded, joined: m.joined, pending: m.pending !== null };
  }

  setAssignment(c: Consumer, tps: TP[]): void {
    const g = c.cfg.groupId ? this.groups.get(c.cfg.groupId) : undefined;
    const m = g && c.memberId ? g.members.get(c.memberId) : undefined;
    if (m) m.assignment = [...tps];
  }

  /** Subscription or metadata changed for a topic: members subscribed to it must rebalance. */
  topicChanged(topic: string, why: string): void {
    for (const g of this.groups.values()) {
      if (g.state !== 'Stable') continue;
      if ([...g.members.values()].some((m) => m.topics.includes(topic))) this.trigger(g, why);
    }
  }

  // ------------------------------------------------------------------ offsets

  commit(groupId: string, tp: TP, offset: number): void {
    this.group(groupId).offsets.set(key(tp), { ...tp, offset });
  }
  committed(groupId: string, tp: TP): number | undefined {
    return this.groups.get(groupId)?.offsets.get(key(tp))?.offset;
  }

  deleteTopic(topic: string): void {
    for (const g of this.groups.values()) {
      for (const [k, o] of [...g.offsets]) if (o.topic === topic) g.offsets.delete(k);
    }
  }

  delete(groupId: string): KafkaError | null {
    const g = this.groups.get(groupId);
    if (!g) return kerr(69);
    if (g.members.size > 0) return kerr(68);
    g.state = 'Dead';
    this.groups.delete(groupId);
    return null;
  }

  describe(id: string): GroupDescription | null {
    const g = this.groups.get(id);
    if (!g) return null;
    const byTp = new Map<string, Member>();
    for (const m of g.members.values()) for (const tp of m.assignment) byTp.set(key(tp), m);
    const tps = new Map<string, TP>();
    for (const o of g.offsets.values()) tps.set(key(o), { topic: o.topic, partition: o.partition });
    for (const m of g.members.values()) for (const tp of m.assignment) tps.set(key(tp), tp);
    const rows = [...tps.values()].sort(cmp).map((tp) => {
      const part = this.env.partition(tp.topic, tp.partition);
      const current = g.offsets.get(key(tp))?.offset ?? null;
      const logEnd = part?.hw ?? 0;
      const m = byTp.get(key(tp));
      return {
        topic: tp.topic,
        partition: tp.partition,
        current,
        logEnd,
        lag: current === null ? null : Math.max(0, logEnd - current),
        memberId: m?.id ?? null,
        clientId: m?.consumer.id ?? null,
        host: m ? '/127.0.0.1' : null,
      };
    });
    return {
      id,
      state: g.state,
      protocol: g.protocol,
      coordinator: this.coordinatorOf(id),
      generation: g.generation,
      rebalancing: g.state === 'PreparingRebalance' || g.state === 'CompletingRebalance',
      members: [...g.members.values()]
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((m) => ({ memberId: m.id, clientId: m.consumer.id, host: '/127.0.0.1', assignment: [...m.assignment].sort(cmp) })),
      offsets: rows,
    };
  }

  /** Lag per partition for metrics: committed offset (position when nothing is committed yet). */
  lagOf(groupId: string): { tp: TP; lag: number }[] {
    const g = this.groups.get(groupId);
    if (!g) return [];
    const out: { tp: TP; lag: number }[] = [];
    const tps = new Map<string, TP>();
    for (const o of g.offsets.values()) tps.set(key(o), { topic: o.topic, partition: o.partition });
    for (const m of g.members.values()) for (const tp of m.assignment) tps.set(key(tp), tp);
    for (const tp of [...tps.values()].sort(cmp)) {
      const part = this.env.partition(tp.topic, tp.partition);
      if (!part) continue;
      let cur = g.offsets.get(key(tp))?.offset;
      if (cur === undefined) {
        for (const m of g.members.values()) if (m.assignment.some((a) => key(a) === key(tp))) cur = m.consumer.position(tp);
      }
      out.push({ tp, lag: Math.max(0, part.hw - (cur ?? part.hw)) });
    }
    return out;
  }
}

/** Consumer client: subscription, fetch positions, auto-commit and rebalance callbacks (all inside poll). */
export class Consumer {
  readonly cfg: ConsumerConfig;
  memberId: string | null = null;
  topics: string[] = [];
  assignment: TP[] = [];
  error: KafkaError | null = null;
  closed = false;
  private manual = false;
  private readonly positions = new Map<string, number>();
  private nextCommit: number;
  private pollEv: number | null = null;
  private joinedOnce = false;

  constructor(
    readonly id: string,
    config: Cfg,
    private readonly coord: Coordinator,
    private readonly env: GroupEnv,
  ) {
    this.cfg = parseConsumerConfig(config);
    this.nextCommit = env.now + this.cfg.autoCommitMs;
  }

  subscribe(topics: string[]): void {
    const changed = this.topics.join(',') !== topics.join(',');
    this.topics = [...topics];
    if (this.cfg.autoCreateTopics) for (const t of topics) if (this.env.topicPartitions(t) === null) this.env.autoCreate(t, this.id);
    if (changed && this.memberId && this.cfg.groupId) {
      const g = this.coord.groups.get(this.cfg.groupId);
      if (g) this.coord.trigger(g, `${this.id} изменил подписку`);
    }
  }

  /** Manual assignment: no group membership, no rebalances. */
  assign(tps: TP[]): void {
    this.manual = true;
    this.assignment = [...tps].sort(cmp);
    this.positions.clear();
    for (const tp of this.assignment) this.initPosition(tp);
  }

  seek(tp: TP, offset: number): void {
    this.positions.set(key(tp), offset);
  }
  position(tp: TP): number | undefined {
    return this.positions.get(key(tp));
  }

  /** Whether poll() can already return records (assignment applied or manual). */
  ready(): boolean {
    if (this.manual) return true;
    const s = this.coord.memberState(this);
    return s !== null && s.stable && !s.rejoin && s.joined && !s.pending;
  }

  onRemoved(): void {
    this.memberId = null;
    this.assignment = [];
    this.positions.clear();
  }

  private initPosition(tp: TP): void {
    const part = this.env.partition(tp.topic, tp.partition);
    const committed = this.cfg.groupId ? this.coord.committed(this.cfg.groupId, tp) : undefined;
    if (committed !== undefined && part && committed >= part.logStart && committed <= part.leo) {
      this.positions.set(key(tp), committed);
      return;
    }
    this.reset(tp, committed === undefined ? 'нет закоммиченного смещения' : `смещение ${committed} вне диапазона`);
  }

  private reset(tp: TP, why: string): void {
    const part = this.env.partition(tp.topic, tp.partition);
    if (this.cfg.reset === 'none') {
      this.error = kerr(1, `Undefined offset with no reset policy for partitions: [${tp.topic}-${tp.partition}]`);
      return;
    }
    const to = part ? (this.cfg.reset === 'earliest' ? part.logStart : part.hw) : 0;
    this.positions.set(key(tp), to);
    this.env.log({
      kind: 'assign',
      actor: this.id,
      subject: `${tp.topic}-${tp.partition}`,
      text: `${this.id}: ${why}, auto.offset.reset=${this.cfg.reset}, позиция ${tp.topic}-${tp.partition} = ${to}`,
      rule: 'offset-reset',
      data: { offset: to },
    });
  }

  private armPollTimer(): void {
    if (this.pollEv !== null) this.env.cancel(this.pollEv);
    this.pollEv = this.cfg.groupId && !this.manual ? this.env.schedule(this.cfg.maxPollIntervalMs, 1, 'cons.pollTimeout', { consumer: this.id }) : null;
  }

  pollTimeout(): void {
    this.pollEv = null;
    if (this.closed || !this.memberId) return;
    this.coord.pollExpired(this);
  }

  private commitPositions(tps: readonly TP[], rule: KafkaRule | undefined, why: string): void {
    const gid = this.cfg.groupId;
    if (!gid) return;
    const done: string[] = [];
    for (const tp of tps) {
      const pos = this.positions.get(key(tp));
      if (pos === undefined) continue;
      const prev = this.coord.committed(gid, tp);
      if (prev === pos) continue;
      this.coord.commit(gid, tp, pos);
      done.push(`${tp.topic}-${tp.partition}=${pos}`);
    }
    if (done.length > 0) {
      this.env.log({ kind: 'commit', actor: this.id, subject: gid, text: `${this.id}: ${why} ${done.join(', ')}`, rule, data: { count: done.length } });
    }
  }

  /** Synchronous commit of current positions; an error when the consumer is no longer a group member. */
  commitSync(): KafkaError | null {
    if (!this.cfg.groupId) return kerr(25, 'Group id is required to commit offsets');
    if (!this.manual && !this.memberId) return kerr(25);
    this.commitPositions(this.assignment, undefined, 'коммит');
    return null;
  }

  private revokeAll(): void {
    if (this.assignment.length === 0) return;
    if (this.cfg.autoCommit) this.commitPositions(this.assignment, 'auto-commit-in-poll', 'перед отзывом разделов коммит');
    this.env.log({ kind: 'revoke', actor: this.id, text: `${this.id}: eager-ребаланс, отдаёт все разделы (${fmt(this.assignment)}) и заново входит в группу`, rule: 'eager-revoke-all', subject: this.cfg.groupId ?? undefined });
    this.assignment = [];
    this.positions.clear();
  }

  /** One non-blocking poll: rebalance work, auto-commit, then the records available now. */
  poll1(): Rec[] {
    if (this.closed) return [];
    const now = this.env.now;
    this.armPollTimer();
    if (!this.manual && this.cfg.groupId) {
      if (!this.memberId) {
        if (this.topics.length === 0) return [];
        const e = this.coord.join(this);
        if (e) {
          this.error = e;
          this.env.log({ kind: 'error', actor: this.id, text: `${this.id}: JoinGroup отклонён — ${e.name}: стратегии не совместимы с группой`, rule: 'default-strategy' });
          return [];
        }
        this.joinedOnce = true;
        return [];
      }
      const pending = this.coord.takePending(this);
      if (pending) this.applyAssignment(pending);
      else {
        const s = this.coord.memberState(this);
        if (s && s.rejoin) {
          if (this.coord.groups.get(this.cfg.groupId)?.protocol !== 'cooperative-sticky') this.revokeAll();
          this.coord.rejoined(this);
          return [];
        }
        if (s && s.joined && !s.stable) return [];
      }
    }
    if (this.cfg.autoCommit && this.cfg.groupId && now >= this.nextCommit) {
      this.commitPositions(this.assignment, 'auto-commit-in-poll', 'авто-коммит внутри poll:');
      this.nextCommit = now + this.cfg.autoCommitMs;
    }
    return this.fetch();
  }

  private applyAssignment(next: TP[]): void {
    const keep = new Set(next.map(key));
    const revoked = this.assignment.filter((tp) => !keep.has(key(tp)));
    if (revoked.length > 0) {
      if (this.cfg.autoCommit) this.commitPositions(revoked, 'auto-commit-in-poll', 'перед отзывом разделов коммит');
      for (const tp of revoked) this.positions.delete(key(tp));
      this.env.log({ kind: 'revoke', actor: this.id, text: `${this.id}: отдаёт ${fmt(revoked)} (cooperative: остальные разделы не прерываются)`, rule: 'coop-two-waves', subject: this.cfg.groupId ?? undefined });
    }
    const held = new Set(this.assignment.map(key));
    this.assignment = [...next].sort(cmp);
    for (const tp of this.assignment) if (!held.has(key(tp))) this.initPosition(tp);
    this.env.log({ kind: 'assign', actor: this.id, text: `${this.id}: получил ${fmt(this.assignment)}`, subject: this.cfg.groupId ?? undefined });
    this.coord.setAssignment(this, this.assignment);
    if (revoked.length > 0) this.coord.requestWave(this);
  }

  private fetch(): Rec[] {
    const out: Rec[] = [];
    for (const tp of this.assignment) {
      if (out.length >= this.cfg.maxPollRecords) break;
      const part = this.env.partition(tp.topic, tp.partition);
      let pos = this.positions.get(key(tp));
      if (!part || pos === undefined) continue;
      if (pos < part.logStart || pos > part.leo) {
        this.reset(tp, `позиция ${pos} вне диапазона [${part.logStart}, ${part.leo}]`);
        pos = this.positions.get(key(tp));
        if (pos === undefined) continue;
      }
      const recs = part.readable(pos, this.cfg.maxPollRecords - out.length);
      for (const r of recs) {
        out.push({ topic: tp.topic, partition: tp.partition, offset: r.offset, timestamp: r.timestamp, key: r.key, value: r.value, headers: r.headers, msg: r.msg, n: r.n });
      }
      if (recs.length > 0) {
        this.positions.set(key(tp), recs[recs.length - 1].offset + 1);
        this.env.log({
          kind: 'fetch',
          actor: this.id,
          subject: `${tp.topic}-${tp.partition}`,
          text: `${this.id}: прочитано ${recs.length} зап. из ${tp.topic}-${tp.partition} (смещения ${recs[0].offset}–${recs[recs.length - 1].offset}, ниже high watermark ${part.hw})`,
          data: { count: recs.length },
        });
      }
    }
    return out;
  }

  /** close(): commits (auto-commit) and leaves the group. */
  close(): void {
    if (this.closed) return;
    if (this.cfg.autoCommit && this.cfg.groupId && (this.manual || this.memberId)) this.commitPositions(this.assignment, 'auto-commit-in-poll', 'close() коммитит');
    this.stop('close');
  }

  /** Leaves the group without committing (unsubscribe / stop). */
  stop(why = 'stop'): void {
    if (this.pollEv !== null) this.env.cancel(this.pollEv);
    this.pollEv = null;
    this.closed = true;
    if (!this.manual) this.coord.leave(this, why === 'close' ? 'close()' : 'остановлен');
    this.assignment = [];
    this.positions.clear();
  }

  /** The process dies: no commit, no LeaveGroup. */
  crash(): void {
    if (this.pollEv !== null) this.env.cancel(this.pollEv);
    this.pollEv = null;
    this.closed = true;
    if (!this.manual) this.coord.died(this);
    this.assignment = [];
    this.positions.clear();
  }

  get everJoined(): boolean {
    return this.joinedOnce;
  }
}
