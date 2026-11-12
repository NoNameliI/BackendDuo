import { percentile } from '../metrics';
import { expandTemplate, type Scenario, type ScenarioActor } from '../scenario';
import type { JournalDraft, KernelApi, Model, SimEvent } from '../types';
import { checkAccess, type Operation, type PermissionSet } from './access';
import { deadLetter, deliveryHeaders, isDeadLetterCycle } from './deadletter';
import {
  effectivePriority,
  effectiveTtl,
  RQueue,
  type DeathReason,
  type Msg,
  type MsgProps,
  type QMsg,
  type QueueType,
  type RConsumer,
} from './queue';
import { recover } from './restart';
import { route, sameBinding, type Args, type Binding, type Exchange, type ExchangeType, type RouteCtx } from './routing';
import type { RabbitRule } from './rules';

export type { Args, MsgProps };
export type ChannelId = number;
export type ConnectionId = number;

export interface AmqpError {
  code: 312 | 403 | 404 | 405 | 406;
  name: string;
  text: string;
  scope: 'channel' | 'connection';
}
export type Result<T> = { ok: true; value: T } | { ok: false; error: AmqpError };

export interface Delivery {
  channel: ChannelId;
  tag: number;
  consumerTag: string | null;
  queue: string;
  msgId: string;
  exchange: string;
  routingKey: string;
  body: string;
  redelivered: boolean;
  props: MsgProps;
  /** Published headers plus x-death, x-first/last-death-*, x-delivery-count. */
  headers: Args;
}

export interface Returned {
  replyCode: 312;
  replyText: 'NO_ROUTE';
  exchange: string;
  routingKey: string;
  msgId: string;
  body: string;
  props: MsgProps;
}

export interface ExchangeInfo {
  name: string;
  type: ExchangeType;
  durable: boolean;
  autoDelete: boolean;
  internal: boolean;
  arguments: Args;
}
export interface BindingInfo {
  source: string;
  destination: string;
  destinationType: 'queue' | 'exchange';
  routingKey: string;
  arguments: Args;
}
export interface MessageInfo {
  id: string;
  body: string;
  routingKey: string;
  redelivered: boolean;
  priority: number;
  persistent: boolean;
}
export interface QueueInfo {
  name: string;
  type: QueueType;
  durable: boolean;
  autoDelete: boolean;
  exclusive: boolean;
  arguments: Args;
  /** ready + unacknowledged */
  messages: number;
  ready: number;
  unacked: number;
  consumers: number;
  /** Cumulative requeues. */
  redelivered: number;
}
export interface ConsumerInfo {
  queue: string;
  channel: string;
  tag: string;
  ackRequired: boolean;
  prefetch: number;
  arguments: Args;
}
export interface UserInfo {
  name: string;
  tags: string[];
}
export interface UnackedInfo {
  tag: number;
  queue: string;
  body: string;
  redelivered: boolean;
}
export interface ChannelInfo {
  id: ChannelId;
  connection: ConnectionId;
  user: string;
  vhost: string;
  actor: string | null;
  confirm: boolean;
  unacked: number;
  blocked: number;
  returned: number;
}
export interface VhostSnapshot {
  name: string;
  exchanges: ExchangeInfo[];
  queues: (QueueInfo & { head: MessageInfo[] })[];
  bindings: BindingInfo[];
}
export interface RabbitSnapshot {
  up: boolean;
  alarm: boolean;
  vhosts: VhostSnapshot[];
  users: UserInfo[];
  permissions: { vhost: string; user: string; configure: string; write: string; read: string }[];
  channels: ChannelInfo[];
}

export const FSYNC_MS = 10;
export const RECONNECT_MS = 1000;
export const CONFIRM_RETRY_MS = 1000;
const HEAD_PREVIEW = 100;
const MAX_DEPTH = 16;
const DEFAULT_EXCHANGES: [string, ExchangeType][] = [
  ['', 'direct'],
  ['amq.direct', 'direct'],
  ['amq.fanout', 'fanout'],
  ['amq.headers', 'headers'],
  ['amq.topic', 'topic'],
];

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const NAMES = { 312: 'NO_ROUTE', 403: 'ACCESS_REFUSED', 404: 'NOT_FOUND', 405: 'RESOURCE_LOCKED', 406: 'PRECONDITION_FAILED' } as const;
const fail = (code: AmqpError['code'], text: string, scope: AmqpError['scope'] = 'channel'): { ok: false; error: AmqpError } => ({
  ok: false,
  error: { code, name: NAMES[code], text, scope },
});
const utf8 = (s: string): number => new TextEncoder().encode(s).length;
const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? {}, replacer) === JSON.stringify(b ?? {}, replacer);
function replacer(_k: string, v: unknown): unknown {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
    : v;
}

interface VhostState {
  name: string;
  exchanges: Map<string, Exchange>;
  queues: Map<string, RQueue>;
  bindings: Binding[];
}
interface Conn {
  id: ConnectionId;
  user: string;
  vhost: string;
  /** Closed together with its last channel. */
  auto: boolean;
  channels: Set<ChannelId>;
}
interface Unacked {
  tag: number;
  q: RQueue;
  qm: QMsg;
  consumer: string | null;
}
interface PendingPublish {
  p: PublishSpec;
  id: string;
  seq: number | undefined;
  meta: Msg['meta'];
}
interface Channel {
  id: ChannelId;
  conn: ConnectionId;
  user: string;
  vhost: string;
  open: boolean;
  confirm: boolean;
  nextSeq: number;
  nextTag: number;
  unacked: Map<number, Unacked>;
  consumers: Map<string, { q: RQueue; c: RConsumer }>;
  inbox: Delivery[];
  returns: Returned[];
  blocked: PendingPublish[];
  actor: string | null;
}
interface PendingWork {
  tag: number;
  ev: number;
  id: string;
  key?: string;
  seq?: number;
  publishedAt: number;
}
interface Actor {
  cfg: ScenarioActor;
  ch: ChannelId | null;
  stopped: boolean;
  /** Producer: next message number. */
  n: number;
  attempts: number;
  busyUntil: number;
  pending: PendingWork[];
  processedIds: Set<string>;
  unconfirmed: Map<number, number>;
  lostAcks: number;
  processMs: number;
}
export interface PublishSpec {
  exchange: string;
  routingKey: string;
  body: string;
  mandatory?: boolean;
  props?: MsgProps;
}

