import type { AmqpError, ChannelId, MsgProps, Result } from '@/engine/sim/rabbit';
import type { RabbitSandbox } from '@/engine/sim/sandbox';
import { bool, num, ok, rec, str, waitFor, type Args, type BridgeResult, type OpHandler } from './brokerBridge';

interface Chan {
  conn: number;
  user: string;
  vhost: string;
  prefetch: number;
  confirm: boolean;
}

const CONFIRM_WAIT_MS = 10_000;
const CHANNEL_OPS = new Set(['exchange_declare', 'queue_declare', 'queue_bind', 'queue_unbind', 'exchange_bind', 'exchange_unbind', 'queue_delete', 'exchange_delete', 'queue_purge', 'confirm_select', 'qos', 'publish', 'consume', 'cancel', 'get', 'ack', 'nack', 'reject']);

/** Operations of the `pika` shim on the RabbitMQ simulator. Channel and connection ids are the model's own. */
export function rabbitHandler(box: RabbitSandbox): OpHandler {
  const { model, sim } = box;
  const conns = new Map<number, { user: string; vhost: string }>();
  const channels = new Map<number, Chan>();

  const fromError = (e: AmqpError): BridgeResult => ({ ok: false, error: { code: e.code, name: e.name, text: e.text, scope: e.scope } });
  /** A failed channel operation closes the channel, as the broker does. */
  const kill = (ch: ChannelId): void => {
    model.closeChannel(ch);
    channels.delete(ch);
  };
  const done = <T>(ch: ChannelId, r: Result<T>, map: (v: T) => unknown = () => null): BridgeResult => {
    if (r.ok) return ok(map(r.value));
    if (r.error.scope === 'channel') kill(ch);
    return fromError(r.error);
  };
  const closed = (id: unknown): BridgeResult => ({ ok: false, error: { code: 404, name: 'NOT_FOUND', text: `channel ${String(id)} is closed`, scope: 'channel' } });

  const queueInfo = (vhost: string, name: string) => {
    const list = model.listQueues(vhost);
    return list.ok ? list.value.find((q) => q.name === name) : undefined;
  };
  const counts = (vhost: string, name: string) => {
    const q = queueInfo(vhost, name);
    return { queue: name, message_count: q?.ready ?? 0, consumer_count: q?.consumers ?? 0 };
  };

  const props = (a: Args): MsgProps => rec(a, 'props') as MsgProps;

  return (op, a) => {
    if (op === 'connect') {
      const user = str(a, 'user', 'guest');
      const vhost = str(a, 'vhost', '/');
      const r = model.openConnection(user, vhost);
      if (!r.ok) return fromError(r.error);
      conns.set(r.value, { user, vhost });
      return ok({ conn: r.value });
    }
    if (op === 'close_connection') {
      const id = num(a, 'conn');
      for (const [ch, c] of channels) if (c.conn === id) channels.delete(ch);
      model.closeConnection(id);
      conns.delete(id);
      return ok();
    }
    if (op === 'channel') {
      const id = num(a, 'conn');
      const c = conns.get(id);
      if (!c) return { ok: false, error: { code: 404, name: 'NOT_FOUND', text: `no connection ${id}`, scope: 'connection' } };
      const r = model.openChannel(c.user, c.vhost, id);
      if (!r.ok) return fromError(r.error);
      channels.set(r.value, { conn: id, user: c.user, vhost: c.vhost, prefetch: 0, confirm: false });
      return ok({ ch: r.value });
    }
    if (op === 'pump') {
      // Deliveries and returned messages of every channel of a connection; waits (virtual time) when there are none.
      const mine = [...channels].filter(([, c]) => c.conn === num(a, 'conn')).map(([id]) => id);
      const grab = () => ({
        deliveries: mine.flatMap((id) => model.takeDeliveries(id)),
        returns: mine.flatMap((id) => model.takeReturns(id).map((r) => ({ ch: id, ...r }))),
      });
      let got = grab();
      const wait = Math.max(0, Math.min(num(a, 'wait_ms'), 600_000));
      if (wait > 0 && got.deliveries.length === 0 && got.returns.length === 0) {
        waitFor(box, wait, () => {
          const more = grab();
          got = { deliveries: [...got.deliveries, ...more.deliveries], returns: [...got.returns, ...more.returns] };
          return got.deliveries.length > 0 || got.returns.length > 0;
        });
      }
      return ok({ ...got, now: sim.now });
    }

    const ch = num(a, 'ch');
    const c = channels.get(ch);
    if (op === 'close_channel') {
      model.closeChannel(ch);
      channels.delete(ch);
      return ok();
    }
    if (!CHANNEL_OPS.has(op)) return undefined;
    if (!c) return closed(ch);
    switch (op) {
      case 'exchange_declare': {
        const name = str(a, 'exchange');
        if (bool(a, 'passive')) {
          const list = model.listExchanges(c.vhost);
          if (list.ok && (name === '' || name.startsWith('amq.') || list.value.some((e) => e.name === name))) return ok();
          kill(ch);
          return { ok: false, error: { code: 404, name: 'NOT_FOUND', text: `no exchange '${name}' in vhost '${c.vhost}'`, scope: 'channel' } };
        }
        const type = str(a, 'type', 'direct');
        if (type !== 'direct' && type !== 'fanout' && type !== 'topic' && type !== 'headers') {
          kill(ch);
          return { ok: false, error: { code: 406, name: 'PRECONDITION_FAILED', text: `unknown exchange type '${type}'`, scope: 'channel' } };
        }
        return done(ch, model.declareExchange(c.vhost, { name, type, durable: bool(a, 'durable'), autoDelete: bool(a, 'auto_delete'), arguments: rec(a, 'arguments') }, c.user));
      }
      case 'queue_declare': {
        const name = str(a, 'queue');
        if (bool(a, 'passive')) {
          if (queueInfo(c.vhost, name)) return ok(counts(c.vhost, name));
          kill(ch);
          return { ok: false, error: { code: 404, name: 'NOT_FOUND', text: `no queue '${name}' in vhost '${c.vhost}'`, scope: 'channel' } };
        }
        const r = model.declareQueue(c.vhost, { name, durable: bool(a, 'durable'), exclusive: bool(a, 'exclusive'), autoDelete: bool(a, 'auto_delete'), arguments: rec(a, 'arguments'), connection: c.conn }, c.user);
        return done(ch, r, (v) => counts(c.vhost, v.name));
      }
      case 'queue_bind':
      case 'queue_unbind': {
        const spec = { source: str(a, 'exchange'), destinationType: 'queue' as const, destination: str(a, 'queue'), routingKey: str(a, 'routing_key'), arguments: rec(a, 'arguments') };
        return done(ch, op === 'queue_bind' ? model.bind(c.vhost, spec, c.user) : model.unbind(c.vhost, spec, c.user));
      }
      case 'exchange_bind':
      case 'exchange_unbind': {
        const spec = { source: str(a, 'source'), destinationType: 'exchange' as const, destination: str(a, 'destination'), routingKey: str(a, 'routing_key'), arguments: rec(a, 'arguments') };
        return done(ch, op === 'exchange_bind' ? model.bind(c.vhost, spec, c.user) : model.unbind(c.vhost, spec, c.user));
      }
      case 'queue_delete':
        return done(ch, model.deleteQueue(c.vhost, str(a, 'queue'), { ifEmpty: bool(a, 'if_empty'), ifUnused: bool(a, 'if_unused'), user: c.user }), (n) => ({ message_count: n }));
      case 'exchange_delete':
        return done(ch, model.deleteExchange(c.vhost, str(a, 'exchange'), c.user));
      case 'queue_purge':
        return done(ch, model.purge(c.vhost, str(a, 'queue')), (n) => ({ message_count: n }));
      case 'confirm_select':
        model.confirmSelect(ch);
        c.confirm = true;
        return ok();
      case 'qos':
        c.prefetch = Math.max(0, num(a, 'prefetch_count'));
        return ok();
      case 'publish': {
        const before = sim.journal.entries().length;
        const r = model.publish(ch, { exchange: str(a, 'exchange'), routingKey: str(a, 'routing_key'), body: str(a, 'body'), mandatory: bool(a, 'mandatory'), props: props(a) });
        if (!r.ok) return done(ch, r);
        const returned = model.takeReturns(ch);
        let confirmed: boolean | null = null;
        if (c.confirm) {
          // A publisher confirm arrives later (after the disk write for persistent messages): wait for it.
          const msg = sim.journal.entries().slice(before).find((e) => e.kind === 'publish')?.msg;
          let seen = before;
          waitFor(
            box,
            CONFIRM_WAIT_MS,
            () => {
              const list = sim.journal.entries();
              for (; seen < list.length; seen++) {
                const e = list[seen];
                if (e.kind === 'confirm' && e.msg === msg) {
                  confirmed = (e.data as { ok?: boolean } | undefined)?.ok !== false;
                  return true;
                }
              }
              return msg === undefined;
            },
            5,
          );
        }
        return ok({ seq: r.value.seq ?? null, returned, confirmed });
      }
      case 'consume': {
        const tag = str(a, 'consumer_tag');
        return done(ch, model.consume(ch, str(a, 'queue'), { prefetch: c.prefetch, autoAck: bool(a, 'auto_ack'), ...(tag ? { tag } : {}) }), (t) => ({ consumer_tag: t }));
      }
      case 'cancel':
        return done(ch, model.cancel(ch, str(a, 'consumer_tag')));
      case 'get':
        return done(ch, model.get(ch, str(a, 'queue'), bool(a, 'auto_ack') ? 'auto' : 'manual'), (d) => ({ delivery: d }));
      case 'ack':
        return done(ch, model.ack(ch, num(a, 'delivery_tag'), bool(a, 'multiple')));
      case 'nack':
        return done(ch, model.nack(ch, num(a, 'delivery_tag'), bool(a, 'multiple'), bool(a, 'requeue', true)));
      case 'reject':
        return done(ch, model.reject(ch, num(a, 'delivery_tag'), bool(a, 'requeue', true)));
      default:
        return undefined;
    }
  };
}
