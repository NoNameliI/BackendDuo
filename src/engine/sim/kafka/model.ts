import { percentile } from '../metrics';
import { expandTemplate, type Scenario, type ScenarioActor } from '../scenario';
import type { JournalDraft, KernelApi, Model, SimEvent } from '../types';
import { Consumer, Coordinator, type GroupDescription, type GroupEnv, type Rec } from './consumer';
import type { TP } from './group';
import {
  Producer,
  type Cfg,
  type Delivered,
  type PRec,
  type ProducerEnv,
  type ProducerRecord,
} from './producer';
import { applyRetention, compactLog } from './retention';
import { kerr, Partition, type KafkaError, type PartitionSnapshot, type ProduceReq, type ProduceResult, type ReplEnv, type TopicConf } from './replication';
import type { KafkaRule } from './rules';

export type Result<T> = { ok: true; value: T } | { ok: false; error: KafkaError };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (code: number, text?: string): { ok: false; error: KafkaError } => ({ ok: false, error: kerr(code, text) });

export const BROKERS = [1, 2, 3] as const;
export const ISR_CHECK_MS = 500;
export const IDLE_POLL_MS = 25;
export const RECONNECT_MS = 1000;
const LATENCY_WINDOW = 500;
const FOREVER = 9223372036854775807;

type ConfKind = 'int' | 'double' | 'bool' | 'enum';
interface ConfDef {
  def: string;
  kind: ConfKind;
  min?: number;
  values?: string[];
}
export const TOPIC_CONFIGS: Record<string, ConfDef> = {
  'cleanup.policy': { def: 'delete', kind: 'enum', values: ['delete', 'compact', 'delete,compact', 'compact,delete', ''] },
  'retention.ms': { def: '604800000', kind: 'int', min: -1 },
  'retention.bytes': { def: '-1', kind: 'int', min: -1 },
  'segment.bytes': { def: '1073741824', kind: 'int', min: 1048576 },
  'segment.ms': { def: '604800000', kind: 'int', min: 1 },
  'min.insync.replicas': { def: '1', kind: 'int', min: 1 },
  'unclean.leader.election.enable': { def: 'false', kind: 'bool' },
  'delete.retention.ms': { def: '86400000', kind: 'int', min: 0 },
  'max.message.bytes': { def: '1048588', kind: 'int', min: 0 },
  'compression.type': { def: 'producer', kind: 'enum', values: ['uncompressed', 'zstd', 'lz4', 'snappy', 'gzip', 'producer'] },
  'message.timestamp.type': { def: 'CreateTime', kind: 'enum', values: ['CreateTime', 'LogAppendTime'] },
  'min.cleanable.dirty.ratio': { def: '0.5', kind: 'double', min: 0 },
  'min.compaction.lag.ms': { def: '0', kind: 'int', min: 0 },
  'max.compaction.lag.ms': { def: String(FOREVER), kind: 'int', min: 1 },
  'file.delete.delay.ms': { def: '60000', kind: 'int', min: 0 },
};
/** Broker defaults that can be changed dynamically (name '' = all brokers). */
export const BROKER_CONFIGS: Record<string, ConfDef> = {
  'min.insync.replicas': TOPIC_CONFIGS['min.insync.replicas'],
  'unclean.leader.election.enable': TOPIC_CONFIGS['unclean.leader.election.enable'],
  'auto.create.topics.enable': { def: 'true', kind: 'bool' },
  'replica.lag.time.max.ms': { def: '30000', kind: 'int', min: 1 },
};

export interface KafkaOptions {
  retentionCheckMs?: number;
  compactionCheckMs?: number;
  /** Real Kafka refuses segment.bytes below 1 MiB; tests lower the floor. */
  minSegmentBytes?: number;
  numPartitions?: number;
  defaultReplicationFactor?: number;
  fsync?: never;
}

export interface TopicSpec {
  name: string;
  partitions?: number;
  replicationFactor?: number;
  configs?: Record<string, string>;
}
export interface PartitionInfo {
  partition: number;
  leader: number | null;
  replicas: number[];
  isr: number[];
  leo: number;
  hw: number;
  logStart: number;
}
export interface TopicDescription {
  name: string;
  topicId: string;
  partitionCount: number;
  replicationFactor: number;
  /** Overrides only, in the order they were set. */
  configs: Record<string, string>;
  partitions: PartitionInfo[];
}
export type PartitionFilter = 'underReplicated' | 'underMinIsr' | 'atMinIsr' | 'unavailable';
export interface ConfigEntry {
  name: string;
  value: string;
  source: 'DYNAMIC_TOPIC_CONFIG' | 'DYNAMIC_BROKER_CONFIG' | 'DYNAMIC_DEFAULT_BROKER_CONFIG' | 'DEFAULT_CONFIG';
  sensitive: false;
}
export type ResetSpec =
  | { mode: 'earliest' | 'latest' | 'current' }
  | { mode: 'offset' | 'shift-by'; value: number }
  | { mode: 'duration'; ms: number }
  | { mode: 'datetime'; at: number }
  | { mode: 'from-file'; rows: { topic: string; partition: number; offset: number }[] };
export interface ResetRow {
  group: string;
  topic: string;
  partition: number;
  newOffset: number;
}
export interface ConsumeOptions {
  topic: string;
  partition?: number;
  offset?: number | 'earliest' | 'latest';
  fromBeginning?: boolean;
  group?: string;
  maxMessages?: number;
  /** Overall limit in virtual ms (default 60000). */
  timeoutMs?: number;
  config?: Cfg;
}
export interface ConsumeResult {
  records: Rec[];
  group: string | null;
  /** True when the loop ended because nothing new arrived (not because of --max-messages). */
  idle: boolean;
  error: KafkaError | null;
}

export interface BrokerInfo {
  id: number;
  up: boolean;
  stalledUntil: number;
}
export interface KafkaSnapshot {
  now: number;
  brokers: BrokerInfo[];
  topics: { name: string; topicId: string; configs: Record<string, string>; partitions: PartitionSnapshot[] }[];
  groups: GroupDescription[];
  producers: { id: string; pid: number | null; results: number; failed: number }[];
}

interface Topic {
  name: string;
  id: string;
  rf: number;
  configs: Map<string, string>;
  parts: Partition[];
}

interface Actor {
  cfg: ScenarioActor;
  gen: number;
  stopped: boolean;
  /** Producer: next message number. */
  n: number;
  producer?: Producer;
  consumer?: Consumer;
  batch: Rec[];
  idx: number;
  attempts: number;
  processMs: number;
  processed: Set<string>;
  processEv: number | null;
  done: boolean;
  startedAt: number;
}

const stubKernel = (): KernelApi => ({
  now: 0,
  schedule: () => 0,
  cancel: () => undefined,
  rng: () => {
    throw new Error('rng needs a kernel');
  },
  log: () => undefined,
});

