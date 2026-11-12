import type { JournalDraft } from '../types';
import { Log, type KRecord, type LogSnapshot } from './log';
import type { KafkaRule } from './rules';

export interface KafkaError {
  code: number;
  name: string;
  text: string;
}

const ERRORS: Record<number, [string, string]> = {
  1: ['OFFSET_OUT_OF_RANGE', 'The requested offset is not within the range of offsets maintained by the server.'],
  3: ['UNKNOWN_TOPIC_OR_PARTITION', 'This server does not host this topic-partition.'],
  5: ['LEADER_NOT_AVAILABLE', 'There is no leader for this topic-partition as we are in the middle of a leadership election.'],
  6: ['NOT_LEADER_OR_FOLLOWER', 'For requests intended only for the leader, this error indicates that the broker is not the current leader.'],
  7: ['REQUEST_TIMED_OUT', 'The request timed out.'],
  10: ['MESSAGE_TOO_LARGE', 'The request included a message larger than the max message size the server will accept.'],
  13: ['NETWORK_EXCEPTION', 'The server disconnected before a response was received.'],
  17: ['INVALID_TOPIC_EXCEPTION', 'The request attempted to perform an operation on an invalid topic.'],
  19: ['NOT_ENOUGH_REPLICAS', 'Messages are rejected since there are fewer in-sync replicas than required.'],
  20: ['NOT_ENOUGH_REPLICAS_AFTER_APPEND', 'Messages are written to the log, but to fewer in-sync replicas than required.'],
  22: ['ILLEGAL_GENERATION', 'Specified group generation id is not valid.'],
  23: ['INCONSISTENT_GROUP_PROTOCOL', "The group member's supported protocols are incompatible with those of existing members or first group member tried to join with empty protocol type or empty protocol list."],
  25: ['UNKNOWN_MEMBER_ID', 'The coordinator is not aware of this member.'],
  27: ['REBALANCE_IN_PROGRESS', 'The group is rebalancing, so a rejoin is needed.'],
  36: ['TOPIC_ALREADY_EXISTS', 'Topic with this name already exists.'],
  37: ['INVALID_PARTITIONS', 'Number of partitions is invalid.'],
  38: ['INVALID_REPLICATION_FACTOR', 'Replication factor is invalid.'],
  40: ['INVALID_CONFIG', 'Configuration is invalid.'],
  45: ['OUT_OF_ORDER_SEQUENCE_NUMBER', 'The broker received an out of order sequence number.'],
  46: ['DUPLICATE_SEQUENCE_NUMBER', 'The broker received a duplicate sequence number.'],
  68: ['NON_EMPTY_GROUP', 'The group is not empty.'],
  69: ['GROUP_ID_NOT_FOUND', 'The group id does not exist.'],
  87: ['INVALID_RECORD', 'This record has failed the validation on broker and hence will be rejected.'],
};

export function kerr(code: number, text?: string): KafkaError {
  const [name, def] = ERRORS[code] ?? ['UNKNOWN_SERVER_ERROR', 'The server experienced an unexpected error when processing the request.'];
  return { code, name, text: text ?? def };
}

/** Errors a producer retries (OUT_OF_ORDER only with idempotence, checked by the producer). */
export const RETRIABLE = new Set([3, 5, 6, 7, 13, 19, 20, 45]);

/** Effective topic + broker configuration the partitions need (numbers are parsed by the model). */
export interface TopicConf {
  minIsr: number;
  unclean: boolean;
  replicaLagMs: number;
  segmentBytes: number;
  segmentMs: number;
  retentionMs: number;
  retentionBytes: number;
  deletePolicy: boolean;
  compactPolicy: boolean;
  deleteRetentionMs: number;
  minCleanableDirtyRatio: number;
  minCompactionLagMs: number;
  maxCompactionLagMs: number;
  maxMessageBytes: number;
  logAppendTime: boolean;
}

export interface ReplEnv {
  readonly now: number;
  brokerUp(id: number): boolean;
  /** 0 when the broker is not stalled. */
  stalledUntil(id: number): number;
  conf(topic: string): TopicConf;
  schedule(delay: number, cls: 0 | 1 | 2 | 3, kind: string, data: Record<string, unknown>): number;
  cancel(id: number): void;
  log(d: JournalDraft & { rule?: KafkaRule }): void;
  /** The producer has been told the record was written. */
  acked(msg: string): boolean;
  /** An acknowledged record is gone for good. */
  lose(msg: string, text: string): void;
}

