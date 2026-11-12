import type { Args } from './routing';

export type QueueType = 'classic' | 'quorum';
export type Overflow = 'drop-head' | 'reject-publish' | 'reject-publish-dlx';
export type DeathReason = 'rejected' | 'expired' | 'maxlen' | 'delivery_limit';

export const DEFAULT_DELIVERY_LIMIT = 20;
export const QUORUM_DEFAULT_PRIORITY = 4;
export const QUORUM_MAX_PRIORITY = 31;

export interface MsgProps {
  deliveryMode?: 1 | 2;
  priority?: number;
  /** Per-message TTL: a string of digits, milliseconds. */
  expiration?: string;
  headers?: Args;
  correlationId?: string;
  replyTo?: string;
  messageId?: string;
  /** AMQP spelling (delivery_mode, reply_to, ...) is accepted too and normalised on publish. */
  [other: string]: unknown;
}

/** One entry of the x-death header. */
export interface Death {
  queue: string;
  reason: DeathReason;
  count: number;
  exchange: string;
  'routing-keys': string[];
  time: number;
  'original-expiration'?: string;
}

export interface DeathMark {
  queue: string;
  reason: DeathReason;
  exchange: string;
}

/** The message itself; shared by all copies in queues, replaced (not mutated) when it is dead-lettered. */
export interface Msg {
  id: string;
  body: string;
  size: number;
  /** Exchange it was published to last (the DLX after dead-lettering). */
  exchange: string;
  routingKey: string;
  props: MsgProps;
  persistent: boolean;
  publishedAt: number;
  /** x-death, newest first. */
  deaths: Death[];
  first?: DeathMark;
  last?: DeathMark;
  /** Every dead-lettering in order, for cycle detection. */
  history: { queue: string; reason: DeathReason }[];
  /** Scenario bookkeeping, not visible to AMQP clients. */
  meta?: { key?: string; seq?: number };
}

/** A copy of a message inside one queue. */
export interface QMsg {
  msg: Msg;
  /** Order of first arrival in this queue; requeue goes back by it. */
  pos: number;
  redelivered: boolean;
  /** Absolute expiry time, kept across requeues. */
  expireAt: number | null;
  /** Failed deliveries so far (quorum x-delivery-count). */
  failures: number;
  priority: number;
  /** When the copy reaches disk (persistent message in a durable queue). */
  diskAt: number | null;
}

export interface QueueConfig {
  ttl: number | null;
  expires: number | null;
  maxLength: number | null;
  maxBytes: number | null;
  overflow: Overflow;
  dlx: string | null;
  dlk: string | null;
  maxPriority: number | null;
  deliveryLimit: number;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

export function queueConfig(type: QueueType, args: Args): QueueConfig {
  const ov = args['x-overflow'];
  const mp = num(args['x-max-priority']);
  return {
    ttl: num(args['x-message-ttl']),
    expires: num(args['x-expires']),
    maxLength: num(args['x-max-length']),
    maxBytes: num(args['x-max-length-bytes']),
    overflow: ov === 'reject-publish' || ov === 'reject-publish-dlx' ? ov : 'drop-head',
    dlx: typeof args['x-dead-letter-exchange'] === 'string' ? args['x-dead-letter-exchange'] : null,
    dlk: typeof args['x-dead-letter-routing-key'] === 'string' ? args['x-dead-letter-routing-key'] : null,
    maxPriority: type === 'classic' && mp !== null && mp >= 1 ? Math.min(255, mp) : null,
    deliveryLimit: DEFAULT_DELIVERY_LIMIT,
  };
}

/** Priority a copy gets in a queue; classic queues without x-max-priority ignore it. */
export function effectivePriority(type: QueueType, cfg: QueueConfig, p: number | undefined): number {
  if (type === 'quorum') return Math.min(QUORUM_MAX_PRIORITY, Math.max(0, p ?? QUORUM_DEFAULT_PRIORITY));
  if (cfg.maxPriority === null) return 0;
  return Math.min(cfg.maxPriority, Math.max(0, p ?? 0));
}

/** Time to live in ms of a copy arriving now: the smaller of the queue TTL and the message expiration. */
export function effectiveTtl(cfg: QueueConfig, props: MsgProps): number | null {
  const m = props.expiration !== undefined && /^\d+$/.test(props.expiration) ? Number(props.expiration) : null;
  if (cfg.ttl === null) return m;
  return m === null ? cfg.ttl : Math.min(cfg.ttl, m);
}

export interface RConsumer {
  tag: string;
  channel: number;
  prefetch: number;
  autoAck: boolean;
  /** Delivered, not yet acknowledged. */
  unacked: number;
}

export class RQueue {
  /** Ready messages sorted by pos. */
  ready: QMsg[] = [];
  consumers: RConsumer[] = [];
  /** Index of the consumer to try first (round-robin cursor). */
  cursor = 0;
  nextPos = 1;
  /** Returned messages sitting at the head of a quorum queue. */
  front = 0;
  unacked = 0;
  redeliveredTotal = 0;
  everHadConsumer = false;
  lastUsed = 0;
  expiryEvent = 0;
  ttlEvent = 0;
  deleted = false;
  readonly cfg: QueueConfig;

  constructor(
    readonly name: string,
    readonly type: QueueType,
    readonly durable: boolean,
    /** Owning connection of an exclusive queue. */
    readonly exclusive: number | null,
    readonly autoDelete: boolean,
    readonly args: Args,
  ) {
    this.cfg = queueConfig(type, args);
  }

  get readyBytes(): number {
    let n = 0;
    for (const q of this.ready) n += q.msg.size;
    return n;
  }

  /** Next copy to deliver: highest priority first, then the oldest. */
  head(): QMsg | undefined {
    if (this.ready.length === 0) return undefined;
    if (this.type === 'classic' && this.cfg.maxPriority === null) return this.ready[0];
    let best = this.ready[0];
    for (const q of this.ready) if (q.priority > best.priority) best = q;
    return best;
  }

  remove(q: QMsg): void {
    const i = this.ready.indexOf(q);
    if (i < 0) return;
    this.ready.splice(i, 1);
    if (i < this.front) this.front--;
  }

  append(q: QMsg): void {
    this.ready.push(q);
  }

  /** Back to its place by arrival order; quorum queues put returned messages at the head in return order. */
  returnToQueue(q: QMsg): void {
    if (this.type === 'quorum') {
      this.ready.splice(this.front, 0, q);
      this.front++;
      return;
    }
    let lo = 0;
    let hi = this.ready.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.ready[mid].pos < q.pos) lo = mid + 1;
      else hi = mid;
    }
    this.ready.splice(lo, 0, q);
  }

  /** Consumers with a free window, starting at the cursor; advances the cursor past the pick. */
  pickConsumer(): RConsumer | undefined {
    const n = this.consumers.length;
    for (let k = 0; k < n; k++) {
      const i = (this.cursor + k) % n;
      const c = this.consumers[i];
      if (c.autoAck || c.prefetch === 0 || c.unacked < c.prefetch) {
        this.cursor = (i + 1) % n;
        return c;
      }
    }
    return undefined;
  }

  /** Would one more copy of `size` bytes break the length limits? */
  overLimit(size: number): boolean {
    const c = this.cfg;
    if (c.maxLength !== null && this.ready.length + 1 > c.maxLength) return true;
    return c.maxBytes !== null && this.readyBytes + size > c.maxBytes;
  }
}