const b64url = (bytes: number[]): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const num = (s: string | undefined, def: number): number => (s === undefined || s === '' || !Number.isFinite(Number(s)) ? def : Number(s));

export class KafkaModel implements Model<KafkaSnapshot> {
  readonly flavor = 'kafka' as const;
  private k: KernelApi = stubKernel();
  private clock: ((ms: number) => void) | null = null;
  private readonly up = new Map<number, boolean>(BROKERS.map((b) => [b, true]));
  private readonly stalled = new Map<number, number>();
  private readonly topics = new Map<string, Topic>();
  private readonly brokerCfg = new Map<string, Map<string, string>>();
  private readonly confCache = new Map<string, TopicConf>();
  private readonly producers = new Map<string, Producer>();
  private readonly consumers = new Map<string, Consumer>();
  private readonly actors = new Map<string, Actor>();
  private readonly acked = new Set<string>();
  private readonly dropped = new Set<string>();
  private readonly latencies: number[] = [];
  private readonly counters = { produce: 0, consume: 0 };
  private readonly history: Record<'produce' | 'consume', [number, number][]> = { produce: [], consume: [] };
  private nextPid = 1000;
  private nextConsole = 1;
  private readonly coord: Coordinator;
  private readonly o: Required<Omit<KafkaOptions, 'fsync'>>;

  constructor(
    private readonly scenario?: Scenario,
    opts: KafkaOptions = {},
  ) {
    this.o = {
      retentionCheckMs: opts.retentionCheckMs ?? 5000,
      compactionCheckMs: opts.compactionCheckMs ?? 15000,
      minSegmentBytes: opts.minSegmentBytes ?? 1048576,
      numPartitions: opts.numPartitions ?? 1,
      defaultReplicationFactor: opts.defaultReplicationFactor ?? 1,
    };
    this.coord = new Coordinator(this.groupEnv());
  }

  // ---------------------------------------------------------------- kernel

  attach(k: KernelApi): void {
    this.k = k;
    this.k.schedule(ISR_CHECK_MS, 1, 'isr.check');
    this.k.schedule(this.o.retentionCheckMs, 1, 'retention.check');
    this.k.schedule(this.o.compactionCheckMs, 1, 'compact.check');
    const sc = this.scenario;
    if (!sc) return;
    for (const a of sc.actors) {
      this.actors.set(a.id, {
        cfg: a,
        gen: 0,
        stopped: false,
        n: 1,
        batch: [],
        idx: 0,
        attempts: 0,
        processMs: a.processMs ?? 0,
        processed: new Set(),
        processEv: null,
        done: false,
        startedAt: 0,
      });
      if (a.kind === 'producer') {
        if (a.count === 0) this.actors.get(a.id)!.done = true;
        else this.k.schedule(0, 3, 'producer.tick', { actor: a.id, gen: 0 });
      } else this.k.schedule(0, 3, 'consumer.connect', { actor: a.id });
    }
    for (const f of sc.faults) {
      const { at, kind, ...data } = f;
      this.k.schedule(Math.max(0, at), 0, kind, data);
    }
  }

  /** The player gives the model a way to move the clock; blocking calls (flush, poll, `sim run`) use it. */
  setClock(advance: (ms: number) => void): void {
    this.clock = advance;
  }
  advance(ms: number): void {
    this.clock?.(ms);
  }
  get now(): number {
    return this.k.now;
  }

  private log(kind: string, actor: string, text: string, o: Partial<Omit<JournalDraft, 'kind' | 'actor' | 'text'>> & { rule?: KafkaRule } = {}): void {
    this.k.log({ kind, actor, text, ...o });
  }

  handle(ev: SimEvent): void {
    const d = ev.data;
    const actor = typeof d.actor === 'string' ? this.actors.get(d.actor) : undefined;
    switch (ev.kind) {
      case 'repl.fetch':
        this.part(String(d.topic), Number(d.partition))?.followerFetch(Number(d.broker));
        break;
      case 'produce.timeout':
        this.part(String(d.topic), Number(d.partition))?.waiterTimeout(Number(d.waiter));
        break;
      case 'isr.check':
        for (const p of this.allParts()) p.checkIsr();
        this.k.schedule(ISR_CHECK_MS, 1, 'isr.check');
        break;
      case 'retention.check':
        this.runRetention();
        this.k.schedule(this.o.retentionCheckMs, 1, 'retention.check');
        break;
      case 'compact.check':
        this.runCompaction();
        this.k.schedule(this.o.compactionCheckMs, 1, 'compact.check');
        break;
      case 'group.session':
        this.coord.sessionExpired(String(d.group), String(d.member));
        break;
      case 'group.notice':
        this.coord.notice(String(d.group), String(d.member), Number(d.round));
        break;
      case 'group.rto':
        this.coord.rebalanceTimeout(String(d.group), Number(d.round));
        break;
      case 'group.check':
        this.coord.check(String(d.group));
        break;
      case 'topic.metadata':
        this.log('rebalance', 'coordinator', `${String(d.topic)}: клиенты обновили метаданные (metadata.max.age.ms) и увидели новые разделы`, { subject: String(d.topic), rule: 'metadata-refresh' });
        this.coord.topicChanged(String(d.topic), `клиенты обновили метаданные: у топика ${String(d.topic)} изменилось число разделов`);
        break;
      case 'cons.pollTimeout':
        this.consumers.get(String(d.consumer))?.pollTimeout();
        break;
      case 'producer.tick':
        if (actor && actor.gen === Number(d.gen)) this.producerTick(actor);
        break;
      case 'consumer.connect':
        if (actor && !actor.stopped) this.connectConsumer(actor);
        break;
      case 'actor.poll':
        if (actor && actor.gen === Number(d.gen)) this.actorPoll(actor);
        break;
      case 'actor.process':
        if (actor && actor.gen === Number(d.gen)) this.actorProcess(actor);
        break;
      case 'consumer.stop':
        if (actor) this.actorStop(actor);
        break;
      case 'consumer.start':
        if (actor) {
          actor.stopped = false;
          this.connectConsumer(actor);
        }
        break;
      case 'consumer.crash':
        if (actor) this.actorCrash(actor, d.afterProcess === true);
        break;
      case 'consumer.slow':
        if (actor) {
          actor.processMs = Number(d.processMs ?? actor.processMs);
          this.log('fault', actor.cfg.id, `${actor.cfg.id}: время обработки теперь ${actor.processMs} мс`);
        }
        break;
      case 'ack.lost':
        if (actor?.producer) {
          actor.producer.lostAcks++;
          this.log('fault', actor.cfg.id, `Следующий ответ брокера для ${actor.cfg.id} потеряется по дороге`);
        }
        break;
      case 'produce.error':
        if (actor?.producer) {
          actor.producer.failNext = { code: Number(d.code ?? 6), count: Number(d.count ?? 1) };
          this.log('fault', actor.cfg.id, `Следующие запросы ${actor.cfg.id} (${Number(d.count ?? 1)}) завершатся ошибкой ${kerr(Number(d.code ?? 6)).name}`);
        }
        break;
      case 'broker.crash':
        this.crashBroker(Number(d.broker ?? 1));
        break;
      case 'broker.restart':
        this.restartBroker(Number(d.broker ?? 1));
        break;
      case 'replica.stall':
        this.stallReplica(Number(d.broker ?? 2), Number(d.ms ?? 30000));
        break;
      default:
        // Producer and other client events carry their owner in `producer`.
        if (typeof d.producer === 'string') this.producers.get(d.producer)?.handle(ev.kind, d);
    }
  }