export const FETCH_MS = 10;

export interface ProduceReq {
  records: Omit<KRecord, 'offset' | 'epoch'>[];
  pid?: number;
  baseSeq?: number;
  timeoutMs: number;
}
export interface ProduceResult {
  error: KafkaError | null;
  baseOffset: number;
  duplicate: boolean;
}

interface Waiter {
  id: number;
  last: number;
  base: number;
  cb: (r: ProduceResult) => void;
  ev: number;
}

export interface Replica {
  broker: number;
  log: Log;
  hw: number;
  lastCaughtUp: number;
  fetchPending: boolean;
  needsTruncate: boolean;
}

export interface PartitionSnapshot {
  topic: string;
  partition: number;
  leader: number | null;
  epoch: number;
  replicas: number[];
  isr: number[];
  hw: number;
  leo: number;
  logStart: number;
  logs: Record<number, LogSnapshot & { hw: number }>;
}

export class Partition {
  readonly id: string;
  leader: number | null;
  /** Last leader while the partition is offline (its log decides what was lost). */
  private lastLeader: number | null = null;
  epoch = 0;
  isr: number[];
  hw = 0;
  readonly reps = new Map<number, Replica>();
  private waiters: Waiter[] = [];
  private nextWaiter = 1;
  private pids = new Map<string, number>();
  private lastSeq = new Map<number, number>();

  constructor(
    readonly topic: string,
    readonly index: number,
    readonly replicas: number[],
    private readonly env: ReplEnv,
  ) {
    this.id = `${topic}-${index}`;
    for (const b of replicas) this.reps.set(b, { broker: b, log: new Log(), hw: 0, lastCaughtUp: env.now, fetchPending: false, needsTruncate: false });
    this.leader = replicas[0] ?? null;
    this.isr = [...replicas];
  }

  get leaderLog(): Log | null {
    return this.leader === null ? null : (this.reps.get(this.leader)?.log ?? null);
  }
  get leo(): number {
    return this.leaderLog?.leo ?? 0;
  }
  get logStart(): number {
    return this.leaderLog?.logStart ?? 0;
  }
  minIsr(): number {
    return Math.min(this.env.conf(this.topic).minIsr, this.replicas.length);
  }

  private log(kind: string, actor: string, text: string, o: { rule?: KafkaRule; msg?: string; data?: Record<string, string | number | boolean | null> } = {}): void {
    this.env.log({ kind, actor, subject: this.id, text, ...o });
  }

  // ---------------------------------------------------------------- produce

  /** One produce request to broker `broker` for this partition. `acks` is 0, 1 or -1. */
  produce(broker: number, req: ProduceReq, acks: 0 | 1 | -1, cb: (r: ProduceResult) => void): void {
    const fail = (code: number, text?: string): void => cb({ error: kerr(code, text), baseOffset: -1, duplicate: false });
    if (this.leader === null) return fail(5);
    if (this.leader !== broker) return fail(6);
    const conf = this.env.conf(this.topic);
    if (acks === -1 && this.isr.length < this.minIsr()) {
      this.log('error', `broker-${broker}`, `${this.id}: в ISR ${this.isr.length} реплик, нужно ${this.minIsr()} (min.insync.replicas): запись отклонена, ничего не записано`, {
        rule: 'not-enough-replicas',
        data: { code: 19 },
      });
      return fail(19);
    }
    const bytes = req.records.reduce((n, r) => n + r.size, 0);
    if (bytes > conf.maxMessageBytes) return fail(10);
    if (conf.compactPolicy && req.records.some((r) => r.key === null)) {
      return fail(87, 'Compacted topic cannot accept message without key.');
    }
    const first = req.records[0];
    if (req.pid !== undefined && req.baseSeq !== undefined) {
      const dup = this.pids.get(`${req.pid}:${req.baseSeq}`);
      if (dup !== undefined) {
        this.log('produce', `broker-${broker}`, `${this.id}: дубликат пакета (producer ${req.pid}, seq ${req.baseSeq}) подтверждён без повторной записи`, {
          rule: 'idempotent-dedupe',
          msg: first?.msg,
          data: { pid: req.pid, seq: req.baseSeq, offset: dup },
        });
        return cb({ error: null, baseOffset: dup, duplicate: true });
      }
      const expect = (this.lastSeq.get(req.pid) ?? -1) + 1;
      if (req.baseSeq !== expect) {
        this.log('error', `broker-${broker}`, `${this.id}: seq ${req.baseSeq} от producer ${req.pid}, ожидался ${expect}: пакет отклонён`, {
          rule: 'idempotent-dedupe',
          data: { code: 45 },
        });
        return fail(45);
      }
    }
    const lr = this.leaderLog as Log;
    const roll = { segmentBytes: conf.segmentBytes, segmentMs: conf.segmentMs };
    let base = -1;
    let last = -1;
    req.records.forEach((r, i) => {
      const seq = req.baseSeq !== undefined ? req.baseSeq + i : undefined;
      const rec = lr.append(
        { ...r, headers: r.headers.map((h) => [...h] as [string, string]), epoch: this.epoch, pid: req.pid, seq, timestamp: conf.logAppendTime ? this.env.now : r.timestamp },
        roll,
        this.env.now,
      );
      if (base < 0) base = rec.offset;
      last = rec.offset;
      if (rec.pid !== undefined && rec.seq !== undefined) this.pids.set(`${rec.pid}:${rec.seq}`, rec.offset);
      this.log('append', `broker-${broker}`, `${this.id}: запись${rec.msg ? ` ${rec.msg}` : ''} получила смещение ${rec.offset}`, {
        rule: 'offset-monotonic',
        msg: rec.msg,
        data: { offset: rec.offset, epoch: this.epoch },
      });
    });
    if (req.pid !== undefined && req.baseSeq !== undefined) this.lastSeq.set(req.pid, req.baseSeq + req.records.length - 1);
    this.kick();
    this.recomputeHw();
    if (acks === 0) return cb({ error: null, baseOffset: -1, duplicate: false });
    if (acks === 1 || this.hw > last) return cb({ error: null, baseOffset: base, duplicate: false });
    const id = this.nextWaiter++;
    const ev = this.env.schedule(req.timeoutMs, 2, 'produce.timeout', { topic: this.topic, partition: this.index, waiter: id });
    this.waiters.push({ id, last, base, cb, ev });
  }

