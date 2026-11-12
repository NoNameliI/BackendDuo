import type { AmqpError, Args, ChannelId, ConsoleSession, Delivery, RabbitConsoleApi, Result, UnackedInfo } from './api';

/** In-memory stand-in for the model, used only by the console tests. */
interface Q {
  name: string;
  type: 'classic' | 'quorum';
  durable: boolean;
  autoDelete: boolean;
  args: Args;
  msgs: { body: string; exchange: string; routingKey: string; redelivered: boolean }[];
}

const e = (code: AmqpError['code'], name: string, text: string): { ok: false; error: AmqpError } => ({ ok: false, error: { code, name, text, scope: 'channel' } });
const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export function createTestBackend() {
  const queues = new Map<string, Q>();
  const exchanges = new Map<string, { type: 'direct' | 'fanout' | 'topic' | 'headers'; durable: boolean }>();
  const bindings: { source: string; destination: string; destinationType: 'queue' | 'exchange'; routingKey: string }[] = [];
  const channels = new Map<number, { user: string; unacked: (UnackedInfo & { q: Q; raw: Q['msgs'][number] })[] }>();
  const log: string[] = [];
  let nextCh = 1;
  let tag = 0;
  const denied = new Set(['bob']);

  const api: RabbitConsoleApi = {
    declareExchange(vhost, s, user) {
      if (user && denied.has(user)) return e(403, 'ACCESS_REFUSED', `access to exchange '${s.name}' in vhost '${vhost}' refused for user '${user}'`);
      if (s.name.startsWith('amq.')) return e(403, 'ACCESS_REFUSED', `exchange name '${s.name}' contains reserved prefix 'amq.*'`);
      const old = exchanges.get(s.name);
      if (old && old.type !== s.type) return e(406, 'PRECONDITION_FAILED', `inequivalent arg 'type' for exchange '${s.name}' in vhost '${vhost}': received '${s.type}' but current is '${old.type}'`);
      exchanges.set(s.name, { type: s.type, durable: s.durable });
      return ok(undefined);
    },
    declareQueue(vhost, s, user) {
      if (user && denied.has(user)) return e(403, 'ACCESS_REFUSED', `access to queue '${s.name}' in vhost '${vhost}' refused for user '${user}'`);
      const old = queues.get(s.name);
      if (old && old.durable !== s.durable) return e(406, 'PRECONDITION_FAILED', `inequivalent arg 'durable' for queue '${s.name}' in vhost '${vhost}': received '${s.durable}' but current is '${old.durable}'`);
      if (!old) queues.set(s.name, { name: s.name, type: s.type ?? 'classic', durable: s.durable, autoDelete: !!s.autoDelete, args: s.arguments ?? {}, msgs: [] });
      return ok({ name: s.name });
    },
    bind(_v, b) {
      if (!queues.has(b.destination) && b.destinationType === 'queue') return e(404, 'NOT_FOUND', `no queue '${b.destination}' in vhost '/'`);
      bindings.push({ source: b.source, destination: b.destination, destinationType: b.destinationType, routingKey: b.routingKey });
      return ok(undefined);
    },
    unbind(_v, b) {
      const i = bindings.findIndex((x) => x.source === b.source && x.destination === b.destination && x.routingKey === b.routingKey);
      if (i < 0) return e(404, 'NOT_FOUND', 'no binding');
      bindings.splice(i, 1);
      return ok(undefined);
    },
    deleteQueue(_v, name, o) {
      const q = queues.get(name);
      if (!q) return e(404, 'NOT_FOUND', `no queue '${name}' in vhost '/'`);
      if (o?.ifEmpty && q.msgs.length) return e(406, 'PRECONDITION_FAILED', `queue '${name}' in vhost '/' in use`);
      queues.delete(name);
      return ok(q.msgs.length);
    },
    deleteExchange(_v, name) {
      if (!exchanges.delete(name)) return e(404, 'NOT_FOUND', `no exchange '${name}' in vhost '/'`);
      return ok(undefined);
    },
    purge(_v, name) {
      const q = queues.get(name);
      if (!q) return e(404, 'NOT_FOUND', `no queue '${name}' in vhost '/'`);
      const n = q.msgs.length;
      q.msgs.length = 0;
      return ok(n);
    },
    openChannel(user) {
      const id = nextCh++;
      channels.set(id, { user, unacked: [] });
      return ok(id);
    },
    closeChannel(ch) {
      const c = channels.get(ch as number);
      if (c) for (const u of [...c.unacked].reverse()) u.q.msgs.unshift({ ...u.raw, redelivered: true });
      channels.delete(ch as number);
    },
    publish(_ch, p) {
      log.push(`publish ${p.exchange}|${p.routingKey}|${p.body}|${p.mandatory}|${JSON.stringify(p.props ?? null)}`);
      if (p.exchange !== '' && !exchanges.has(p.exchange)) return e(404, 'NOT_FOUND', `no exchange '${p.exchange}' in vhost '/'`);
      const dest = p.exchange === '' ? [p.routingKey].filter((n) => queues.has(n)) : bindings.filter((b) => b.source === p.exchange && b.routingKey === p.routingKey).map((b) => b.destination);
      for (const d of dest) queues.get(d)?.msgs.push({ body: p.body, exchange: p.exchange, routingKey: p.routingKey, redelivered: false });
      if (!dest.length) return e(312, 'NO_ROUTE', 'message returned');
      return ok({});
    },
    consume() {
      return ok('amq.ctag-1');
    },
    ack(ch, t) {
      const c = channels.get(ch as number)!;
      const i = c.unacked.findIndex((u) => u.tag === t);
      if (i < 0) return e(406, 'PRECONDITION_FAILED', `unknown delivery tag ${t}`);
      c.unacked.splice(i, 1);
      return ok(undefined);
    },
    nack(ch, t, _m, requeue) {
      return this.reject(ch, t, requeue);
    },
    reject(ch, t, requeue) {
      const c = channels.get(ch as number)!;
      const i = c.unacked.findIndex((u) => u.tag === t);
      if (i < 0) return e(406, 'PRECONDITION_FAILED', `unknown delivery tag ${t}`);
      const [u] = c.unacked.splice(i, 1);
      if (requeue) u.q.msgs.unshift({ ...u.raw, redelivered: true });
      return ok(undefined);
    },
    get(ch, queue, mode) {
      const q = queues.get(queue);
      if (!q) return e(404, 'NOT_FOUND', `no queue '${queue}' in vhost '/'`);
      const raw = q.msgs.shift();
      if (!raw) return ok(null);
      const d: Delivery = { tag: ++tag, exchange: raw.exchange, routingKey: raw.routingKey, body: raw.body, redelivered: raw.redelivered };
      if (mode === 'manual') channels.get(ch as number)!.unacked.push({ tag: d.tag, queue, body: raw.body, redelivered: raw.redelivered, q, raw });
      return ok(d);
    },
    crash() {
      log.push('crash');
    },
    restart() {
      log.push('restart');
    },
    addVhost(n) {
      log.push(`addVhost ${n}`);
      return ok(undefined);
    },
    deleteVhost(n) {
      return n === '/' ? e(403, 'ACCESS_REFUSED', "cannot delete default vhost '/'") : ok(undefined);
    },
    addUser(n) {
      log.push(`addUser ${n}`);
      return ok(undefined);
    },
    setPermissions(v, u, c, w, r) {
      log.push(`perm ${v} ${u} ${c} ${w} ${r}`);
      return ok(undefined);
    },
    listQueues() {
      return ok([...queues.values()].map((q) => ({ name: q.name, type: q.type, durable: q.durable, autoDelete: q.autoDelete, exclusive: false, arguments: q.args, messages: q.msgs.length, ready: q.msgs.length, unacked: 0, consumers: 0 })));
    },
    listExchanges() {
      return ok([...exchanges].map(([name, x]) => ({ name, type: x.type, durable: x.durable, autoDelete: false, internal: false, arguments: {} })));
    },
    listBindings() {
      return ok(bindings.map((b) => ({ ...b, arguments: {} })));
    },
    listConsumers() {
      return ok([{ queue: 'orders', channel: '<rabbit@sim.1.0>', tag: 'amq.ctag-1', ackRequired: true, prefetch: 5, arguments: {} }]);
    },
    listVhosts: () => ['/', 'shop'],
    listUsers: () => [
      { name: 'guest', tags: ['administrator'] },
      { name: 'bob', tags: [] },
    ],
    unacked(ch: ChannelId) {
      return (channels.get(ch as number)?.unacked ?? []).map(({ tag: t, queue, body, redelivered }) => ({ tag: t, queue, body, redelivered }));
    },
    advance(ms) {
      log.push(`advance ${ms}`);
    },
  };
  return { api, log, queues, session: { user: 'guest', channels: new Map() } as ConsoleSession };
}