  // ---------------------------------------------------------------- environments

  private replEnv(): ReplEnv {
    const m = this;
    return {
      get now() {
        return m.k.now;
      },
      brokerUp: (id) => m.up.get(id) === true,
      stalledUntil: (id) => m.stalled.get(id) ?? 0,
      conf: (t) => m.confFor(t),
      schedule: (delay, cls, kind, data) => m.k.schedule(delay, cls, kind, data),
      cancel: (id) => m.k.cancel(id),
      log: (d) => m.k.log(d),
      acked: (msg) => m.acked.has(msg),
      lose: (msg, text) => m.lose(msg, text),
    };
  }
  private readonly replEnvInstance: ReplEnv = this.replEnv();

  private groupEnv(): GroupEnv {
    const m = this;
    return {
      get now() {
        return m.k.now;
      },
      schedule: (delay, cls, kind, data) => m.k.schedule(delay, cls, kind, data),
      cancel: (id) => m.k.cancel(id),
      rng: (s) => m.k.rng(s),
      topicPartitions: (t) => m.topics.get(t)?.parts.length ?? null,
      partition: (t, p) => m.part(t, p),
      brokerUp: (id) => m.up.get(id) === true,
      autoCreate: (t, actor) => m.autoCreate(t, actor),
      log: (d) => m.k.log(d),
    };
  }

  /** Metadata request with auto-creation: a missing topic appears with the broker defaults. */
  private autoCreate(name: string, actor: string): boolean {
    if (this.topics.has(name)) return true;
    if (this.brokerValue(null, 'auto.create.topics.enable') === 'false') return false;
    if (!this.createTopic({ name }).ok) return false;
    this.log('fault', actor, `${actor}: топика ${name} не было, брокер создал его сам (auto.create.topics.enable=true): ${this.o.numPartitions} разд., фактор ${this.o.defaultReplicationFactor}`, {
      subject: name,
      rule: 'auto-create',
    });
    return true;
  }

  private producerEnv(): ProducerEnv {
    const m = this;
    return {
      get now() {
        return m.k.now;
      },
      schedule: (delay, cls, kind, data) => m.k.schedule(delay, cls, kind, data),
      cancel: (id) => m.k.cancel(id),
      rng: (s) => m.k.rng(s),
      partitionCount: (t, actor) => {
        if (!m.topics.has(t)) m.autoCreate(t, actor);
        return m.topics.get(t)?.parts.length ?? null;
      },
      leaderOf: (t, p) => m.part(t, p)?.leader ?? null,
      produce: (broker, topic, p, req: ProduceReq, acks, cb: (r: ProduceResult) => void) => {
        const part = m.part(topic, p);
        if (!part) return cb({ error: kerr(3), baseOffset: -1, duplicate: false });
        if (m.up.get(broker) !== true) return cb({ error: kerr(13), baseOffset: -1, duplicate: false });
        part.produce(broker, req, acks, cb);
      },
      newPid: () => m.nextPid++,
      log: (d) => m.k.log(d),
      delivered: (d, rec) => m.delivered(d, rec),
    };
  }

  private delivered(d: Delivered, rec: PRec): void {
    const producer = [...this.producers.values()].find((p) => p.results.includes(d));
    const actor = producer?.id ?? 'producer';
    const subject = d.partition >= 0 ? `${d.topic}-${d.partition}` : d.topic;
    if (d.error === null) {
      this.acked.add(d.msg);
      this.counters.produce++;
      if (producer && producer.cfg.acks !== 0) {
        this.log('confirm', actor, `${actor}: ${d.msg} подтверждено, ${subject} смещение ${d.offset}`, { subject, msg: d.msg, data: { ok: true, offset: d.offset, attempts: d.attempts } });
      }
      return;
    }
    this.log('confirm', actor, `${actor}: ${d.msg} не доставлено — ${d.error.name}`, { subject, msg: d.msg, data: { ok: false, code: d.error.code } });
    if (d.error.code !== 20 && !this.dropped.has(d.msg)) {
      this.dropped.add(d.msg);
      this.log('drop', actor, `${d.msg}: потеряно — ${d.error.name}: ${d.error.text}`, { subject, msg: d.msg, data: { reason: d.error.name } });
    }
    void rec;
  }

  private lose(msg: string, text: string): void {
    if (this.dropped.has(msg)) return;
    this.dropped.add(msg);
    this.log('drop', 'broker', text, { msg, rule: 'acks-loss', data: { reason: 'log-truncated' } });
  }

  // ---------------------------------------------------------------- config

  private brokerValue(broker: number | null, key: string): string | undefined {
    if (broker !== null) {
      const v = this.brokerCfg.get(String(broker))?.get(key);
      if (v !== undefined) return v;
    }
    return this.brokerCfg.get('')?.get(key);
  }

  confFor(topic: string): TopicConf {
    const hit = this.confCache.get(topic);
    if (hit) return hit;
    const t = this.topics.get(topic);
    const get = (key: string): string => {
      const own = t?.configs.get(key);
      if (own !== undefined) return own;
      const inherited = key in BROKER_CONFIGS ? this.brokerValue(null, key) : undefined;
      return inherited ?? (TOPIC_CONFIGS[key] ?? BROKER_CONFIGS[key]).def;
    };
    const policy = get('cleanup.policy')
      .split(',')
      .map((s) => s.trim());
    const conf: TopicConf = {
      minIsr: num(get('min.insync.replicas'), 1),
      unclean: get('unclean.leader.election.enable') === 'true',
      replicaLagMs: num(this.brokerValue(null, 'replica.lag.time.max.ms'), 30000),
      segmentBytes: num(get('segment.bytes'), 1073741824),
      segmentMs: num(get('segment.ms'), 604800000),
      retentionMs: num(get('retention.ms'), 604800000),
      retentionBytes: num(get('retention.bytes'), -1),
      deletePolicy: policy.includes('delete'),
      compactPolicy: policy.includes('compact'),
      deleteRetentionMs: num(get('delete.retention.ms'), 86400000),
      minCleanableDirtyRatio: num(get('min.cleanable.dirty.ratio'), 0.5),
      minCompactionLagMs: num(get('min.compaction.lag.ms'), 0),
      maxCompactionLagMs: num(get('max.compaction.lag.ms'), FOREVER) >= FOREVER ? Infinity : num(get('max.compaction.lag.ms'), FOREVER),
      maxMessageBytes: num(get('max.message.bytes'), 1048588),
      logAppendTime: get('message.timestamp.type') === 'LogAppendTime',
    };
    this.confCache.set(topic, conf);
    return conf;
  }