  /** Request timeout of a waiting acks=all request. */
  waiterTimeout(id: number): void {
    const i = this.waiters.findIndex((w) => w.id === id);
    if (i < 0) return;
    const [w] = this.waiters.splice(i, 1);
    w.cb({ error: kerr(7), baseOffset: -1, duplicate: false });
  }

  private failWaiters(code: number): void {
    const ws = this.waiters;
    this.waiters = [];
    for (const w of ws) {
      this.env.cancel(w.ev);
      w.cb({ error: kerr(code), baseOffset: -1, duplicate: false });
    }
  }

  // ------------------------------------------------------------------- HW / ISR

  /** HW = min LEO over the ISR; it does not move while the ISR is smaller than the effective min.insync.replicas. */
  recomputeHw(): void {
    const lr = this.leaderLog;
    if (!lr || this.leader === null) return;
    if (this.isr.length >= this.minIsr()) {
      let m = lr.leo;
      for (const b of this.isr) {
        const r = this.reps.get(b);
        if (r) m = Math.min(m, r.log.leo);
      }
      if (m > this.hw) {
        this.hw = m;
        // Routine advances stay out of the journal; a reduced ISR is worth a line.
        if (this.isr.length < this.replicas.length) {
          this.log('replicate', `broker-${this.leader}`, `${this.id}: high watermark = ${m} (минимум LEO среди ISR ${this.isr.join(',')})`, {
            rule: 'hw-min-isr',
            data: { hw: m },
          });
        }
      }
    }
    (this.reps.get(this.leader) as Replica).hw = this.hw;
    const done = this.waiters.filter((w) => w.last < this.hw);
    this.waiters = this.waiters.filter((w) => w.last >= this.hw);
    for (const w of done) {
      this.env.cancel(w.ev);
      w.cb({ error: null, baseOffset: w.base, duplicate: false });
    }
    if (this.waiters.length > 0 && this.isr.length < this.minIsr()) {
      this.log('error', `broker-${this.leader}`, `${this.id}: ISR сократился до ${this.isr.length}, записи ждут подтверждения: ошибка 20 (запись в логе лидера есть)`, {
        rule: 'not-enough-replicas',
        data: { code: 20 },
      });
      this.failWaiters(20);
    }
  }

