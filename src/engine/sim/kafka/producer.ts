import type { Rng } from '../../drill/types';
import type { JournalDraft } from '../types';
import { recordSize, type Header, type KRecord } from './log';
import { keyPartition, StickyPartitioner } from './partitioner';
import { kerr, RETRIABLE, type KafkaError, type ProduceReq, type ProduceResult } from './replication';
import type { KafkaRule } from './rules';

export const NET_MS = 2;

export type Cfg = Record<string, unknown>;

export function cfgNum(c: Cfg, key: string, def: number): number {
  const v = c[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return def;
}
export function cfgBool(c: Cfg, key: string, def: boolean): boolean {
  const v = c[key];
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return def;
}
export function cfgStr(c: Cfg, key: string, def: string): string {
  const v = c[key];
  return typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : def;
}

export interface ProducerRecord {
  topic: string;
  key?: string | null;
  value?: string | null;
  headers?: Header[];
  partition?: number;
  timestamp?: number;
}
export interface RecordMeta {
  /** Journal id of the message; defaults to `<producer>-<local id>`. */
  msg?: string;
  /** Message number from the scenario template. */
  n?: number;
}
export interface Delivered {
  id: number;
  msg: string;
  topic: string;
  partition: number;
  /** -1 for acks=0 and for failures */
  offset: number;
  timestamp: number;
  error: KafkaError | null;
  attempts: number;
}

export interface ProducerEnv {
  readonly now: number;
  schedule(delay: number, cls: 0 | 1 | 2 | 3, kind: string, data: Record<string, unknown>): number;
  cancel(id: number): void;
  rng(stream: string): Rng;
  /** Metadata request with auto-creation; null for an unknown topic. */
  partitionCount(topic: string, actor: string): number | null;
  leaderOf(topic: string, partition: number): number | null;
  /** Hands a produce request to the broker; the callback fires when the broker has an answer. */
  produce(broker: number, topic: string, partition: number, req: ProduceReq, acks: 0 | 1 | -1, cb: (r: ProduceResult) => void): void;
  newPid(): number;
  log(d: JournalDraft & { rule?: KafkaRule }): void;
  delivered(d: Delivered, rec: PRec): void;
}

export interface PRec {
  id: number;
  msg: string;
  n?: number;
  key: string | null;
  value: string | null;
  headers: Header[];
  timestamp: number;
  size: number;
  partition: number;
  topic: string;
}

interface Batch {
  id: number;
  topic: string;
  partition: number;
  recs: PRec[];
  bytes: number;
  createdAt: number;
  sealed: boolean;
  attempts: number;
  notBefore: number;
  baseSeq?: number;
  inflight: number | null;
  expired: boolean;
  lingerEv: number | null;
  expireEv: number | null;
}

export interface ProducerConfig {
  acks: 0 | 1 | -1;
  idempotent: boolean;
  lingerMs: number;
  batchSize: number;
  retries: number;
  deliveryTimeoutMs: number;
  requestTimeoutMs: number;
  retryBackoffMs: number;
  retryBackoffMaxMs: number;
  maxInFlight: number;
  ignoreKeys: boolean;
}

export function parseProducerConfig(c: Cfg): ProducerConfig {
  const a = cfgStr(c, 'acks', 'all');
  const acks: 0 | 1 | -1 = a === '0' ? 0 : a === '1' ? 1 : a === 'all' || a === '-1' ? -1 : (() => {
    throw new Error(`Invalid value ${a} for configuration acks: String must be one of: all, -1, 0, 1`);
  })();
  const retries = cfgNum(c, 'retries', 2147483647);
  const maxInFlight = cfgNum(c, 'max.in.flight.requests.per.connection', 5);
  const explicit = c['enable.idempotence'] !== undefined;
  const want = cfgBool(c, 'enable.idempotence', true);
  if (explicit && want) {
    if (acks !== -1) throw new Error('Must set acks to all in order to use the idempotent producer. Otherwise we cannot guarantee idempotence.');
    if (retries <= 0) throw new Error('Must set retries to non-zero when using the idempotent producer.');
    if (maxInFlight > 5) throw new Error('Must set max.in.flight.requests.per.connection to at most 5 to use the idempotent producer.');
  }
  return {
    acks,
    idempotent: want && acks === -1 && retries > 0 && maxInFlight <= 5,
    lingerMs: cfgNum(c, 'linger.ms', 5),
    batchSize: cfgNum(c, 'batch.size', 16384),
    retries,
    deliveryTimeoutMs: cfgNum(c, 'delivery.timeout.ms', 120000),
    requestTimeoutMs: cfgNum(c, 'request.timeout.ms', 30000),
    retryBackoffMs: cfgNum(c, 'retry.backoff.ms', 100),
    retryBackoffMaxMs: cfgNum(c, 'retry.backoff.max.ms', 1000),
    maxInFlight,
    ignoreKeys: cfgBool(c, 'partitioner.ignore.keys', false),
  };
}

interface Pending {
  batch: Batch;
  broker: number;
  timeoutEv: number;
  /** The answer is dropped on its way back (fault ack.lost). */
  lost: boolean;
  result?: ProduceResult;
}

/** Client side of a producer: accumulator, sender, retries and the idempotent sequence state. */
export class Producer {
  readonly cfg: ProducerConfig;
  readonly pid: number | undefined;
  readonly results: Delivered[] = [];
  private nextRecord = 1;
  private nextBatch = 1;
  private nextReq = 1;
  private readonly open = new Map<string, Batch>();
  private readonly queue = new Map<string, Batch[]>();
  private readonly seq = new Map<string, number>();
  private readonly pending = new Map<number, Pending>();
  private readonly inflightBy = new Map<number, number>();
  private readonly sticky = new Map<string, StickyPartitioner>();
  /** Fault knobs set by scenarios. */
  lostAcks = 0;
  failNext: { code: number; count: number } | null = null;
  closed = false;

  constructor(
    readonly id: string,
    config: Cfg,
    private readonly env: ProducerEnv,
  ) {
    this.cfg = parseProducerConfig(config);
    this.pid = this.cfg.idempotent ? env.newPid() : undefined;
  }

  private tp(topic: string, p: number): string {
    return `${topic}-${p}`;
  }

  /** Queues one record; returns its local number. Partition errors are reported through `results`. */
  send(rec: ProducerRecord, meta: RecordMeta = {}): number {
    const id = this.nextRecord++;
    const msg = meta.msg ?? `${this.id}-${id}`;
    const key = rec.key ?? null;
    const value = rec.value ?? null;
    const headers = rec.headers ?? [];
    const size = recordSize(key, value, headers);
    const now = this.env.now;
    const count = this.env.partitionCount(rec.topic, this.id);
    const base: PRec = { id, msg, n: meta.n, key, value, headers, timestamp: rec.timestamp ?? now, size, partition: -1, topic: rec.topic };
    if (count === null) {
      this.fail(base, kerr(3, `Topic ${rec.topic} not present in metadata`), 0);
      return id;
    }
    let p: number;
    let rule: KafkaRule | undefined;
    if (rec.partition !== undefined) {
      p = rec.partition;
      if (!Number.isInteger(p) || p < 0 || p >= count) {
        this.fail(base, kerr(3, `Invalid partition given with record: ${p} is not in the range [0...${count})`), 0);
        return id;
      }
    } else if (key !== null && !this.cfg.ignoreKeys) {
      p = keyPartition(key, count);
      rule = 'key-partition';
    } else {
      let sp = this.sticky.get(rec.topic);
      if (!sp) this.sticky.set(rec.topic, (sp = new StickyPartitioner(this.env.rng(`producer:${this.id}`), this.cfg.batchSize)));
      const avail: number[] = [];
      for (let i = 0; i < count; i++) if (this.env.leaderOf(rec.topic, i) !== null) avail.push(i);
      p = sp.next(count, size, avail);
      rule = 'sticky-null';
    }
    base.partition = p;
    this.env.log({
      kind: 'publish',
      actor: this.id,
      subject: this.tp(rec.topic, p),
      msg,
      text: `${this.id}: запись ${msg}${key !== null ? ` с ключом «${key}»` : ' без ключа'} направлена в ${this.tp(rec.topic, p)}`,
      rule,
      data: { confirms: this.cfg.acks !== 0, partition: p, ...(key !== null ? { key } : {}), ...(meta.n !== undefined ? { seq: meta.n } : {}), ...(value !== null ? { body: value } : {}) },
    });
    this.append(base);
    return id;
  }

  private append(rec: PRec): void {
    const k = this.tp(rec.topic, rec.partition);
    let b = this.open.get(k);
    if (b && b.recs.length > 0 && b.bytes + rec.size > this.cfg.batchSize) {
      this.seal(b, 'batch.size');
      b = undefined;
    }
    if (!b) {
      b = {
        id: this.nextBatch++,
        topic: rec.topic,
        partition: rec.partition,
        recs: [],
        bytes: 0,
        createdAt: this.env.now,
        sealed: false,
        attempts: 0,
        notBefore: 0,
        inflight: null,
        expired: false,
        lingerEv: null,
        expireEv: null,
      };
      this.open.set(k, b);
      b.lingerEv = this.env.schedule(this.cfg.lingerMs, 3, 'prod.linger', { producer: this.id, batch: b.id, key: k });
    }
    b.recs.push(rec);
    b.bytes += rec.size;
    if (b.bytes >= this.cfg.batchSize) this.seal(b, 'batch.size');
  }

  private seal(b: Batch, why: 'batch.size' | 'linger.ms' | 'flush'): void {
    if (b.sealed) return;
    b.sealed = true;
    if (b.lingerEv !== null) this.env.cancel(b.lingerEv);
    b.lingerEv = null;
    const k = this.tp(b.topic, b.partition);
    if (this.open.get(k) === b) this.open.delete(k);
    const q = this.queue.get(k) ?? [];
    q.push(b);
    this.queue.set(k, q);
    const left = b.createdAt + this.cfg.deliveryTimeoutMs - this.env.now;
    b.expireEv = this.env.schedule(Math.max(0, left), 3, 'prod.expire', { producer: this.id, batch: b.id, key: k });
    this.env.log({
      kind: 'produce',
      actor: this.id,
      subject: k,
      text: `${this.id}: пакет ${k} из ${b.recs.length} зап. (${b.bytes} Б) закрыт: ${why === 'batch.size' ? `набрал batch.size=${this.cfg.batchSize}` : why === 'linger.ms' ? `прошло linger.ms=${this.cfg.lingerMs}` : 'flush'}`,
      rule: 'linger-batch',
      data: { records: b.recs.length, bytes: b.bytes },
    });
    this.drain();
  }

  /** Closes every open batch and sends whatever can go. */
  flush(): void {
    for (const b of [...this.open.values()]) this.seal(b, 'flush');
    this.drain();
  }

  /** True when nothing is buffered or in flight. */
  idle(): boolean {
    if (this.open.size > 0 || this.pending.size > 0) return false;
    for (const q of this.queue.values()) if (q.length > 0) return false;
    return true;
  }

  handle(kind: string, d: Record<string, unknown>): void {
    switch (kind) {
      case 'prod.linger': {
        const b = this.open.get(String(d.key));
        if (b && b.id === d.batch) this.seal(b, 'linger.ms');
        break;
      }
      case 'prod.expire':
        this.expire(String(d.key), Number(d.batch));
        break;
      case 'prod.retry':
        if (typeof d.meta === 'string') this.metadataWait.delete(d.meta);
        this.drain();
        break;
      case 'prod.arrive':
        this.arrive(Number(d.req));
        break;
      case 'prod.respond':
        this.respond(Number(d.req));
        break;
      case 'prod.timeout':
        this.timeout(Number(d.req));
        break;
      default:
    }
  }

  // ---------------------------------------------------------------- sender

  private drain(): void {
    for (const [k, q] of this.queue) {
      while (q.length > 0) {
        const b = q[0];
        if (b.notBefore > this.env.now) break;
        const leader = this.env.leaderOf(b.topic, b.partition);
        if (leader === null) {
          // Metadata has no leader: look again after the retry backoff.
          if (!this.metadataWait.has(k)) {
            this.metadataWait.add(k);
            this.env.schedule(this.cfg.retryBackoffMs, 3, 'prod.retry', { producer: this.id, meta: k });
          }
          break;
        }
        if ((this.inflightBy.get(leader) ?? 0) >= this.cfg.maxInFlight) break;
        q.shift();
        this.send1(b, leader);
      }
    }
    for (const k of [...this.metadataWait]) {
      const q = this.queue.get(k);
      if (!q || q.length === 0 || this.env.leaderOf(q[0].topic, q[0].partition) !== null) this.metadataWait.delete(k);
    }
  }
  private readonly metadataWait = new Set<string>();

  private send1(b: Batch, broker: number): void {
    if (this.pid !== undefined && b.baseSeq === undefined) {
      const k = this.tp(b.topic, b.partition);
      b.baseSeq = this.seq.get(k) ?? 0;
      this.seq.set(k, b.baseSeq + b.recs.length);
    }
    b.attempts++;
    const req = this.nextReq++;
    b.inflight = req;
    this.inflightBy.set(broker, (this.inflightBy.get(broker) ?? 0) + 1);
    const timeoutEv = this.env.schedule(this.cfg.requestTimeoutMs, 2, 'prod.timeout', { producer: this.id, req });
    this.pending.set(req, { batch: b, broker, timeoutEv, lost: false });
    this.env.schedule(NET_MS, 2, 'prod.arrive', { producer: this.id, req });
  }

  private arrive(req: number): void {
    const p = this.pending.get(req);
    if (!p) return;
    const b = p.batch;
    const subject = this.tp(b.topic, b.partition);
    if (this.failNext && this.failNext.count > 0) {
      const code = this.failNext.code;
      this.failNext.count--;
      this.env.log({ kind: 'fault', actor: this.id, subject, text: `${this.id}: запрос в ${subject} завершился ошибкой ${kerr(code).name} до записи` });
      p.result = { error: kerr(code), baseOffset: -1, duplicate: false };
      this.env.schedule(NET_MS, 2, 'prod.respond', { producer: this.id, req });
      return;
    }
    const preq: ProduceReq = {
      records: b.recs.map((r) => ({ key: r.key, value: r.value, headers: r.headers, timestamp: r.timestamp, size: r.size, msg: r.msg, n: r.n })),
      pid: this.pid,
      baseSeq: b.baseSeq,
      timeoutMs: this.cfg.requestTimeoutMs,
    };
    this.env.produce(p.broker, b.topic, b.partition, preq, this.cfg.acks, (r) => {
      if (!this.pending.has(req)) return;
      p.result = r;
      if (this.cfg.acks === 0) {
        this.env.cancel(p.timeoutEv);
        this.finish(req);
        this.complete(b, r);
        return;
      }
      if (this.lostAcks > 0 && r.error === null) {
        this.lostAcks--;
        p.lost = true;
        this.env.log({ kind: 'fault', actor: this.id, subject, text: `${this.id}: подтверждение записи в ${subject} потеряно по дороге; издатель узнает об этом по request.timeout.ms=${this.cfg.requestTimeoutMs}` });
        return;
      }
      this.env.schedule(NET_MS, 2, 'prod.respond', { producer: this.id, req });
    });
  }

  private finish(req: number): Pending | undefined {
    const p = this.pending.get(req);
    if (!p) return undefined;
    this.pending.delete(req);
    p.batch.inflight = null;
    this.inflightBy.set(p.broker, Math.max(0, (this.inflightBy.get(p.broker) ?? 1) - 1));
    return p;
  }

  private respond(req: number): void {
    const p = this.pending.get(req);
    if (!p || !p.result) return;
    this.env.cancel(p.timeoutEv);
    this.finish(req);
    this.complete(p.batch, p.result);
  }

  private timeout(req: number): void {
    const p = this.finish(req);
    if (!p) return;
    this.complete(p.batch, { error: kerr(7, `Request timed out after ${this.cfg.requestTimeoutMs} ms`), baseOffset: -1, duplicate: false });
  }

  private complete(b: Batch, r: ProduceResult): void {
    const subject = this.tp(b.topic, b.partition);
    if (r.error === null) {
      if (b.expireEv !== null) this.env.cancel(b.expireEv);
      b.expireEv = null;
      b.recs.forEach((rec, i) => this.deliver(rec, r.baseOffset >= 0 ? r.baseOffset + i : -1, null, b.attempts));
      this.drain();
      return;
    }
    const retriable = RETRIABLE.has(r.error.code) && (r.error.code !== 45 || this.pid !== undefined);
    const spent = b.attempts - 1 >= this.cfg.retries;
    if (!retriable || spent || b.expired || this.env.now - b.createdAt >= this.cfg.deliveryTimeoutMs) {
      this.failBatch(b, r.error);
      this.drain();
      return;
    }
    const backoff = Math.min(this.cfg.retryBackoffMaxMs, this.cfg.retryBackoffMs * 2 ** Math.min(b.attempts - 1, 20));
    b.notBefore = this.env.now + backoff;
    const q = this.queue.get(subject) ?? [];
    if (this.pid !== undefined) {
      const i = q.findIndex((x) => (x.baseSeq ?? 0) > (b.baseSeq ?? 0));
      q.splice(i < 0 ? q.length : i, 0, b);
    } else q.unshift(b);
    this.queue.set(subject, q);
    this.env.log({
      kind: 'produce',
      actor: this.id,
      subject,
      text: `${this.id}: ${subject} — ${r.error.name}, повтор через ${backoff} мс (попытка ${b.attempts + 1})`,
      rule: this.pid === undefined && this.cfg.maxInFlight > 1 ? 'retry-reorder' : undefined,
      data: { code: r.error.code },
    });
    this.env.schedule(backoff, 3, 'prod.retry', { producer: this.id });
    this.drain();
  }

  private expire(key: string, id: number): void {
    const q = this.queue.get(key);
    const b = q?.find((x) => x.id === id);
    if (!q || !b) {
      for (const p of this.pending.values()) if (p.batch.id === id && p.batch.topic + '-' + p.batch.partition === key) p.batch.expired = true;
      return;
    }
    q.splice(q.indexOf(b), 1);
    this.failBatch(b, kerr(7, `Expiring ${b.recs.length} record(s) for ${key}: ${this.cfg.deliveryTimeoutMs} ms has passed since batch creation`));
  }

  private failBatch(b: Batch, e: KafkaError): void {
    if (b.expireEv !== null) this.env.cancel(b.expireEv);
    b.expireEv = null;
    for (const rec of b.recs) this.deliver(rec, -1, e, b.attempts);
  }

  private fail(rec: PRec, e: KafkaError, attempts: number): void {
    this.deliver(rec, -1, e, attempts);
  }

  private deliver(rec: PRec, offset: number, error: KafkaError | null, attempts: number): void {
    const d: Delivered = { id: rec.id, msg: rec.msg, topic: rec.topic, partition: rec.partition, offset, timestamp: rec.timestamp, error, attempts };
    this.results.push(d);
    this.env.delivered(d, rec);
  }

  /** Drops everything buffered (producer closed or crashed). */
  shutdown(): void {
    this.closed = true;
    for (const b of this.open.values()) if (b.lingerEv !== null) this.env.cancel(b.lingerEv);
    for (const q of this.queue.values()) for (const b of q) if (b.expireEv !== null) this.env.cancel(b.expireEv);
    for (const p of this.pending.values()) this.env.cancel(p.timeoutEv);
    this.open.clear();
    this.queue.clear();
    this.pending.clear();
    this.inflightBy.clear();
  }
}

export type { KRecord };