  private validateConfig(defs: Record<string, ConfDef>, key: string, value: string, what: string): KafkaError | null {
    const def = defs[key];
    if (!def) return kerr(40, `Unknown ${what} config name: ${key}`);
    const bad = (why: string): KafkaError => kerr(40, `Invalid value ${value} for configuration ${key}: ${why}`);
    switch (def.kind) {
      case 'int':
      case 'double': {
        if (value.trim() === '' || !Number.isFinite(Number(value))) return bad(`Not a number of type ${def.kind === 'int' ? 'LONG' : 'DOUBLE'}`);
        let min = def.min;
        if (key === 'segment.bytes') min = this.o.minSegmentBytes;
        if (min !== undefined && Number(value) < min) return bad(`Value must be at least ${min}`);
        return null;
      }
      case 'bool':
        return value === 'true' || value === 'false' ? null : bad('Expected value to be either true or false');
      case 'enum':
        return (def.values as string[]).includes(value) ? null : bad(`String must be one of: ${(def.values as string[]).filter((v) => v !== '').join(', ')}`);
    }
  }

  private brokerAlive(): number[] {
    return BROKERS.filter((b) => this.up.get(b) === true);
  }

  // ---------------------------------------------------------------- topics

  private part(topic: string, p: number): Partition | undefined {
    return this.topics.get(topic)?.parts[p];
  }
  private allParts(): Partition[] {
    const out: Partition[] = [];
    for (const t of this.topics.values()) out.push(...t.parts);
    return out;
  }

  private placement(p: number, rf: number): number[] {
    const alive = new Set(this.brokerAlive());
    const out: number[] = [];
    for (let i = 0; i < BROKERS.length && out.length < rf; i++) {
      const b = ((p + i) % 3) + 1;
      if (alive.has(b)) out.push(b);
    }
    return out;
  }

  private topicId(): string {
    const r = this.k.rng('topicId');
    const bytes = Array.from({ length: 16 }, () => r.int(0, 255));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return b64url(bytes);
  }

  createTopic(spec: TopicSpec): Result<{ name: string; topicId: string }> {
    const name = spec.name;
    const bad =
      name === ''
        ? 'the empty string is not allowed'
        : name === '.'
          ? "'.' is not allowed"
          : name === '..'
            ? "'..' is not allowed"
            : name.length > 249
              ? `the length of '${name}' is longer than the max allowed length 249`
              : !/^[a-zA-Z0-9._-]+$/.test(name)
                ? `'${name}' contains one or more characters other than ASCII alphanumerics, '.', '_' and '-'`
                : null;
    if (bad) return fail(17, `Topic name is invalid: ${bad}`);
    if (this.topics.has(name)) return fail(36);
    const n = spec.partitions ?? this.o.numPartitions;
    const rf = spec.replicationFactor ?? this.o.defaultReplicationFactor;
    if (!Number.isInteger(n) || n < 1) return fail(37, 'The partitions must be greater than 0');
    if (!Number.isInteger(rf) || rf < 1) return fail(38, 'Replication factor must be larger than 0.');
    const alive = this.brokerAlive().length;
    if (rf > alive) return fail(38, `Replication factor: ${rf} larger than available brokers: ${alive}.`);
    const configs = new Map<string, string>();
    for (const [key, value] of Object.entries(spec.configs ?? {})) {
      const e = this.validateConfig(TOPIC_CONFIGS, key, String(value), 'topic');
      if (e) return { ok: false, error: e };
      configs.set(key, String(value));
    }
    const topic: Topic = { name, id: this.topicId(), rf, configs, parts: [] };
    this.topics.set(name, topic);
    for (let p = 0; p < n; p++) topic.parts.push(new Partition(name, p, this.placement(p, rf), this.replEnvInstance));
    this.confCache.delete(name);
    this.log('fault', 'controller', `Создан топик ${name}: ${n} разд., фактор репликации ${rf}`, { subject: name, rule: 'placement' });
    return ok({ name, topicId: topic.id });
  }

  alterPartitions(name: string, n: number): Result<void> {
    const t = this.topics.get(name);
    if (!t) return fail(3, `Topic '${name}' does not exist as expected`);
    if (!Number.isInteger(n) || n < 1) return fail(37, 'The partitions must be greater than 0');
    const cur = t.parts.length;
    if (n < cur) return fail(37, `The topic ${name} currently has ${cur} partition(s); ${n} would not be an increase.`);
    if (n === cur) return fail(37, `Topic already has ${cur} partition(s).`);
    for (let p = cur; p < n; p++) t.parts.push(new Partition(name, p, this.placement(p, t.rf), this.replEnvInstance));
    this.log('fault', 'controller', `${name}: разделов стало ${n} (было ${cur}); ключи считаются по новому числу и могут переехать`, { subject: name, rule: 'add-partitions', data: { from: cur, to: n } });
    const subs = [...this.consumers.values()].filter((c) => c.topics.includes(name) && c.memberId);
    if (subs.length > 0) {
      const delay = Math.min(...subs.map((c) => c.cfg.metadataMaxAgeMs));
      this.k.schedule(delay, 1, 'topic.metadata', { topic: name });
    }
    return ok(undefined);
  }

  deleteTopic(name: string): Result<void> {
    const t = this.topics.get(name);
    if (!t) return fail(3, `Topic '${name}' does not exist as expected`);
    this.topics.delete(name);
    this.confCache.delete(name);
    this.coord.deleteTopic(name);
    this.log('fault', 'controller', `Топик ${name} удалён`, { subject: name });
    this.coord.topicChanged(name, `топик ${name} удалён`);
    return ok(undefined);
  }

  listTopics(): string[] {
    return [...this.topics.keys()].sort();
  }