  /** Periodic: followers beyond replica.lag.time.max.ms leave the ISR. */
  checkIsr(): void {
    if (this.leader === null) return;
    const lr = this.leaderLog as Log;
    const lag = this.env.conf(this.topic).replicaLagMs;
    const now = this.env.now;
    let changed = false;
    for (const b of [...this.isr]) {
      if (b === this.leader) continue;
      const f = this.reps.get(b) as Replica;
      const healthy = this.env.brokerUp(b) && this.env.stalledUntil(b) <= now;
      if (f.log.leo >= lr.leo) {
        if (healthy) f.lastCaughtUp = now;
        continue;
      }
      if (now - f.lastCaughtUp > lag) {
        this.isr = this.isr.filter((x) => x !== b);
        changed = true;
        this.log('isr', `broker-${this.leader}`, `${this.id}: реплика на брокере ${b} не догоняла лидера более ${lag} мс и выходит из ISR (теперь ${this.isr.join(',')})`, {
          rule: 'isr-shrink',
          data: { broker: b, isr: this.isr.length },
        });
      }
    }
    if (changed) this.recomputeHw();
  }

  /** Called when a broker stalls: a follower that is caught up right now keeps that timestamp. */
  markCaughtUp(broker: number): void {
    const f = this.reps.get(broker);
    if (f && this.leader !== null && broker !== this.leader && f.log.leo >= this.leo) f.lastCaughtUp = this.env.now;
  }

  // ------------------------------------------------------------------- followers

  /** Schedules a fetch for every follower that has none pending. */
  kick(): void {
    for (const [b, r] of this.reps) {
      if (b === this.leader || r.fetchPending || !this.env.brokerUp(b)) continue;
      r.fetchPending = true;
      this.env.schedule(FETCH_MS, 1, 'repl.fetch', { topic: this.topic, partition: this.index, broker: b });
    }
  }

  followerFetch(broker: number): void {
    const f = this.reps.get(broker);
    if (!f) return;
    f.fetchPending = false;
    if (this.leader === null || broker === this.leader || !this.env.brokerUp(broker)) return;
    const now = this.env.now;
    const stall = this.env.stalledUntil(broker);
    if (stall > now) {
      f.fetchPending = true;
      this.env.schedule(stall - now, 1, 'repl.fetch', { topic: this.topic, partition: this.index, broker });
      return;
    }
    const lr = this.leaderLog as Log;
    if (f.needsTruncate) {
      f.needsTruncate = false;
      const cut = Math.min(f.log.leo, lr.endOffsetForEpoch(f.log.lastEpoch()));
      const removed = f.log.truncateTo(cut);
      if (removed.length > 0) {
        this.log('replicate', `broker-${broker}`, `${this.id}: брокер ${broker} усёк лог до смещения ${cut}: записи ${removed[0].offset}–${removed[removed.length - 1].offset} не совпадают с логом нового лидера`, {
          rule: 'acks-loss',
          data: { to: cut },
        });
        for (const r of removed) if (r.msg && this.env.acked(r.msg)) this.env.lose(r.msg, `${this.id}: запись ${r.msg} (смещение ${r.offset}) подтверждена издателю, но осталась только на старом лидере и удалена при усечении`);
      }
    }
    if (f.log.leo < lr.logStart) f.log.resetTo(lr.logStart);
    const conf = this.env.conf(this.topic);
    const roll = { segmentBytes: conf.segmentBytes, segmentMs: conf.segmentMs };
    const from = f.log.leo;
    const recs = lr.read(from, Infinity, lr.leo);
    for (const r of recs) f.log.append({ ...r, headers: r.headers.map((h) => [...h] as [string, string]) }, roll, now, r.offset);
    if (f.log.leo < lr.leo) f.log.leo = lr.leo;
    f.hw = Math.min(this.hw, f.log.leo);
    if (f.log.leo >= lr.leo) f.lastCaughtUp = now;
    if (recs.length > 0) {
      this.log('replicate', `broker-${broker}`, `${this.id}: брокер ${broker} скопировал записи ${recs[0].offset}–${recs[recs.length - 1].offset} с лидера ${this.leader}`, {
        data: { from: recs[0].offset, to: recs[recs.length - 1].offset },
      });
    }
    if (!this.isr.includes(broker) && f.log.leo >= lr.leo) {
      this.isr.push(broker);
      this.log('isr', `broker-${this.leader}`, `${this.id}: реплика на брокере ${broker} догнала лидера и возвращается в ISR (${this.isr.join(',')})`, {
        rule: 'isr-expand',
        data: { broker, isr: this.isr.length },
      });
    }
    this.recomputeHw();
    if (lr.leo > f.log.leo) this.kick();
  }

  // ------------------------------------------------------------------- elections