/** AMQP spelling of properties (delivery_mode, ...) folded into the camelCase ones. */
function normalizeProps(p: MsgProps = {}): MsgProps {
  const out: MsgProps = { ...p };
  const pick = (camel: string, snake: string): void => {
    if (out[camel] === undefined && out[snake] !== undefined) out[camel] = out[snake];
    delete out[snake];
  };
  pick('deliveryMode', 'delivery_mode');
  pick('correlationId', 'correlation_id');
  pick('replyTo', 'reply_to');
  pick('messageId', 'message_id');
  if (typeof out.expiration === 'number') out.expiration = String(out.expiration);
  return out;
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

export class RabbitModel implements Model<RabbitSnapshot> {
  readonly flavor = 'rabbit' as const;
  private k: KernelApi = stubKernel();
  private clock: ((ms: number) => void) | null = null;
  private up = true;
  private alarm = false;
  private readonly vhosts = new Map<string, VhostState>();
  private readonly users = new Map<string, string[]>();
  private readonly perms = new Map<string, PermissionSet>();
  private readonly conns = new Map<ConnectionId, Conn>();
  private readonly channels = new Map<ChannelId, Channel>();
  private readonly actors = new Map<string, Actor>();
  private readonly work = new Set<number>();
  private nextConn = 1;
  private nextChannel = 1;
  private nextMsg = 1;
  private nextCtag = 1;
  private nextGen = 1;
  private readonly latencies: number[] = [];
  private readonly counters = { publish: 0, deliver: 0, ack: 0 };
  private readonly history: Record<'publish' | 'deliver' | 'ack', [number, number][]> = { publish: [], deliver: [], ack: [] };

  constructor(
    private readonly scenario?: Scenario,
    private readonly fsyncMs: number = FSYNC_MS,
  ) {
    this.makeVhost('/');
    this.users.set('guest', ['administrator']);
    this.perms.set(this.pkey('/', 'guest'), { configure: '.*', write: '.*', read: '.*' });
  }

  // ---------------------------------------------------------------- kernel

  attach(k: KernelApi): void {
    this.k = k;
    const sc = this.scenario;
    if (!sc) return;
    for (const a of sc.actors) {
      this.actors.set(a.id, {
        cfg: a,
        ch: null,
        stopped: false,
        n: 1,
        attempts: 0,
        busyUntil: 0,
        pending: [],
        processedIds: new Set(),
        unconfirmed: new Map(),
        lostAcks: 0,
        processMs: a.processMs ?? 0,
      });
      if (a.kind === 'producer') {
        if (a.count !== 0) this.sched(0, 3, 'producer.tick', { actor: a.id });
      } else this.sched(0, 3, 'consumer.connect', { actor: a.id });
    }
    for (const f of sc.faults) {
      const { at, kind, ...data } = f;
      this.sched(Math.max(0, at), 0, kind, data);
    }
  }

  private sched(delay: number, cls: 0 | 1 | 2 | 3, kind: string, data: Record<string, unknown> = {}, track = true): number {
    const id = this.k.schedule(delay, cls, kind, data);
    if (track) this.work.add(id);
    return id;
  }

  /** The player gives the model a way to move the clock; `advance` (console `sim run`) uses it. */
  setClock(advance: (ms: number) => void): void {
    this.clock = advance;
  }
  advance(ms: number): void {
    this.clock?.(ms);
  }

  handle(ev: SimEvent): void {
    this.work.delete(ev.id);
    const d = ev.data;
    const actor = typeof d.actor === 'string' ? this.actors.get(d.actor) : undefined;
    switch (ev.kind) {
      case 'producer.tick':
        if (actor) this.producerTick(actor);
        break;
      case 'producer.retry':
        if (actor) this.producerSend(actor, Number(d.n));
        break;
      case 'consumer.connect':
        if (actor) this.attachConsumer(actor);
        break;
      case 'consumer.done':
        if (actor) this.consumerDone(actor, Number(d.tag), Number(d.ch));
        break;
      case 'confirm':
        this.confirmArrived(Number(d.ch), Number(d.seq), String(d.msg), d.ok === true);
        break;
      case 'queue.ttl':
        this.queueTtl(String(d.vhost), String(d.queue));
        break;
      case 'queue.expires':
        this.queueExpires(String(d.vhost), String(d.queue));
        break;
      case 'consumer.stop':
        if (actor) this.actorStop(actor);
        break;
      case 'consumer.start':
        if (actor) {
          actor.stopped = false;
          this.attachConsumer(actor);
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
        if (actor) {
          actor.lostAcks++;
          this.log('fault', actor.cfg.id, `Следующее подтверждение для ${actor.cfg.id} потеряется по дороге`);
        }
        break;
      case 'alarm.memory':
        this.setAlarm(d.on !== false);
        break;
      case 'broker.crash':
        this.crash();
        break;
      case 'broker.restart':
        this.restart();
        break;
      default:
    }
  }

  sample(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const v of this.sortedVhosts()) {
      const pre = v.name === '/' ? '' : `${v.name}:`;
      for (const q of [...v.queues.values()].sort((a, b) => (a.name < b.name ? -1 : 1))) {
        out[`q.${pre}${q.name}.ready`] = q.ready.length;
        out[`q.${pre}${q.name}.unacked`] = q.unacked;
        out[`q.${pre}${q.name}.redelivered`] = q.redeliveredTotal;
      }
    }
    const now = this.k.now;
    for (const key of ['publish', 'deliver', 'ack'] as const) {
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
    if (this.work.size > 0) return false;
    for (const ch of this.channels.values()) if (ch.blocked.length > 0) return false;
    return true;
  }

  snapshot(): RabbitSnapshot {
    return {
      up: this.up,
      alarm: this.alarm,
      vhosts: this.sortedVhosts().map((v) => ({
        name: v.name,
        exchanges: this.exchangeInfos(v),
        queues: this.queueInfos(v).map((qi) => ({
          ...qi,
          head: (v.queues.get(qi.name) as RQueue).ready.slice(0, HEAD_PREVIEW).map((m) => ({
            id: m.msg.id,
            body: m.msg.body,
            routingKey: m.msg.routingKey,
            redelivered: m.redelivered,
            priority: m.priority,
            persistent: m.msg.persistent,
          })),
        })),
        bindings: this.bindingInfos(v),
      })),
      users: this.listUsers(),
      permissions: [...this.perms.entries()]
        .map(([key, p]) => {
          const [vhost, user] = key.split('\u0000');
          return { vhost, user, ...p };
        })
        .sort((a, b) => (a.vhost + a.user < b.vhost + b.user ? -1 : 1)),
      channels: [...this.channels.values()]
        .filter((c) => c.open)
        .map((c) => ({
          id: c.id,
          connection: c.conn,
          user: c.user,
          vhost: c.vhost,
          actor: c.actor,
          confirm: c.confirm,
          unacked: c.unacked.size,
          blocked: c.blocked.length,
          returned: c.returns.length,
        })),
    };
  }

  // ---------------------------------------------------------------- helpers

  private log(kind: string, actor: string, text: string, o: Omit<JournalDraft, 'kind' | 'actor' | 'text'> & { rule?: RabbitRule } = {}): void {
    this.k.log({ kind, actor, text, ...o });
  }
  private pkey(vhost: string, user: string): string {
    return `${vhost}\u0000${user}`;
  }
  private makeVhost(name: string): VhostState {
    const v: VhostState = { name, exchanges: new Map(), queues: new Map(), bindings: [] };
    for (const [n, type] of DEFAULT_EXCHANGES) {
      v.exchanges.set(n, { name: n, type, durable: true, autoDelete: false, arguments: {}, everBound: false });
    }
    this.vhosts.set(name, v);
    return v;
  }
  private sortedVhosts(): VhostState[] {
    return [...this.vhosts.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
  }
  private vhost(name: string): Result<VhostState> {
    const v = this.vhosts.get(name);
    if (!this.up) return fail(404, 'broker is down', 'connection');
    return v ? ok(v) : fail(404, `no vhost '${name}'`, 'connection');
  }
  private ctx(v: VhostState): RouteCtx {
    return { exchanges: v.exchanges, bindings: v.bindings, hasQueue: (n) => v.queues.has(n) };
  }
  private denied(user: string | undefined, vhost: string, op: Operation, res: { queue?: string; exchange?: string }): AmqpError | null {
    if (user === undefined) return null;
    const d = checkAccess(this.perms.get(this.pkey(vhost, user)), op, res);
    if (!d) return null;
    return fail(403, `access to ${d.kind} '${d.resource === '' ? '' : d.resource}' in vhost '${vhost}' refused for user '${user}'`).error;
  }
  private newId(): string {
    return `m-${this.nextMsg++}`;
  }
  private chanName(ch: Channel): string {
    return ch.actor ?? `ch-${ch.id}`;
  }

  // ---------------------------------------------------------------- topology

  declareExchange(
    vhost: string,
    s: { name: string; type: ExchangeType; durable: boolean; autoDelete?: boolean; arguments?: Args },
    user?: string,
  ): Result<void> {
    const vr = this.vhost(vhost);
    if (!vr.ok) return vr;
    const v = vr.value;
    if (s.name === '' || s.name.startsWith('amq.')) {
      return fail(403, `exchange name '${s.name}' contains reserved prefix 'amq.*'`);
    }
    const dn = this.denied(user, vhost, 'exchange.declare', { exchange: s.name });
    if (dn) return { ok: false, error: dn };
    const old = v.exchanges.get(s.name);
    const args = s.arguments ?? {};
    if (old) {
      const bad =
        old.type !== s.type
          ? ['type', s.type, old.type]
          : old.durable !== s.durable
            ? ['durable', s.durable, old.durable]
            : old.autoDelete !== !!s.autoDelete
              ? ['auto_delete', !!s.autoDelete, old.autoDelete]
              : !sameJson(old.arguments, args)
                ? ['arguments', JSON.stringify(args), JSON.stringify(old.arguments)]
                : null;
      if (bad) return fail(406, `inequivalent arg '${bad[0]}' for exchange '${s.name}' in vhost '${vhost}': received '${bad[1]}' but current is '${bad[2]}'`);
      return ok(undefined);
    }
    v.exchanges.set(s.name, { name: s.name, type: s.type, durable: s.durable, autoDelete: !!s.autoDelete, arguments: { ...args }, everBound: false });
    this.log('route', 'broker', `Создан exchange ${s.name} (${s.type})`, { subject: s.name });
    return ok(undefined);
  }

  declareQueue(
    vhost: string,
    s: { name: string; type?: QueueType; durable: boolean; exclusive?: boolean; autoDelete?: boolean; arguments?: Args; connection?: ConnectionId },
    user?: string,
  ): Result<{ name: string }> {
    const vr = this.vhost(vhost);
    if (!vr.ok) return vr;
    const v = vr.value;
    const args = s.arguments ?? {};
    const xt = args['x-queue-type'];
    if (xt !== undefined && xt !== 'classic' && xt !== 'quorum') {
      return fail(406, `queue type '${String(xt)}' is not supported by the sandbox`);
    }
    const type: QueueType = s.type ?? (xt === 'quorum' ? 'quorum' : 'classic');
    const serverNamed = s.name === '';
    const name = serverNamed ? `amq.gen-${this.nextGen++}` : s.name;
    if (!serverNamed && name.startsWith('amq.')) return fail(403, `queue name '${name}' contains reserved prefix 'amq.*'`);
    const dn = this.denied(user, vhost, 'queue.declare', { queue: name });
    if (dn) return { ok: false, error: dn };
    const exclusive = !!s.exclusive;
    const old = v.queues.get(name);
    if (old) {
      if (old.exclusive !== null && old.exclusive !== s.connection) {
        return fail(405, `cannot obtain exclusive access to locked queue '${name}' in vhost '${vhost}'`);
      }
      const bad =
        old.type !== type
          ? ['x-queue-type', type, old.type]
          : old.durable !== s.durable
            ? ['durable', s.durable, old.durable]
            : (old.exclusive !== null) !== exclusive
              ? ['exclusive', exclusive, old.exclusive !== null]
              : old.autoDelete !== !!s.autoDelete
                ? ['auto_delete', !!s.autoDelete, old.autoDelete]
                : !sameJson(old.args, args)
                  ? ['arguments', JSON.stringify(args), JSON.stringify(old.args)]
                  : null;
      if (bad) return fail(406, `inequivalent arg '${bad[0]}' for queue '${name}' in vhost '${vhost}': received '${bad[1]}' but current is '${bad[2]}'`);
      this.touch(v, old);
      return ok({ name });
    }
    if (type === 'quorum' && (!s.durable || exclusive)) return fail(406, `quorum queue '${name}' must be durable and not exclusive`);
    if (type === 'quorum' && args['x-overflow'] === 'reject-publish-dlx') {
      return fail(406, `x-overflow 'reject-publish-dlx' is not supported by quorum queues`);
    }
    if (type === 'classic' && !s.durable && !exclusive) {
      return fail(406, `queue '${name}' in vhost '${vhost}': non-exclusive transient queues are not allowed (transient_nonexcl_queues)`);
    }
    if (exclusive && s.connection === undefined) return fail(406, `exclusive queue '${name}' needs the declaring connection`);
    const q = new RQueue(name, type, s.durable, exclusive ? (s.connection as number) : null, !!s.autoDelete, { ...args });
    v.queues.set(name, q);
    this.touch(v, q);
    this.log('route', 'broker', `Создана очередь ${name} (${type})`, { subject: name });
    return ok({ name });
  }

  bind(vhost: string, b: { source: string; destinationType: 'queue' | 'exchange'; destination: string; routingKey: string; arguments?: Args }, user?: string): Result<void> {
    const vr = this.vhost(vhost);
    if (!vr.ok) return vr;
    const v = vr.value;
    if (b.source === '') return fail(403, 'operation not permitted on the default exchange');
    const src = v.exchanges.get(b.source);
    if (!src) return fail(404, `no exchange '${b.source}' in vhost '${vhost}'`);
    const dest = b.destinationType === 'queue' ? v.queues.get(b.destination) : v.exchanges.get(b.destination);
    if (!dest) return fail(404, `no ${b.destinationType} '${b.destination}' in vhost '${vhost}'`);
    const dn = this.denied(user, vhost, 'queue.bind', { queue: b.destination, exchange: b.source });
    if (dn) return { ok: false, error: dn };
    const nb: Binding = { ...b, arguments: { ...(b.arguments ?? {}) } };
    if (!v.bindings.some((x) => sameBinding(x, nb))) v.bindings.push(nb);
    src.everBound = true;
    if (b.destinationType === 'queue') this.touch(v, dest as RQueue);
    return ok(undefined);
  }

  unbind(vhost: string, b: { source: string; destinationType: 'queue' | 'exchange'; destination: string; routingKey: string; arguments?: Args }, user?: string): Result<void> {
    const vr = this.vhost(vhost);
    if (!vr.ok) return vr;
    const v = vr.value;
    if (b.source === '') return fail(403, 'operation not permitted on the default exchange');
    if (!v.exchanges.has(b.source)) return fail(404, `no exchange '${b.source}' in vhost '${vhost}'`);
    const dn = this.denied(user, vhost, 'queue.bind', { queue: b.destination, exchange: b.source });
    if (dn) return { ok: false, error: dn };
    const target: Binding = { ...b, arguments: { ...(b.arguments ?? {}) } };
    v.bindings = v.bindings.filter((x) => !sameBinding(x, target));
    this.exchangeAutoDelete(v, b.source);
    return ok(undefined);
  }

  deleteQueue(vhost: string, name: string, o: { ifEmpty?: boolean; ifUnused?: boolean; user?: string } = {}): Result<number> {
    const vr = this.vhost(vhost);
    if (!vr.ok) return vr;
    const v = vr.value;
    const q = v.queues.get(name);
    if (!q) return fail(404, `no queue '${name}' in vhost '${vhost}'`);
    const dn = this.denied(o.user, vhost, 'queue.delete', { queue: name });
    if (dn) return { ok: false, error: dn };
    if (o.ifEmpty && q.ready.length + q.unacked > 0) return fail(406, `queue '${name}' in vhost '${vhost}' in use: not empty`);
    if (o.ifUnused && q.consumers.length > 0) return fail(406, `queue '${name}' in vhost '${vhost}' in use: has consumers`);
    return ok(this.removeQueue(v, q, 'удалена'));
  }

  deleteExchange(vhost: string, name: string, user?: string): Result<void> {
    const vr = this.vhost(vhost);
    if (!vr.ok) return vr;
    const v = vr.value;
    if (name === '' || name.startsWith('amq.')) return fail(403, `exchange '${name}' cannot be deleted`);
    if (!v.exchanges.has(name)) return fail(404, `no exchange '${name}' in vhost '${vhost}'`);
    const dn = this.denied(user, vhost, 'exchange.delete', { exchange: name });
    if (dn) return { ok: false, error: dn };
    this.dropExchange(v, name);
    return ok(undefined);
  }

  private dropExchange(v: VhostState, name: string): void {
    v.exchanges.delete(name);
    const gone = v.bindings.filter((b) => b.source === name || (b.destinationType === 'exchange' && b.destination === name));
    v.bindings = v.bindings.filter((b) => !gone.includes(b));
    for (const s of new Set(gone.map((b) => b.source))) this.exchangeAutoDelete(v, s);
  }

  private exchangeAutoDelete(v: VhostState, name: string): void {
    const ex = v.exchanges.get(name);
    if (!ex || !ex.autoDelete || !ex.everBound) return;
    if (v.bindings.some((b) => b.source === name)) return;
    this.log('route', 'broker', `Exchange ${name} удалён: убрана последняя привязка`, { subject: name, rule: 'exchange-auto-delete' });
    this.dropExchange(v, name);
  }

  purge(vhost: string, queue: string): Result<number> {
    const vr = this.vhost(vhost);
    if (!vr.ok) return vr;
    const q = vr.value.queues.get(queue);
    if (!q) return fail(404, `no queue '${queue}' in vhost '${vhost}'`);
    const n = q.ready.length;
    for (const qm of q.ready) this.lose(qm.msg, q.name, 'purge', 'очередь очищена командой purge');
    q.ready = [];
    q.front = 0;
    this.armTtl(vr.value, q);
    return ok(n);
  }

  /** Deletes a queue with everything in it; returns the number of ready messages. */
  private removeQueue(v: VhostState, q: RQueue, how: string, rule?: RabbitRule): number {
    const n = q.ready.length;
    q.deleted = true;
    v.queues.delete(q.name);
    this.k.cancel(q.expiryEvent);
    this.k.cancel(q.ttlEvent);
    for (const qm of q.ready) this.lose(qm.msg, q.name, 'queue-deleted', `очередь ${q.name} ${how}`, rule);
    q.ready = [];
    for (const ch of this.channels.values()) {
      for (const [tag, c] of [...ch.consumers]) if (c.q === q) ch.consumers.delete(tag);
      for (const u of ch.unacked.values()) {
        if (u.q === q) this.lose(u.qm.msg, q.name, 'queue-deleted', `очередь ${q.name} ${how}`, rule);
      }
    }
    q.consumers = [];
    this.log('route', 'broker', `Очередь ${q.name} ${how}`, { subject: q.name, ...(rule ? { rule } : {}) });
    const gone = v.bindings.filter((b) => b.destinationType === 'queue' && b.destination === q.name);
    v.bindings = v.bindings.filter((b) => !gone.includes(b));
    for (const s of new Set(gone.map((b) => b.source))) this.exchangeAutoDelete(v, s);
    return n;
  }

  // ---------------------------------------------------------------- vhosts, users

  addVhost(name: string): Result<void> {
    if (this.vhosts.has(name)) return fail(406, `vhost '${name}' already exists`, 'connection');
    this.makeVhost(name);
    return ok(undefined);
  }
  deleteVhost(name: string): Result<void> {
    const v = this.vhosts.get(name);
    if (!v) return fail(404, `no vhost '${name}'`, 'connection');
    for (const ch of [...this.channels.values()]) if (ch.vhost === name && ch.open) this.closeChannel(ch.id);
    for (const q of [...v.queues.values()]) this.removeQueue(v, q, 'удалена вместе с vhost');
    this.vhosts.delete(name);
    for (const key of [...this.perms.keys()]) if (key.startsWith(`${name}\u0000`)) this.perms.delete(key);
    return ok(undefined);
  }
  addUser(name: string, tags: string[] = []): Result<void> {
    if (this.users.has(name)) return fail(406, `user '${name}' already exists`, 'connection');
    this.users.set(name, [...tags]);
    return ok(undefined);
  }
  setPermissions(vhost: string, user: string, conf: string, write: string, read: string): Result<void> {
    if (!this.vhosts.has(vhost)) return fail(404, `no vhost '${vhost}'`, 'connection');
    if (!this.users.has(user)) return fail(404, `no user '${user}'`, 'connection');
    this.perms.set(this.pkey(vhost, user), { configure: conf, write, read });
    return ok(undefined);
  }

  listVhosts(): string[] {
    return this.sortedVhosts().map((v) => v.name);
  }
  listUsers(): UserInfo[] {
    return [...this.users.entries()].map(([name, tags]) => ({ name, tags: [...tags] })).sort((a, b) => (a.name < b.name ? -1 : 1));
  }
  listExchanges(vhost: string): Result<ExchangeInfo[]> {
    const v = this.vhost(vhost);
    return v.ok ? ok(this.exchangeInfos(v.value)) : v;
  }
  listQueues(vhost: string): Result<QueueInfo[]> {
    const v = this.vhost(vhost);
    return v.ok ? ok(this.queueInfos(v.value)) : v;
  }
  listBindings(vhost: string): Result<BindingInfo[]> {
    const v = this.vhost(vhost);
    return v.ok ? ok(this.bindingInfos(v.value)) : v;
  }
  listConsumers(vhost: string): Result<ConsumerInfo[]> {
    const vr = this.vhost(vhost);
    if (!vr.ok) return vr;
    const out: ConsumerInfo[] = [];
    for (const q of [...vr.value.queues.values()].sort((a, b) => (a.name < b.name ? -1 : 1))) {
      for (const c of q.consumers) {
        out.push({ queue: q.name, channel: `<rabbit@sandbox.0.${c.channel}>`, tag: c.tag, ackRequired: !c.autoAck, prefetch: c.prefetch, arguments: {} });
      }
    }
    return ok(out);
  }
  private exchangeInfos(v: VhostState): ExchangeInfo[] {
    return [...v.exchanges.values()]
      .sort((a, b) => (a.name < b.name ? -1 : 1))
      .map((e) => ({ name: e.name, type: e.type, durable: e.durable, autoDelete: e.autoDelete, internal: false, arguments: { ...e.arguments } }));
  }
  private queueInfos(v: VhostState): QueueInfo[] {
    return [...v.queues.values()]
      .sort((a, b) => (a.name < b.name ? -1 : 1))
      .map((q) => ({
        name: q.name,
        type: q.type,
        durable: q.durable,
        autoDelete: q.autoDelete,
        exclusive: q.exclusive !== null,
        arguments: { ...q.args },
        messages: q.ready.length + q.unacked,
        ready: q.ready.length,
        unacked: q.unacked,
        consumers: q.consumers.length,
        redelivered: q.redeliveredTotal,
      }));
  }
  /** Implicit bindings of the default exchange are not listed. */
  private bindingInfos(v: VhostState): BindingInfo[] {
    return v.bindings.map((b) => ({ source: b.source, destination: b.destination, destinationType: b.destinationType, routingKey: b.routingKey, arguments: { ...b.arguments } }));
  }

  // ---------------------------------------------------------------- connections, channels

  openConnection(user: string, vhost: string, auto = false): Result<ConnectionId> {
    if (!this.up) return fail(404, 'broker is down', 'connection');
    if (!this.vhosts.has(vhost) || !this.users.has(user) || !this.perms.has(this.pkey(vhost, user))) {
      return fail(403, `user '${user}' has no access to vhost '${vhost}'`, 'connection');
    }
    const id = this.nextConn++;
    this.conns.set(id, { id, user, vhost, auto, channels: new Set() });
    return ok(id);
  }

  openChannel(user: string, vhost: string, connection?: ConnectionId): Result<ChannelId> {
    let conn: Conn | undefined;
    if (connection === undefined) {
      const r = this.openConnection(user, vhost, true);
      if (!r.ok) return r;
      conn = this.conns.get(r.value);
    } else {
      conn = this.conns.get(connection);
      if (!conn) return fail(404, `no connection ${connection}`, 'connection');
    }
    if (!conn) return fail(404, 'no connection', 'connection');
    const id = this.nextChannel++;
    conn.channels.add(id);
    this.channels.set(id, {
      id, conn: conn.id, user: conn.user, vhost: conn.vhost, open: true, confirm: false, nextSeq: 1, nextTag: 1,
      unacked: new Map(), consumers: new Map(), inbox: [], returns: [], blocked: [], actor: null,
    });
    return ok(id);
  }

  connectionOf(ch: ChannelId): ConnectionId | undefined {
    return this.channels.get(ch)?.conn;
  }

  closeConnection(conn: ConnectionId): void {
    const c = this.conns.get(conn);
    if (!c) return;
    for (const id of [...c.channels].sort((a, b) => a - b)) this.closeChannel(id);
    this.conns.delete(conn);
    const v = this.vhosts.get(c.vhost);
    if (!v) return;
    for (const q of [...v.queues.values()]) {
      if (q.exclusive === conn) {
        this.log('route', 'broker', `Exclusive-очередь ${q.name} удалена вместе с соединением`, { subject: q.name, rule: 'exclusive-queue' });
        this.removeQueue(v, q, 'удалена вместе с соединением', 'exclusive-queue');
      }
    }
  }

  closeChannel(chId: ChannelId, o: { silent?: boolean } = {}): void {
    const ch = this.channels.get(chId);
    if (!ch || !ch.open) return;
    ch.open = false;
    const v = this.vhosts.get(ch.vhost);
    const touched = new Set<RQueue>();
    for (const tag of [...ch.unacked.keys()].sort((a, b) => a - b)) {
      const u = ch.unacked.get(tag) as Unacked;
      if (u.consumer !== null) {
        const c = ch.consumers.get(u.consumer);
        if (c) c.c.unacked--;
      }
      u.q.unacked--;
      if (v) {
        this.requeue(v, u.q, u.qm, o.silent ? 'silent' : 'close', this.chanName(ch));
        touched.add(u.q);
      }
    }
    ch.unacked.clear();
    ch.blocked = [];
    const gone = [...ch.consumers.values()];
    ch.consumers.clear();
    for (const { q, c } of gone) q.consumers = q.consumers.filter((x) => x !== c);
    if (ch.actor) this.actorGone(ch.actor, ch.id);
    const conn = this.conns.get(ch.conn);
    conn?.channels.delete(ch.id);
    if (v && !o.silent) {
      for (const { q } of gone) this.consumerGone(v, q);
      for (const q of touched) this.dispatch(v, q);
      if (conn?.auto && conn.channels.size === 0) this.closeConnection(conn.id);
    }
  }

  confirmSelect(chId: ChannelId): void {
    const ch = this.channels.get(chId);
    if (ch?.open) ch.confirm = true;
  }

  /** Deliveries pushed to an API consumer's channel since the last call. */
  takeDeliveries(chId: ChannelId): Delivery[] {
    const ch = this.channels.get(chId);
    if (!ch) return [];
    return ch.inbox.splice(0);
  }
  takeReturns(chId: ChannelId): Returned[] {
    return this.channels.get(chId)?.returns.splice(0) ?? [];
  }

  unacked(chId: ChannelId | string): UnackedInfo[] {
    const ch = this.channels.get(Number(chId));
    if (!ch) return [];
    return [...ch.unacked.values()].map((u) => ({ tag: u.tag, queue: u.q.name, body: u.qm.msg.body, redelivered: u.qm.redelivered }));
  }

  private chan(id: ChannelId): Result<Channel> {
    if (!this.up) return fail(404, 'broker is down', 'connection');
    const ch = this.channels.get(id);
    return ch?.open ? ok(ch) : fail(404, `channel ${id} is closed`);
  }

  /** A channel-level error: the channel closes (unacked messages return to their queues). */
  private chanErr(ch: Channel, e: AmqpError, rule?: RabbitRule): { ok: false; error: AmqpError } {
    this.log('error', this.chanName(ch), `Ошибка канала ${ch.id}: ${e.code} ${e.name} — ${e.text}`, rule ? { rule } : {});
    this.closeChannel(ch.id);
    return { ok: false, error: e };
  }

  private lockedFor(q: RQueue, ch: Channel, vhost: string): AmqpError | null {
    if (q.exclusive === null || q.exclusive === ch.conn) return null;
    return fail(405, `cannot obtain exclusive access to locked queue '${q.name}' in vhost '${vhost}'`).error;
  }

  // ---------------------------------------------------------------- publishing

  publish(chId: ChannelId, p: PublishSpec, extra: { id?: string; meta?: Msg['meta'] } = {}): Result<{ seq?: number }> {
    const c = this.chan(chId);
    if (!c.ok) return c;
    const ch = c.value;
    const dn = this.denied(ch.user, ch.vhost, 'basic.publish', { exchange: p.exchange });
    if (dn) return this.chanErr(ch, dn, 'permission-table');
    const seq = ch.confirm ? ch.nextSeq++ : undefined;
    const props = normalizeProps(p.props);
    const item: PendingPublish = {
      p: { ...p, props },
      id: extra.id ?? (typeof props.messageId === 'string' ? props.messageId : this.newId()),
      seq,
      meta: extra.meta,
    };
    if (this.alarm) {
      ch.blocked.push(item);
      this.log('fault', this.chanName(ch), `Публикация ${item.id} задержана: соединение заблокировано alarm`, { msg: item.id, rule: 'alarm-blocks-publishers' });
    } else {
      const e = this.doPublish(ch, item);
      if (e) return { ok: false, error: e };
    }
    return ok(seq === undefined ? {} : { seq });
  }

  private doPublish(ch: Channel, it: PendingPublish): AmqpError | null {
    const v = this.vhosts.get(ch.vhost) as VhostState;
    const { p } = it;
    const who = this.chanName(ch);
    if (p.exchange !== '' && !v.exchanges.has(p.exchange)) {
      const e = fail(404, `no exchange '${p.exchange}' in vhost '${ch.vhost}'`).error;
      this.chanErr(ch, e, 'unknown-exchange-404');
      return e;
    }
    const props = p.props ?? {};
    const msg: Msg = {
      id: it.id,
      body: p.body,
      size: utf8(p.body),
      exchange: p.exchange,
      routingKey: p.routingKey,
      props,
      persistent: props.deliveryMode === 2,
      publishedAt: this.k.now,
      deaths: [],
      history: [],
      meta: it.meta,
    };
    this.counters.publish++;
    this.log('publish', who, `${who} опубликовал ${msg.id} в ${p.exchange === '' ? '(default)' : p.exchange} с ключом «${p.routingKey}»`, {
      subject: p.exchange === '' ? '(default)' : p.exchange,
      msg: msg.id,
      data: { confirms: ch.confirm, body: p.body, key: p.routingKey },
    });
    const targets = route(this.ctx(v), p.exchange, p.routingKey, props.headers ?? {});
    const confirmDelay = (okAck: boolean, delay: number): void => {
      if (it.seq !== undefined) this.sched(delay, 2, 'confirm', { ch: ch.id, seq: it.seq, msg: msg.id, ok: okAck });
    };
    if (targets.length === 0) {
      if (p.mandatory) {
        ch.returns.push({ replyCode: 312, replyText: 'NO_ROUTE', exchange: p.exchange, routingKey: p.routingKey, msgId: msg.id, body: p.body, props });
        this.log('return', 'broker', `${msg.id} возвращён издателю: basic.return 312 NO_ROUTE`, { subject: p.exchange, msg: msg.id, rule: 'mandatory-return', data: { replyCode: 312 } });
      } else {
        this.lose(msg, p.exchange, 'unroutable', 'маршрута нет, сообщение отброшено', 'mandatory-return');
      }
      confirmDelay(true, 0);
      return null;
    }
    let delay = 0;
    let rejected = false;
    for (const t of targets) {
      const q = v.queues.get(t.queue) as RQueue;
      this.log('route', 'broker', `${msg.id} → очередь ${q.name}${t.rule === 'ae-chain' ? ` (через alternate exchange ${t.via})` : ''}`, {
        subject: q.name,
        msg: msg.id,
        rule: t.rule,
      });
      if (msg.persistent && q.durable) delay = this.fsyncMs;
      if (this.enqueue(v, q, msg, 0) === 'rejected') rejected = true;
    }
    confirmDelay(!rejected, rejected ? 0 : delay);
    return null;
  }

  private setAlarmFlush(): void {
    for (const ch of [...this.channels.values()]) {
      const items = ch.blocked.splice(0);
      for (const it of items) if (ch.open) this.doPublish(ch, it);
    }
  }
  setAlarm(on: boolean): void {
    if (this.alarm === on) return;
    this.alarm = on;
    this.log('fault', 'broker', on ? 'Сработал alarm памяти: издатели заблокированы' : 'Alarm снят: издатели разблокированы', {
      rule: 'alarm-blocks-publishers',
    });
    if (!on) this.setAlarmFlush();
  }

  private lose(msg: Msg, subject: string, reason: string, text: string, rule?: RabbitRule): void {
    this.log('drop', 'broker', `${msg.id}: ${text}`, { subject, msg: msg.id, data: { reason }, ...(rule ? { rule } : {}) });
  }

  /** Puts a copy into a queue, applying length limits. */
  private enqueue(v: VhostState, q: RQueue, msg: Msg, depth: number): 'ok' | 'rejected' {
    const now = this.k.now;
    const ttl = effectiveTtl(q.cfg, msg.props);
    const qm: QMsg = {
      msg,
      pos: q.nextPos++,
      redelivered: false,
      expireAt: ttl === null ? null : now + ttl,
      failures: 0,
      priority: effectivePriority(q.type, q.cfg, typeof msg.props.priority === 'number' ? msg.props.priority : undefined),
      diskAt: msg.persistent && q.durable ? now + this.fsyncMs : null,
    };
    if (q.overLimit(msg.size)) {
      if (q.cfg.overflow === 'reject-publish') {
        this.lose(msg, q.name, 'maxlen', `очередь ${q.name} переполнена, reject-publish: сообщение не принято`, 'overflow');
        return 'rejected';
      }
      if (q.cfg.overflow === 'reject-publish-dlx') {
        // Not a loss by itself: deadLetterCopy logs `drop` only when the dead-letter route is missing.
        this.log('overflow', 'broker', `${msg.id}: очередь ${q.name} переполнена, reject-publish-dlx: сообщение не принято и уходит в dead-letter`, {
          subject: q.name, msg: msg.id, rule: 'overflow', data: { reason: 'maxlen' },
        });
        this.deadLetterCopy(v, q, qm, 'maxlen', depth);
        return 'rejected';
      }
      while (q.ready.length > 0 && q.overLimit(msg.size)) {
        const head = q.ready[0];
        q.remove(head);
        this.log('overflow', 'broker', `${head.msg.id}: очередь ${q.name} переполнена, drop-head вытесняет голову`, {
          subject: q.name, msg: head.msg.id, rule: 'overflow', data: { reason: 'maxlen' },
        });
        this.deadLetterCopy(v, q, head, 'maxlen', depth);
      }
      if (q.overLimit(msg.size)) {
        this.deadLetterCopy(v, q, qm, 'maxlen', depth);
        return 'ok';
      }
    }
    q.append(qm);
    q.lastUsed = now;
    this.dispatch(v, q);
    this.armTtl(v, q);
    return 'ok';
  }

  // ---------------------------------------------------------------- dead lettering

  private deadLetterCopy(v: VhostState, q: RQueue, qm: QMsg, reason: DeathReason, depth: number): void {
    const msg = qm.msg;
    const dlx = q.cfg.dlx;
    if (dlx === null || !v.exchanges.has(dlx) || depth >= MAX_DEPTH) {
      this.lose(msg, q.name, reason, `${this.reasonRu(reason)}, dead-letter exchange не задан или не существует: сообщение потеряно`, 'dlx-reasons');
      return;
    }
    if (isDeadLetterCycle(msg, q.name, reason)) {
      this.lose(msg, q.name, 'cycle', `цикл dead-letter без отклонений через ${q.name}: сообщение удалено`, 'dl-cycle');
      return;
    }
    const nm = deadLetter(msg, q.name, reason, dlx, q.cfg.dlk, this.k.now);
    const targets = route(this.ctx(v), dlx, nm.routingKey, nm.props.headers ?? {});
    if (targets.length === 0) {
      this.lose(msg, q.name, reason, `${this.reasonRu(reason)}, но у ${dlx} нет маршрута: сообщение потеряно`, 'dlx-routing-key');
      return;
    }
    for (const t of targets) {
      const tq = v.queues.get(t.queue) as RQueue;
      this.log('deadletter', 'broker', `${msg.id} → dead-letter в ${tq.name} (причина: ${reason}, из ${q.name})`, {
        subject: tq.name,
        msg: msg.id,
        rule: 'x-death',
        data: { reason, from: q.name, body: msg.body },
      });
      if (this.enqueue(v, tq, nm, depth + 1) === 'rejected') {
        this.lose(nm, tq.name, 'maxlen', `${tq.name} не принимает сообщение`, 'overflow');
      }
    }
  }
  private reasonRu(r: DeathReason): string {
    return { rejected: 'отклонено', expired: 'истёк срок', maxlen: 'очередь переполнена', delivery_limit: 'превышен лимит доставок' }[r];
  }

  // ---------------------------------------------------------------- TTL

  private armTtl(v: VhostState, q: RQueue): void {
    this.k.cancel(q.ttlEvent);
    q.ttlEvent = 0;
    const h = q.head();
    if (!h || h.expireAt === null || q.deleted) return;
    q.ttlEvent = this.k.schedule(Math.max(0, h.expireAt - this.k.now), 1, 'queue.ttl', { vhost: v.name, queue: q.name });
  }
  private queueTtl(vhost: string, queue: string): void {
    const v = this.vhosts.get(vhost);
    const q = v?.queues.get(queue);
    if (!v || !q || !this.up) return;
    q.ttlEvent = 0;
    this.dispatch(v, q);
  }
  /** Only the head can expire. */
  private expireHeads(v: VhostState, q: RQueue): void {
    for (;;) {
      const h = q.head();
      if (!h || h.expireAt === null || h.expireAt > this.k.now) return;
      q.remove(h);
      const byQueue = q.cfg.ttl !== null && (h.msg.props.expiration === undefined || q.cfg.ttl <= Number(h.msg.props.expiration));
      this.log('expire', 'broker', `${h.msg.id}: срок жизни в ${q.name} истёк на голове очереди`, {
        subject: q.name, msg: h.msg.id, rule: byQueue ? 'ttl-min' : 'ttl-head-only',
      });
      this.deadLetterCopy(v, q, h, 'expired', 0);
    }
  }

  private touch(v: VhostState, q: RQueue): void {
    q.lastUsed = this.k.now;
    const e = q.cfg.expires;
    if (e === null || e <= 0) return;
    this.k.cancel(q.expiryEvent);
    q.expiryEvent = this.k.schedule(e, 1, 'queue.expires', { vhost: v.name, queue: q.name });
  }
  private queueExpires(vhost: string, queue: string): void {
    const v = this.vhosts.get(vhost);
    const q = v?.queues.get(queue);
    if (!v || !q || q.cfg.expires === null || q.consumers.length > 0) return;
    if (this.k.now - q.lastUsed < q.cfg.expires) return;
    this.removeQueue(v, q, `удалена после ${q.cfg.expires} мс простоя`, 'queue-expires');
  }

  // ---------------------------------------------------------------- delivery

  private dispatch(v: VhostState, q: RQueue): void {
    if (!this.up || q.deleted) return;
    for (;;) {
      this.expireHeads(v, q);
      const qm = q.head();
      if (!qm) break;
      const c = q.pickConsumer();
      if (!c) break;
      this.deliverTo(q, c, qm);
    }
    this.armTtl(v, q);
  }

  private makeDelivery(ch: Channel, q: RQueue, qm: QMsg, tag: number, consumerTag: string | null): Delivery {
    const m = qm.msg;
    return {
      channel: ch.id, tag, consumerTag, queue: q.name, msgId: m.id, exchange: m.exchange, routingKey: m.routingKey, body: m.body,
      redelivered: qm.redelivered, props: { ...m.props },
      headers: deliveryHeaders(m, q.type === 'quorum' ? qm.failures : 0),
    };
  }

  private deliverTo(q: RQueue, c: RConsumer, qm: QMsg): void {
    const ch = this.channels.get(c.channel) as Channel;
    q.remove(qm);
    const tag = ch.nextTag++;
    const who = this.chanName(ch);
    this.counters.deliver++;
    q.lastUsed = this.k.now;
    if (c.autoAck) this.counters.ack++;
    else {
      ch.unacked.set(tag, { tag, q, qm, consumer: c.tag });
      c.unacked++;
      q.unacked++;
    }
    const d = this.makeDelivery(ch, q, qm, tag, c.tag);
    this.log('deliver', who, `${qm.msg.id} доставлено ${who} из ${q.name}${qm.redelivered ? ' (redelivered=true)' : ''}`, {
      subject: q.name, msg: qm.msg.id,
      rule: q.consumers.length > 1 ? 'round-robin' : c.prefetch > 0 && !c.autoAck ? 'prefetch-per-consumer' : undefined,
      data: { tag, redelivered: qm.redelivered },
    });
    if (ch.actor) this.actorDelivery(ch.actor, ch, tag, q, qm, c.autoAck);
    else if (ch.inbox.length < 1000) ch.inbox.push(d);
  }

  consume(chId: ChannelId, queue: string, o: { prefetch: number; autoAck: boolean; tag?: string }): Result<string> {
    const c = this.chan(chId);
    if (!c.ok) return c;
    const ch = c.value;
    const v = this.vhosts.get(ch.vhost) as VhostState;
    const q = v.queues.get(queue);
    if (!q) return this.chanErr(ch, fail(404, `no queue '${queue}' in vhost '${ch.vhost}'`).error);
    const dn = this.denied(ch.user, ch.vhost, 'basic.consume', { queue });
    if (dn) return this.chanErr(ch, dn, 'permission-table');
    const lock = this.lockedFor(q, ch, ch.vhost);
    if (lock) return this.chanErr(ch, lock, 'exclusive-queue');
    const tag = o.tag ?? `amq.ctag-${this.nextCtag++}`;
    if (ch.consumers.has(tag)) return this.chanErr(ch, fail(406, `attempt to reuse consumer tag '${tag}'`).error);
    const cons: RConsumer = { tag, channel: ch.id, prefetch: o.autoAck ? 0 : Math.max(0, o.prefetch), autoAck: o.autoAck, unacked: 0 };
    q.consumers.push(cons);
    q.everHadConsumer = true;
    ch.consumers.set(tag, { q, c: cons });
    this.touch(v, q);
    this.dispatch(v, q);
    return ok(tag);
  }

  /** basic.cancel: in-flight deliveries stay unacknowledged. */
  cancel(chId: ChannelId, tag: string): Result<void> {
    const c = this.chan(chId);
    if (!c.ok) return c;
    const ch = c.value;
    const entry = ch.consumers.get(tag);
    if (!entry) return ok(undefined);
    ch.consumers.delete(tag);
    entry.q.consumers = entry.q.consumers.filter((x) => x !== entry.c);
    for (const u of ch.unacked.values()) if (u.consumer === tag) u.consumer = null;
    this.log('fault', this.chanName(ch), `Потребитель ${tag} отменён; неподтверждённые сообщения остаются у канала`, { subject: entry.q.name, rule: 'close-requeue' });
    this.consumerGone(this.vhosts.get(ch.vhost) as VhostState, entry.q);
    return ok(undefined);
  }

  private consumerGone(v: VhostState, q: RQueue): void {
    if (q.deleted) return;
    if (q.autoDelete && q.everHadConsumer && q.consumers.length === 0) {
      this.removeQueue(v, q, 'удалена: ушёл последний потребитель', 'auto-delete');
    } else this.touch(v, q);
  }

  get(chId: ChannelId, queue: string, ackMode: 'auto' | 'manual'): Result<Delivery | null> {
    const c = this.chan(chId);
    if (!c.ok) return c;
    const ch = c.value;
    const v = this.vhosts.get(ch.vhost) as VhostState;
    const q = v.queues.get(queue);
    if (!q) return this.chanErr(ch, fail(404, `no queue '${queue}' in vhost '${ch.vhost}'`).error);
    const dn = this.denied(ch.user, ch.vhost, 'basic.get', { queue });
    if (dn) return this.chanErr(ch, dn, 'permission-table');
    const lock = this.lockedFor(q, ch, ch.vhost);
    if (lock) return this.chanErr(ch, lock, 'exclusive-queue');
    this.touch(v, q);
    this.expireHeads(v, q);
    const qm = q.head();
    this.armTtl(v, q);
    if (!qm) return ok(null);
    q.remove(qm);
    this.armTtl(v, q);
    const tag = ch.nextTag++;
    this.counters.deliver++;
    if (ackMode === 'manual') {
      ch.unacked.set(tag, { tag, q, qm, consumer: null });
      q.unacked++;
    } else this.counters.ack++;
    const who = this.chanName(ch);
    this.log('deliver', who, `${qm.msg.id} выдано ${who} по basic.get из ${q.name}`, { subject: q.name, msg: qm.msg.id, data: { tag, redelivered: qm.redelivered } });
    return ok(this.makeDelivery(ch, q, qm, tag, null));
  }

  // ---------------------------------------------------------------- acknowledgements

  private resolveTags(ch: Channel, tag: number, multiple: boolean): number[] | null {
    if (!multiple) return ch.unacked.has(tag) ? [tag] : null;
    if (tag !== 0 && tag >= ch.nextTag) return null;
    return [...ch.unacked.keys()].filter((t) => tag === 0 || t <= tag).sort((a, b) => a - b);
  }

  private settle(chId: ChannelId, tag: number, multiple: boolean, how: 'ack' | 'requeue' | 'drop'): Result<void> {
    const c = this.chan(chId);
    if (!c.ok) return c;
    const ch = c.value;
    const tags = this.resolveTags(ch, tag, multiple);
    if (!tags) return this.chanErr(ch, fail(406, `unknown delivery tag ${tag}`).error, 'unknown-tag-406');
    const v = this.vhosts.get(ch.vhost) as VhostState;
    const who = this.chanName(ch);
    const touched = new Set<RQueue>();
    for (const t of tags) {
      const u = ch.unacked.get(t) as Unacked;
      ch.unacked.delete(t);
      if (u.consumer !== null) {
        const cons = ch.consumers.get(u.consumer);
        if (cons) cons.c.unacked--;
      }
      u.q.unacked--;
      u.q.lastUsed = this.k.now;
      touched.add(u.q);
      const id = u.qm.msg.id;
      const rule = multiple ? 'ack-multiple' : undefined;
      if (how === 'ack') {
        this.counters.ack++;
        this.log('ack', who, `${who} подтвердил ${id} (тег ${t}${multiple ? `, multiple до ${tag}` : ''})`, { subject: u.q.name, msg: id, ...(rule ? { rule } : {}), data: { tag: t } });
      } else if (how === 'requeue') {
        this.log('nack', who, `${who} вернул ${id} в очередь (nack, requeue=true)`, { subject: u.q.name, msg: id, data: { tag: t, requeue: true } });
        this.requeue(v, u.q, u.qm, 'nack', who);
      } else {
        this.log('nack', who, `${who} отклонил ${id} (requeue=false)`, { subject: u.q.name, msg: id, data: { tag: t, requeue: false } });
        if (!u.q.deleted) this.deadLetterCopy(v, u.q, u.qm, 'rejected', 0);
      }
    }
    for (const q of touched) this.dispatch(v, q);
    return ok(undefined);
  }

  ack(ch: ChannelId, tag: number, multiple = false): Result<void> {
    return this.settle(ch, tag, multiple, 'ack');
  }
  nack(ch: ChannelId, tag: number, multiple: boolean, requeue: boolean): Result<void> {
    return this.settle(ch, tag, multiple, requeue ? 'requeue' : 'drop');
  }
  reject(ch: ChannelId, tag: number, requeue: boolean): Result<void> {
    return this.settle(ch, tag, false, requeue ? 'requeue' : 'drop');
  }

  /** Back into the queue: original place (head for quorum); quorum counts failures against the delivery limit. */
  private requeue(v: VhostState, q: RQueue, qm: QMsg, how: 'nack' | 'close' | 'silent', who: string): void {
    qm.redelivered = true;
    if (q.deleted) return;
    if (how !== 'silent') q.redeliveredTotal++;
    if (q.type === 'quorum' && how !== 'silent') {
      qm.failures++;
      if (qm.failures > q.cfg.deliveryLimit) {
        this.log('requeue', who, `${qm.msg.id}: лимит доставок ${q.cfg.deliveryLimit} превышен`, { subject: q.name, msg: qm.msg.id, rule: 'delivery-limit' });
        this.deadLetterCopy(v, q, qm, 'delivery_limit', 0);
        return;
      }
    }
    q.returnToQueue(qm);
    if (how !== 'silent') {
      this.log('requeue', who, `${qm.msg.id} вернулось в очередь ${q.name} (redelivered=true)`, {
        subject: q.name, msg: qm.msg.id, rule: how === 'close' ? 'close-requeue' : q.type === 'quorum' ? 'delivery-limit' : 'requeue-position',
      });
    }
    this.armTtl(v, q);
  }

  // ---------------------------------------------------------------- confirms

  private confirmArrived(chId: ChannelId, seq: number, msg: string, okAck: boolean): void {
    const ch = this.channels.get(chId);
    if (!ch?.open) return;
    const who = this.chanName(ch);
    const a = ch.actor ? this.actors.get(ch.actor) : undefined;
    if (a && okAck && a.lostAcks > 0) {
      a.lostAcks--;
      const n = a.unconfirmed.get(seq);
      this.log('fault', who, `Подтверждение ${msg} потеряно по дороге`, { msg, data: { seq } });
      if (n !== undefined) {
        a.unconfirmed.delete(seq);
        this.log('fault', who, `${who} не получил подтверждение ${msg} и отправит его повторно`, { msg, data: { seq } });
        this.sched(CONFIRM_RETRY_MS, 3, 'producer.retry', { actor: a.cfg.id, n });
      }
      return;
    }
    a?.unconfirmed.delete(seq);
    this.log('confirm', 'broker', okAck ? `${msg} подтверждено (seq ${seq})` : `${msg} отклонено (nack, seq ${seq})`, {
      msg, rule: 'confirm-after-disk', data: { ok: okAck, seq },
    });
  }

  // ---------------------------------------------------------------- restart

  crash(): void {
    if (!this.up) return;
    this.up = false;
    this.log('fault', 'broker', 'Узел остановлен аварийно', { rule: 'durable-persistent' });
    this.dropAll(this.k.now);
  }

  restart(): void {
    if (this.up) {
      this.log('fault', 'broker', 'Узел перезапускается штатно', { rule: 'durable-persistent' });
      this.dropAll(Infinity);
    } else this.log('fault', 'broker', 'Узел запущен', { rule: 'durable-persistent' });
    this.up = true;
    for (const a of this.actors.values()) {
      if (a.cfg.kind === 'consumer' && !a.stopped) this.sched(RECONNECT_MS, 3, 'consumer.connect', { actor: a.cfg.id });
    }
  }

  private dropAll(crashAt: number): void {
    for (const ch of [...this.channels.values()]) if (ch.open) this.closeChannel(ch.id, { silent: true });
    this.conns.clear();
    for (const v of this.sortedVhosts()) {
      for (const q of v.queues.values()) {
        this.k.cancel(q.ttlEvent);
        this.k.cancel(q.expiryEvent);
      }
      const rep = recover(v, crashAt);
      for (const n of rep.queuesDeleted) this.log('route', 'broker', `Очередь ${n} не пережила перезапуск`, { subject: n, rule: 'durable-persistent' });
      for (const l of rep.lost) {
        this.lose(l.msg, l.queue, l.why, l.why === 'unsynced' ? 'не успело записаться на диск до сбоя' : 'не пережило перезапуск', 'durable-persistent');
      }
      for (const q of v.queues.values()) {
        this.touch(v, q);
        this.armTtl(v, q);
      }
    }
  }

  // ---------------------------------------------------------------- scenario actors

  private actorChannel(a: Actor): ChannelId | null {
    if (!this.up) return null;
    if (a.ch !== null && this.channels.get(a.ch)?.open) return a.ch;
    const r = this.openChannel(String(a.cfg.config.user ?? 'guest'), String(a.cfg.config.vhost ?? '/'));
    if (!r.ok) {
      this.log('error', a.cfg.id, `${a.cfg.id}: не удалось подключиться: ${r.error.text}`);
      return null;
    }
    a.ch = r.value;
    (this.channels.get(r.value) as Channel).actor = a.cfg.id;
    return r.value;
  }

  private producerTick(a: Actor): void {
    const total = a.cfg.count;
    if (a.stopped || (total !== undefined && a.n > total)) return;
    if (!this.up) {
      this.sched(RECONNECT_MS, 3, 'producer.tick', { actor: a.cfg.id });
      return;
    }
    const n = a.n++;
    this.producerSend(a, n);
    if (a.stopped) return;
    if (total === undefined || a.n <= total) {
      const rate = a.cfg.rate ?? 1;
      this.sched(Math.round((n * 1000) / rate) - Math.round(((n - 1) * 1000) / rate), 3, 'producer.tick', { actor: a.cfg.id });
    }
  }

  private producerSend(a: Actor, n: number): void {
    const chId = this.actorChannel(a);
    if (chId === null) return;
    const ch = this.channels.get(chId) as Channel;
    const cfg = a.cfg.config;
    if (cfg.confirms === true && !ch.confirm) this.confirmSelect(chId);
    const m = a.cfg.message ?? {};
    const pr = (m.props ?? {}) as MsgProps;
    const props = normalizeProps({ ...pr, headers: m.headers as Args | undefined });
    if (m.headers === undefined) delete props.headers;
    const id = `${a.cfg.id}-${n}`;
    const r = this.publish(
      chId,
      {
        exchange: m.exchange ?? '',
        routingKey: expandTemplate(m.routingKey ?? a.cfg.queue ?? '', n),
        body: expandTemplate(m.body ?? 'message {n}', n),
        mandatory: cfg.mandatory === true,
        props,
      },
      { id, meta: { key: m.key === undefined ? undefined : expandTemplate(m.key, n), seq: n } },
    );
    if (!r.ok) {
      a.stopped = true;
      return;
    }
    if (r.value.seq !== undefined) a.unconfirmed.set(r.value.seq, n);
  }

  private attachConsumer(a: Actor): void {
    if (!this.up || a.stopped || a.cfg.kind !== 'consumer') return;
    if (a.ch !== null && this.channels.get(a.ch)?.open) return;
    const chId = this.actorChannel(a);
    if (chId === null) return;
    const cfg = a.cfg.config;
    const r = this.consume(chId, a.cfg.queue ?? '', {
      prefetch: typeof cfg.prefetch_count === 'number' ? cfg.prefetch_count : 0,
      autoAck: cfg.auto_ack === true,
      tag: a.cfg.id,
    });
    if (!r.ok) {
      this.log('error', a.cfg.id, `${a.cfg.id}: не удалось подписаться на ${a.cfg.queue}: ${r.error.text}`);
      a.stopped = true;
    }
  }

  private actorDelivery(actor: string, ch: Channel, tag: number, _q: RQueue, qm: QMsg, _auto: boolean): void {
    const a = this.actors.get(actor) as Actor;
    const jitter = a.cfg.jitterMs ? this.k.rng(`consumer:${actor}`).int(0, a.cfg.jitterMs) : 0;
    const start = Math.max(this.k.now, a.busyUntil);
    const end = start + a.processMs + jitter;
    a.busyUntil = end;
    const ev = this.sched(end - this.k.now, 3, 'consumer.done', { actor, tag, ch: ch.id });
    a.pending.push({ tag, ev, id: qm.msg.id, key: qm.msg.meta?.key, seq: qm.msg.meta?.seq, publishedAt: qm.msg.publishedAt });
  }

  /** A consumer's channel is gone: pending timers stop; auto-acked work in progress is lost. */
  private actorGone(actor: string, chId: ChannelId): void {
    const a = this.actors.get(actor);
    if (!a || a.ch !== chId) return;
    const auto = a.cfg.config.auto_ack === true;
    for (const p of a.pending) {
      this.k.cancel(p.ev);
      this.work.delete(p.ev);
      if (auto) {
        this.log('drop', 'broker', `${p.id}: потребитель ${actor} упал, сообщение уже подтверждено автоматически — потеряно`, {
          msg: p.id, data: { reason: 'auto_ack' },
        });
      }
    }
    a.pending = [];
    a.busyUntil = 0;
    a.ch = null;
  }

  private markProcessed(a: Actor, p: PendingWork): void {
    const id = a.cfg.id;
    if (a.cfg.config.idempotent === true && a.processedIds.has(p.id)) {
      this.log('process', id, `${id} уже обрабатывал ${p.id} и пропускает дубль`, { msg: p.id });
      return;
    }
    a.processedIds.add(p.id);
    this.latencies.push(this.k.now - p.publishedAt);
    const data: Record<string, string | number | boolean | null> = { processed: true };
    if (p.key !== undefined) data.key = p.key;
    if (p.seq !== undefined) data.seq = p.seq;
    this.log('process', id, `${id} обработал ${p.id}`, { msg: p.id, data });
  }

  private consumerDone(a: Actor, tag: number, chId: ChannelId): void {
    const i = a.pending.findIndex((p) => p.tag === tag);
    const ch = this.channels.get(chId);
    if (i < 0 || !ch?.open || a.ch !== chId) return;
    const [p] = a.pending.splice(i, 1);
    const id = a.cfg.id;
    const auto = a.cfg.config.auto_ack === true;
    a.attempts++;
    const every = a.cfg.failEveryN ?? 0;
    if (every > 0 && a.attempts % every === 0) {
      // An intended handler failure of the scenario (failEveryN), not a fault of the model.
      this.log('handler.error', id, `${id}: ошибка при обработке ${p.id}`, { msg: p.id });
      if (auto) {
        this.lose({ id: p.id } as Msg, a.cfg.queue ?? '', 'auto_ack', 'ошибка при обработке, а подтверждение уже отправлено: сообщение потеряно');
        return;
      }
      switch (a.cfg.config.on_error) {
        case 'nack-drop':
        case 'reject-drop':
          this.nack(chId, tag, false, false);
          return;
        case 'ack':
          this.ack(chId, tag);
          return;
        default:
          this.nack(chId, tag, false, true);
          return;
      }
    }
    this.markProcessed(a, p);
    if (!auto) this.ack(chId, tag);
  }

  private actorStop(a: Actor): void {
    a.stopped = true;
    if (a.ch !== null) this.closeChannel(a.ch);
    this.log('fault', a.cfg.id, `${a.cfg.id} остановлен, канал закрыт`);
  }

  private actorCrash(a: Actor, afterProcess: boolean): void {
    if (a.ch === null) return;
    const cur = a.pending[0];
    if (afterProcess && cur) {
      a.pending.shift();
      this.k.cancel(cur.ev);
      this.markProcessed(a, cur);
      this.log('fault', a.cfg.id, `${a.cfg.id} упал после обработки ${cur.id}: подтверждение не отправлено`, { msg: cur.id });
    } else this.log('fault', a.cfg.id, `${a.cfg.id} упал до подтверждения`);
    this.closeChannel(a.ch);
    this.sched(RECONNECT_MS, 3, 'consumer.connect', { actor: a.cfg.id });
  }
}