  describeTopic(name: string, filter?: PartitionFilter): Result<TopicDescription> {
    const t = this.topics.get(name);
    if (!t) return fail(3, `Topic '${name}' does not exist as expected`);
    const min = (p: Partition): number => p.minIsr();
    const keep = (p: Partition): boolean => {
      switch (filter) {
        case 'underReplicated':
          return p.isr.length < p.replicas.length;
        case 'underMinIsr':
          return p.isr.length < min(p);
        case 'atMinIsr':
          return p.isr.length === min(p);
        case 'unavailable':
          return p.leader === null;
        default:
          return true;
      }
    };
    return ok({
      name,
      topicId: t.id,
      partitionCount: t.parts.length,
      replicationFactor: t.rf,
      configs: Object.fromEntries(t.configs),
      partitions: t.parts.filter(keep).map((p) => ({
        partition: p.index,
        leader: p.leader,
        replicas: [...p.replicas],
        isr: [...p.isr],
        leo: p.leo,
        hw: p.hw,
        logStart: p.logStart,
      })),
    });
  }

  alterConfigs(type: 'topics' | 'brokers', name: string, set: Record<string, string>, del: string[] = []): Result<void> {
    if (type === 'topics') {
      const t = this.topics.get(name);
      if (!t) return fail(3, `Topic '${name}' does not exist as expected`);
      for (const [key, value] of Object.entries(set)) {
        const e = this.validateConfig(TOPIC_CONFIGS, key, String(value), 'topic');
        if (e) return { ok: false, error: e };
      }
      for (const key of del) if (!TOPIC_CONFIGS[key]) return fail(40, `Unknown topic config name: ${key}`);
      for (const [key, value] of Object.entries(set)) t.configs.set(key, String(value));
      for (const key of del) t.configs.delete(key);
      this.confCache.delete(name);
      for (const p of t.parts) p.maybeElect();
      for (const p of t.parts) p.recomputeHw();
      return ok(undefined);
    }
    if (name !== '' && !BROKERS.includes(Number(name) as 1)) return fail(3, `Broker ${name} does not exist`);
    for (const [key, value] of Object.entries(set)) {
      const e = this.validateConfig(BROKER_CONFIGS, key, String(value), 'broker');
      if (e) return { ok: false, error: e };
    }
    for (const key of del) if (!BROKER_CONFIGS[key]) return fail(40, `Unknown broker config name: ${key}`);
    let cfg = this.brokerCfg.get(name);
    if (!cfg) this.brokerCfg.set(name, (cfg = new Map()));
    for (const [key, value] of Object.entries(set)) cfg.set(key, String(value));
    for (const key of del) cfg.delete(key);
    this.confCache.clear();
    for (const p of this.allParts()) {
      p.maybeElect();
      p.recomputeHw();
    }
    return ok(undefined);
  }

  describeConfigs(type: 'topics' | 'brokers', name: string, all = false): Result<ConfigEntry[]> {
    const out: ConfigEntry[] = [];
    if (type === 'topics') {
      const t = this.topics.get(name);
      if (!t) return fail(3, `Topic '${name}' does not exist as expected`);
      for (const [key, value] of t.configs) out.push({ name: key, value, source: 'DYNAMIC_TOPIC_CONFIG', sensitive: false });
      if (all) {
        for (const key of Object.keys(TOPIC_CONFIGS).sort()) {
          if (t.configs.has(key)) continue;
          const inherited = key in BROKER_CONFIGS ? this.brokerValue(null, key) : undefined;
          out.push({ name: key, value: inherited ?? TOPIC_CONFIGS[key].def, source: inherited !== undefined ? 'DYNAMIC_DEFAULT_BROKER_CONFIG' : 'DEFAULT_CONFIG', sensitive: false });
        }
      }
      return ok(all ? out.sort((a, b) => (a.name < b.name ? -1 : 1)) : out);
    }
    if (name !== '' && !BROKERS.includes(Number(name) as 1)) return fail(3, `Broker ${name} does not exist`);
    const own = this.brokerCfg.get(name);
    for (const [key, value] of own ?? []) out.push({ name: key, value, source: name === '' ? 'DYNAMIC_DEFAULT_BROKER_CONFIG' : 'DYNAMIC_BROKER_CONFIG', sensitive: false });
    if (all) {
      for (const key of Object.keys(BROKER_CONFIGS).sort()) {
        if (own?.has(key)) continue;
        const def = this.brokerValue(null, key);
        out.push({ name: key, value: def ?? BROKER_CONFIGS[key].def, source: def !== undefined ? 'DYNAMIC_DEFAULT_BROKER_CONFIG' : 'DEFAULT_CONFIG', sensitive: false });
      }
      out.sort((a, b) => (a.name < b.name ? -1 : 1));
    }
    return ok(out);
  }

  // ---------------------------------------------------------------- faults

  crashBroker(id: number): Result<void> {
    if (!this.up.has(id)) return fail(3, `Broker ${id} does not exist`);
    if (this.up.get(id) !== true) return ok(undefined);
    this.up.set(id, false);
    this.log('fault', `broker-${id}`, `Брокер ${id} остановлен`, { data: { broker: id } });
    for (const p of this.allParts()) p.brokerCrashed(id);
    return ok(undefined);
  }

  restartBroker(id: number): Result<void> {
    if (!this.up.has(id)) return fail(3, `Broker ${id} does not exist`);
    if (this.up.get(id) === true) return ok(undefined);
    this.up.set(id, true);
    this.stalled.delete(id);
    this.log('fault', `broker-${id}`, `Брокер ${id} запущен, логи на диске сохранились`, { data: { broker: id } });
    for (const p of this.allParts()) p.brokerRestarted(id);
    return ok(undefined);
  }

  /** The broker's follower replicas stop fetching for `ms`; the leader drops them from the ISR after replica.lag.time.max.ms. */
  stallReplica(id: number, ms: number): Result<void> {
    if (!this.up.has(id)) return fail(3, `Broker ${id} does not exist`);
    this.stalled.set(id, this.k.now + ms);
    for (const p of this.allParts()) p.markCaughtUp(id);
    this.log('fault', `broker-${id}`, `Брокер ${id}: реплики-подписчики не забирают данные ${ms} мс`, { data: { broker: id, ms } });
    return ok(undefined);
  }

  private consumerActor(id: string): Result<Actor> {
    const a = this.actors.get(id);
    if (a && a.cfg.kind === 'consumer') return ok(a);
    const known = [...this.actors.values()].filter((x) => x.cfg.kind === 'consumer').map((x) => x.cfg.id);
    return fail(3, `Нет потребителя «${id}» в сценарии. Известные: ${known.length ? known.join(', ') : 'нет'}`);
  }

  /** Same as the `consumer.start` fault: the scenario consumer joins its group again. */
  startConsumer(id: string): Result<void> {
    const r = this.consumerActor(id);
    if (!r.ok) return r;
    const a = r.value;
    if (a.stopped || !a.consumer || a.consumer.closed) {
      a.stopped = false;
      this.connectConsumer(a);
    }
    return ok(undefined);
  }