  private rebuildProducerState(): void {
    this.pids.clear();
    this.lastSeq.clear();
    for (const r of this.leaderLog?.all() ?? []) {
      if (r.pid === undefined || r.seq === undefined) continue;
      this.pids.set(`${r.pid}:${r.seq}`, r.offset);
      this.lastSeq.set(r.pid, Math.max(this.lastSeq.get(r.pid) ?? -1, r.seq));
    }
  }

  /** First live replica of the ISR in replica order; with unclean.leader.election.enable also any live replica. */
  elect(): void {
    const old = this.leader ?? this.lastLeader;
    const conf = this.env.conf(this.topic);
    const live = (b: number): boolean => this.env.brokerUp(b);
    let cand = this.replicas.find((b) => this.isr.includes(b) && live(b));
    let unclean = false;
    if (cand === undefined && conf.unclean) {
      cand = this.replicas.find(live);
      unclean = cand !== undefined;
    }
    this.failWaiters(old === null ? 5 : 6);
    if (cand === undefined) {
      this.lastLeader = this.leader ?? this.lastLeader;
      this.leader = null;
      this.log('leader', 'controller', `${this.id}: нет кандидата в лидеры, раздел недоступен (unclean.leader.election.enable=false, ждём реплику из ISR)`, {
        rule: 'unclean-election',
        data: { leader: null },
      });
      return;
    }
    const rep = this.reps.get(cand) as Replica;
    this.leader = cand;
    this.lastLeader = null;
    this.epoch++;
    if (unclean) this.isr = [cand];
    else this.isr = this.isr.filter(live);
    this.hw = Math.min(rep.hw, rep.log.leo);
    for (const [b, r] of this.reps) {
      if (b !== cand) {
        r.needsTruncate = true;
        r.fetchPending = false;
      }
    }
    const oldRep = old !== null && old !== cand ? this.reps.get(old) : undefined;
    if (oldRep) {
      for (const r of oldRep.log.read(rep.log.leo, Infinity, Infinity)) {
        if (r.msg && this.env.acked(r.msg)) this.env.lose(r.msg, `${this.id}: запись ${r.msg} (смещение ${r.offset}) была подтверждена, но новый лидер её не получил`);
      }
    }
    this.rebuildProducerState();
    this.log(
      'leader',
      'controller',
      unclean
        ? `${this.id}: нечистые выборы: лидер — брокер ${cand}, которого не было в ISR; записи после смещения ${rep.log.leo - 1} могли пропасть`
        : `${this.id}: лидер — брокер ${cand}, эпоха ${this.epoch}`,
      { rule: unclean ? 'unclean-election' : 'leader-election', data: { leader: cand, epoch: this.epoch } },
    );
    this.recomputeHw();
    this.kick();
  }

  /** Re-runs the election for an offline partition (a replica came back or the unclean flag changed). */
  maybeElect(): void {
    if (this.leader === null) this.elect();
  }

  brokerCrashed(broker: number): void {
    if (!this.reps.has(broker)) return;
    const r = this.reps.get(broker) as Replica;
    r.fetchPending = false;
    if (this.isr.includes(broker) && this.isr.length > 1) {
      this.isr = this.isr.filter((b) => b !== broker);
      this.log('isr', 'controller', `${this.id}: брокер ${broker} недоступен и выходит из ISR (${this.isr.join(',')})`, {
        rule: 'isr-shrink',
        data: { broker, isr: this.isr.length },
      });
    }
    if (this.leader === broker) this.elect();
    else if (this.leader !== null) this.recomputeHw();
  }

  brokerRestarted(broker: number): void {
    const r = this.reps.get(broker);
    if (!r) return;
    r.needsTruncate = true;
    r.lastCaughtUp = this.env.now;
    if (this.leader === null) this.elect();
    else if (broker !== this.leader) this.kick();
  }

  /** Records readable by consumers: offsets in [from, HW). */
  readable(from: number, max: number): KRecord[] {
    return this.leaderLog ? this.leaderLog.read(from, max, this.hw) : [];
  }

  snapshot(): PartitionSnapshot {
    const logs: PartitionSnapshot['logs'] = {};
    for (const [b, r] of this.reps) logs[b] = { ...r.log.snapshot(), hw: r.hw };
    return {
      topic: this.topic,
      partition: this.index,
      leader: this.leader,
      epoch: this.epoch,
      replicas: [...this.replicas],
      isr: [...this.isr],
      hw: this.hw,
      leo: this.leo,
      logStart: this.logStart,
      logs,
    };
  }
}