  /** Same as the `consumer.stop` fault: the scenario consumer leaves its group. */
  stopConsumer(id: string): Result<void> {
    const r = this.consumerActor(id);
    if (!r.ok) return r;
    if (!r.value.stopped) this.actorStop(r.value);
    return ok(undefined);
  }

  // ---------------------------------------------------------------- retention

  private runRetention(): void {
    for (const t of this.topics.values()) {
      for (const p of t.parts) {
        const conf = this.confFor(t.name);
        if (!conf.deletePolicy) continue;
        for (const [b, r] of p.reps) {
          const res = applyRetention(r.log, this.k.now, { retentionMs: conf.retentionMs, retentionBytes: conf.retentionBytes });
          if (res && b === p.leader) {
            this.log(
              'retention',
              `broker-${b}`,
              `${p.id}: удалено сегментов ${res.segments} (${res.records} зап., ${res.bytes} Б) — ${res.reason === 'bytes' ? 'сверх retention.bytes' : res.reason === 'time' ? 'старше retention.ms' : 'по времени и размеру'}; log start offset теперь ${res.logStart}`,
              { subject: p.id, rule: 'closed-segments-only', data: { segments: res.segments, logStart: res.logStart } },
            );
          }
        }
      }
    }
  }

  private runCompaction(): void {
    for (const t of this.topics.values()) {
      const conf = this.confFor(t.name);
      if (!conf.compactPolicy) continue;
      for (const p of t.parts) {
        for (const [b, r] of p.reps) {
          const res = compactLog(r.log, this.k.now, {
            minCleanableDirtyRatio: conf.minCleanableDirtyRatio,
            minCompactionLagMs: conf.minCompactionLagMs,
            maxCompactionLagMs: conf.maxCompactionLagMs,
            deleteRetentionMs: conf.deleteRetentionMs,
          });
          if (!res || b !== p.leader) continue;
          if (res.removed > 0) {
            this.log('compact', `broker-${b}`, `${p.id}: очиститель оставил последнюю запись каждого ключа, убрано ${res.removed} зап.; смещения не изменились`, {
              subject: p.id,
              rule: 'compaction-last-value',
              data: { removed: res.removed },
            });
          }
          if (res.tombstonesMarked > 0 || res.tombstonesRemoved > 0) {
            this.log('compact', `broker-${b}`, `${p.id}: tombstone ${res.tombstonesMarked > 0 ? `замечено (${res.tombstonesMarked}), хранится delete.retention.ms=${conf.deleteRetentionMs}` : ''}${res.tombstonesRemoved > 0 ? ` удалено (${res.tombstonesRemoved})` : ''}`.trim(), {
              subject: p.id,
              rule: 'tombstone',
              data: { marked: res.tombstonesMarked, removed: res.tombstonesRemoved },
            });
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- clients

  /** Creates a producer client; `flush()` of the handle moves the clock until it is idle. */
  producer(id: string, config: Cfg = {}): ProducerHandle {
    if (this.producers.has(id)) throw new Error(`producer ${id} already exists`);
    const p = new Producer(id, config, this.producerEnv());
    this.producers.set(id, p);
    return new ProducerHandle(this, p);
  }

  /** Waits (virtual time) until the producer has nothing buffered or in flight. */
  waitIdle(p: Producer, limitMs = 150000): void {
    p.flush();
    let waited = 0;
    while (!p.idle() && waited < limitMs && this.clock) {
      this.clock(10);
      waited += 10;
    }
  }

  consumer(id: string, config: Cfg = {}): ConsumerHandle {
    if (this.consumers.has(id)) throw new Error(`consumer ${id} already exists`);
    const c = new Consumer(id, config, this.coord, this.groupEnv());
    this.consumers.set(id, c);
    return new ConsumerHandle(this, c);
  }

  /** Blocking poll in virtual time: returns as soon as records are available or `maxMs` has passed. */
  pollFor(c: Consumer, maxMs: number): Rec[] {
    const end = this.k.now + maxMs;
    for (;;) {
      const r = c.poll1();
      if (r.length > 0) {
        this.counters.consume += r.length;
        return r;
      }
      if (this.k.now >= end || !this.clock) return [];
      this.clock(Math.min(50, end - this.k.now));
    }
  }

  /** Console producer: sends the records, waits for acknowledgements, returns one result per record. */
  produce(topic: string, records: Omit<ProducerRecord, 'topic'>[], config: Cfg = {}): Result<Delivered[]> {
    let p: Producer;
    const id = `console-producer-${this.nextConsole++}`;
    try {
      p = new Producer(id, config, this.producerEnv());
    } catch (e) {
      return fail(40, (e as Error).message);
    }
    this.producers.set(id, p);
    for (const r of records) p.send({ ...r, topic });
    this.waitIdle(p);
    p.shutdown();
    this.producers.delete(id);
    return ok(p.results);
  }

  /** Console consumer. Stops after --max-messages records or when nothing new arrives. */
  consume(o: ConsumeOptions): Result<ConsumeResult> {
    const manual = o.partition !== undefined;
    if (!this.topics.has(o.topic) && (manual || this.brokerValue(null, 'auto.create.topics.enable') === 'false')) {
      return fail(3, `Topic '${o.topic}' does not exist as expected`);
    }
    const group = manual ? (o.group ?? null) : (o.group ?? `console-consumer-${this.k.rng('console').int(0, 99999)}`);
    const reset = o.fromBeginning || o.offset === 'earliest' ? 'earliest' : 'latest';
    const cfg: Cfg = { 'enable.auto.commit': o.group !== undefined, ...(o.maxMessages !== undefined ? { 'max.poll.records': o.maxMessages } : {}), 'auto.offset.reset': reset, ...(group ? { 'group.id': group } : {}), ...o.config };
    let c: Consumer;
    const id = `console-consumer-${this.nextConsole++}`;
    try {
      c = new Consumer(id, cfg, this.coord, this.groupEnv());
    } catch (e) {
      return fail(40, (e as Error).message);
    }
    this.consumers.set(id, c);
    if (manual) {
      const tp = { topic: o.topic, partition: o.partition as number };
      const part = this.part(o.topic, tp.partition);
      if (!part) {
        this.consumers.delete(id);
        return fail(3, `Partition ${o.topic}-${tp.partition} does not exist`);
      }
      c.assign([tp]);
      if (typeof o.offset === 'number') c.seek(tp, o.offset);
      else if (o.offset === 'earliest') c.seek(tp, part.logStart);
      else if (o.offset === 'latest') c.seek(tp, part.hw);
    } else c.subscribe([o.topic]);
    const records: Rec[] = [];
    const max = o.maxMessages ?? Infinity;
    const end = this.k.now + (o.timeoutMs ?? 60000);
    let idle = false;
    while (records.length < max && this.k.now < end) {
      const r = this.pollFor(c, 500);
      records.push(...r.slice(0, max - records.length));
      if (c.error) break;
      if (r.length === 0 && c.ready()) {
        idle = true;
        break;
      }
    }
    const error = c.error;
    c.close();
    this.consumers.delete(id);
    return ok({ records, group, idle, error });
  }

  listGroups(): string[] {
    return [...this.coord.groups.keys()].sort();
  }
  describeGroup(id: string): Result<GroupDescription> {
    const d = this.coord.describe(id);
    return d ? ok(d) : fail(69, `Consumer group '${id}' does not exist.`);
  }
  deleteGroup(id: string): Result<void> {
    const e = this.coord.delete(id);
    return e ? { ok: false, error: e } : ok(undefined);
  }

  /** `--reset-offsets`: rows for every partition of the group's (or the given) topics; `execute` stores them. */
  resetOffsets(groupId: string, spec: ResetSpec, execute: boolean, topics?: string[]): Result<ResetRow[]> {
    const g = this.coord.groups.get(groupId);
    if (!g) return fail(69, `Consumer group '${groupId}' does not exist.`);
    if (g.state !== 'Empty' && g.state !== 'Dead') {
      return fail(68, `Assignments can only be reset if the group '${groupId}' is inactive, but the current state is ${g.state}.`);
    }
    const names = topics ?? [...new Set([...g.offsets.values()].map((o) => o.topic))].sort();
    const rows: ResetRow[] = [];
    for (const name of names) {
      const t = this.topics.get(name);
      if (!t) return fail(3, `Topic '${name}' does not exist as expected`);
      for (const p of t.parts) {
        const cur = this.coord.committed(groupId, { topic: name, partition: p.index });
        const clamp = (x: number): number => Math.min(Math.max(x, p.logStart), p.leo);
        let to: number | undefined;
        switch (spec.mode) {
          case 'earliest':
            to = p.logStart;
            break;
          case 'latest':
            to = p.leo;
            break;
          case 'current':
            to = cur ?? p.logStart;
            break;
          case 'offset':
            to = clamp(spec.value);
            break;
          case 'shift-by':
            to = clamp((cur ?? p.logStart) + spec.value);
            break;
          case 'duration':
            to = p.leaderLog?.offsetForTime(this.k.now - spec.ms) ?? p.leo;
            break;
          case 'datetime':
            to = p.leaderLog?.offsetForTime(spec.at) ?? p.leo;
            break;
          case 'from-file':
            to = spec.rows.find((r) => r.topic === name && r.partition === p.index)?.offset;
            break;
        }
        if (to === undefined) continue;
        rows.push({ group: groupId, topic: name, partition: p.index, newOffset: to });
      }
    }
    if (execute) {
      for (const r of rows) this.coord.commit(groupId, { topic: r.topic, partition: r.partition }, r.newOffset);
      this.log('commit', 'admin', `Смещения группы ${groupId} сброшены (${rows.length} разд.)`, { subject: groupId });
    }
    return ok(rows);
  }

  // ---------------------------------------------------------------- actors

  private producerTick(a: Actor): void {
    const cfg = a.cfg;
    if (!a.producer) {
      try {
        a.producer = new Producer(cfg.id, cfg.config, this.producerEnv());
      } catch (e) {
        this.log('error', cfg.id, `${cfg.id}: ${(e as Error).message}`);
        a.done = true;
        return;
      }
      this.producers.set(cfg.id, a.producer);
      a.startedAt = this.k.now;
    }
    const n = a.n++;
    const m = cfg.message ?? {};
    const key = m.key !== undefined ? expandTemplate(m.key, n) : null;
    const value = expandTemplate(m.body ?? 'message {n}', n);
    a.producer.send({ topic: cfg.topic ?? '', key, value }, { msg: `${cfg.id}-${n}`, n });
    if (cfg.count !== undefined && n >= cfg.count) {
      a.done = true;
      return;
    }
    const rate = cfg.rate ?? 10;
    const next = a.startedAt + Math.round((n * 1000) / rate);
    this.k.schedule(Math.max(0, next - this.k.now), 3, 'producer.tick', { actor: cfg.id, gen: a.gen });
  }

  private connectConsumer(a: Actor): void {
    const cfg = a.cfg;
    a.gen++;
    a.batch = [];
    a.idx = 0;
    a.processEv = null;
    this.consumers.delete(cfg.id);
    try {
      const c = new Consumer(cfg.id, { ...cfg.config, 'group.id': cfg.group ?? cfg.id }, this.coord, this.groupEnv());
      this.consumers.set(cfg.id, c);
      a.consumer = c;
      c.subscribe(cfg.topics ?? (cfg.topic ? [cfg.topic] : []));
    } catch (e) {
      this.log('error', cfg.id, `${cfg.id}: ${(e as Error).message}`);
      a.stopped = true;
      return;
    }
    this.k.schedule(0, 3, 'actor.poll', { actor: cfg.id, gen: a.gen });
  }

  private actorPoll(a: Actor): void {
    const c = a.consumer;
    if (!c || a.stopped || c.closed) return;
    const recs = c.poll1();
    if (c.error) {
      this.log('error', a.cfg.id, `${a.cfg.id}: ${c.error.name}: ${c.error.text}`);
      a.stopped = true;
      return;
    }
    if (recs.length === 0) {
      this.k.schedule(IDLE_POLL_MS, 3, 'actor.poll', { actor: a.cfg.id, gen: a.gen });
      return;
    }
    a.batch = recs;
    a.idx = 0;
    this.scheduleProcess(a);
  }

  private scheduleProcess(a: Actor): void {
    const jitter = a.cfg.jitterMs ? this.k.rng(`consumer:${a.cfg.id}`).int(0, a.cfg.jitterMs) : 0;
    a.processEv = this.k.schedule(a.processMs + jitter, 3, 'actor.process', { actor: a.cfg.id, gen: a.gen });
  }

  private markProcessed(a: Actor, r: Rec): void {
    const id = a.cfg.id;
    const msg = r.msg ?? `${r.topic}-${r.partition}@${r.offset}`;
    if (a.cfg.config.idempotent === true && a.processed.has(msg)) {
      this.log('process', id, `${id} уже обрабатывал ${msg} и пропускает дубль`, { msg });
      return;
    }
    a.processed.add(msg);
    this.latencies.push(this.k.now - r.timestamp);
    if (this.latencies.length > LATENCY_WINDOW) this.latencies.shift();
    this.counters.consume++;
    const data: Record<string, string | number | boolean | null> = { processed: true, offset: r.offset };
    if (r.key !== null) data.key = r.key;
    if (r.n !== undefined) data.seq = r.n;
    this.log('process', id, `${id} обработал ${msg} (${r.topic}-${r.partition}, смещение ${r.offset})`, { msg, subject: `${r.topic}-${r.partition}`, data });
  }

  private actorProcess(a: Actor): void {
    a.processEv = null;
    const r = a.batch[a.idx];
    if (!r || a.stopped) return;
    const id = a.cfg.id;
    a.attempts++;
    const every = a.cfg.failEveryN ?? 0;
    let advance = true;
    if (every > 0 && a.attempts % every === 0) {
      // An intended handler failure of the scenario (failEveryN), not a fault of the model.
      this.log('handler.error', id, `${id}: ошибка при обработке ${r.msg ?? `${r.topic}-${r.partition}@${r.offset}`}`, { msg: r.msg });
      switch (a.cfg.config.on_error) {
        case 'retry':
          advance = false;
          break;
        case 'stop':
          this.actorCrash(a, false);
          return;
        default:
      }
    } else this.markProcessed(a, r);
    if (advance) a.idx++;
    if (a.idx < a.batch.length) this.scheduleProcess(a);
    else {
      a.batch = [];
      this.k.schedule(0, 3, 'actor.poll', { actor: id, gen: a.gen });
    }
  }

  private actorStop(a: Actor): void {
    a.stopped = true;
    a.gen++;
    if (a.processEv !== null) this.k.cancel(a.processEv);
    a.processEv = null;
    a.batch = [];
    a.consumer?.stop();
    this.log('fault', a.cfg.id, `${a.cfg.id} остановлен, вышел из группы`);
  }

  private actorCrash(a: Actor, afterProcess: boolean): void {
    const c = a.consumer;
    if (!c || c.closed) return;
    const cur = a.batch[a.idx];
    if (afterProcess && cur) {
      if (a.processEv !== null) this.k.cancel(a.processEv);
      this.markProcessed(a, cur);
      this.log('fault', a.cfg.id, `${a.cfg.id} упал после обработки ${cur.msg ?? ''}: смещение не закоммичено`, { msg: cur.msg });
    } else this.log('fault', a.cfg.id, `${a.cfg.id} упал, не закоммитив прочитанное`);
    a.gen++;
    if (a.processEv !== null) this.k.cancel(a.processEv);
    a.processEv = null;
    a.batch = [];
    c.crash();
    this.k.schedule(RECONNECT_MS, 3, 'consumer.connect', { actor: a.cfg.id });
  }

  // ---------------------------------------------------------------- observation

  sample(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const t of [...this.topics.values()].sort((a, b) => (a.name < b.name ? -1 : 1))) {
      for (const p of t.parts) out[`isr.${p.id}`] = p.isr.length;
    }
    for (const g of [...this.coord.groups.keys()].sort()) {
      let sum = 0;
      for (const { tp, lag } of this.coord.lagOf(g)) {
        out[`lag.${g}.${tp.topic}-${tp.partition}`] = lag;
        sum += lag;
      }
      out[`lag.${g}`] = sum;
    }
    const now = this.k.now;
    for (const key of ['produce', 'consume'] as const) {
      const h = this.history[key];
      h.push([now, this.counters[key]]);
      while (h.length > 1 && h[1][0] <= now - 1000) h.shift();
      const span = now - h[0][0];
      out[`rate.${key}`] = span > 0 ? ((this.counters[key] - h[0][1]) * 1000) / span : 0;
    }
    out['latency.p95'] = percentile(this.latencies, 0.95);
    return out;
  }

  quiet(): boolean {
    for (const p of this.producers.values()) if (!p.idle()) return false;
    for (const a of this.actors.values()) {
      if (a.cfg.kind === 'producer' && !a.done) return false;
      if (a.cfg.kind === 'consumer' && !a.stopped) {
        if (a.batch.length > 0) return false;
        const c = a.consumer;
        if (!c) return false;
        if (!c.ready()) return false;
        for (const tp of c.assignment) {
          const part = this.part(tp.topic, tp.partition);
          const pos = c.position(tp);
          if (part && pos !== undefined && pos < part.hw) return false;
        }
      }
    }
    for (const g of this.coord.groups.values()) if (g.state === 'PreparingRebalance') return false;
    for (const p of this.allParts()) {
      if (p.leader === null) continue;
      for (const [b, r] of p.reps) {
        if (b !== p.leader && this.up.get(b) === true && r.log.leo < p.leo) return false;
      }
    }
    return true;
  }

  snapshot(): KafkaSnapshot {
    return {
      now: this.k.now,
      brokers: BROKERS.map((id) => ({ id, up: this.up.get(id) === true, stalledUntil: (this.stalled.get(id) ?? 0) > this.k.now ? (this.stalled.get(id) as number) : 0 })),
      topics: [...this.topics.values()]
        .sort((a, b) => (a.name < b.name ? -1 : 1))
        .map((t) => ({ name: t.name, topicId: t.id, configs: Object.fromEntries(t.configs), partitions: t.parts.map((p) => p.snapshot()) })),
      groups: this.listGroups().map((g) => this.coord.describe(g) as GroupDescription),
      producers: [...this.producers.values()].map((p) => ({
        id: p.id,
        pid: p.pid ?? null,
        results: p.results.length,
        failed: p.results.filter((r) => r.error !== null).length,
      })),
    };
  }

  /** Test and console access to a partition's state. */
  partitionOf(topic: string, p: number): Partition | undefined {
    return this.part(topic, p);
  }
  groupOffsets(group: string, tp: TP): number | undefined {
    return this.coord.committed(group, tp);
  }
}

export class ProducerHandle {
  constructor(
    private readonly model: KafkaModel,
    readonly raw: Producer,
  ) {}
  get id(): string {
    return this.raw.id;
  }
  get results(): readonly Delivered[] {
    return this.raw.results;
  }
  send(rec: ProducerRecord, meta?: { msg?: string; n?: number }): number {
    return this.raw.send(rec, meta);
  }
  /** Blocks (virtual time) until every sent record is acknowledged or failed. */
  flush(): void {
    this.model.waitIdle(this.raw);
  }
  close(): void {
    this.flush();
    this.raw.shutdown();
  }
}

export class ConsumerHandle {
  constructor(
    private readonly model: KafkaModel,
    readonly raw: Consumer,
  ) {}
  get id(): string {
    return this.raw.id;
  }
  subscribe(topics: string[]): void {
    this.raw.subscribe(topics);
  }
  assign(tps: TP[]): void {
    this.raw.assign(tps);
  }
  seek(tp: TP, offset: number): void {
    this.raw.seek(tp, offset);
  }
  poll(maxMs: number): Rec[] {
    return this.model.pollFor(this.raw, maxMs);
  }
  commitSync(): KafkaError | null {
    return this.raw.commitSync();
  }
  close(): void {
    this.raw.close();
  }
  get assignment(): TP[] {
    return this.raw.assignment;
  }
}

