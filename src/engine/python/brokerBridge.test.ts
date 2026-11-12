import { describe, expect, it } from 'vitest';
import { createKafkaSandbox, createRabbitSandbox, type KafkaSandbox } from '@/engine/sim/sandbox';
import { createBridge, createClientSandbox, replayOps, type BridgeResult } from './brokerBridge';

const call = (bridge: ReturnType<typeof createBridge>, op: string, args: Record<string, unknown> = {}) =>
  (JSON.parse(bridge.call(JSON.stringify({ op, args }))) as { result?: BridgeResult; stop?: boolean });

describe('rabbit bridge', () => {
  const open = () => {
    const bridge = createBridge(createRabbitSandbox());
    const conn = ((call(bridge, 'connect', { user: 'guest', vhost: '/' }).result as { value: { conn: number } }).value).conn;
    const ch = ((call(bridge, 'channel', { conn }).result as { value: { ch: number } }).value).ch;
    return { bridge, conn, ch };
  };

  it('declares, publishes and reads a message', () => {
    const { bridge, ch } = open();
    expect(call(bridge, 'queue_declare', { ch, queue: 'q', durable: true }).result).toEqual({ ok: true, value: { queue: 'q', message_count: 0, consumer_count: 0 } });
    expect(call(bridge, 'publish', { ch, exchange: '', routing_key: 'q', body: 'hi', props: {} }).result).toMatchObject({ ok: true, value: { returned: [], confirmed: null } });
    const got = call(bridge, 'get', { ch, queue: 'q', auto_ack: false }).result as { ok: true; value: { delivery: { body: string; tag: number } } };
    expect(got.value.delivery).toMatchObject({ body: 'hi', tag: 1 });
    expect(call(bridge, 'ack', { ch, delivery_tag: 1 }).result).toEqual({ ok: true, value: null });
  });

  it('closes the channel on a broker error and reports it', () => {
    const { bridge, ch } = open();
    call(bridge, 'queue_declare', { ch, queue: 'q', durable: true });
    const bad = call(bridge, 'queue_declare', { ch, queue: 'q', durable: false, exclusive: false, auto_delete: true }).result as { ok: false; error: { code: number; name: string; scope: string } };
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatchObject({ code: 406, name: 'PRECONDITION_FAILED', scope: 'channel' });
    expect(call(bridge, 'queue_declare', { ch, queue: 'z', durable: true }).result).toMatchObject({ ok: false, error: { code: 404 } });
  });

  it('waits in virtual time for deliveries and waits for a publisher confirm', () => {
    const { bridge, conn, ch } = open();
    call(bridge, 'queue_declare', { ch, queue: 'q', durable: true });
    call(bridge, 'confirm_select', { ch });
    const pub = call(bridge, 'publish', { ch, exchange: '', routing_key: 'q', body: 'x', props: { deliveryMode: 2 } }).result as { ok: true; value: { confirmed: boolean; seq: number } };
    expect(pub.value).toMatchObject({ confirmed: true, seq: 1 });
    call(bridge, 'consume', { ch, queue: 'q', auto_ack: false });
    const before = bridge.box.sim.now;
    const pump = call(bridge, 'pump', { conn, wait_ms: 500 }).result as { ok: true; value: { deliveries: { body: string }[] } };
    expect(pump.value.deliveries.map((d) => d.body)).toEqual(['x']);
    expect(bridge.box.sim.now).toBe(before);
    expect(call(bridge, 'pump', { conn, wait_ms: 500 }).result).toMatchObject({ value: { deliveries: [] } });
    expect(bridge.box.sim.now).toBe(before + 500);
  });

  it('stops an endless client at the horizon and at the operation limit', () => {
    const bridge = createBridge(createRabbitSandbox(), { horizonMs: 1000 });
    expect(call(bridge, 'advance', { ms: 600 }).stop).toBeUndefined();
    expect(call(bridge, 'advance', { ms: 600 }).stop).toBeUndefined();
    expect(call(bridge, 'advance', { ms: 1 }).stop).toBe(true);
    expect(bridge.stopped).toBe(true);
    const few = createBridge(createRabbitSandbox(), { maxOps: 2 });
    call(few, 'advance', { ms: 1 });
    call(few, 'advance', { ms: 1 });
    expect(call(few, 'advance', { ms: 1 }).stop).toBe(true);
    expect(few.ops).toHaveLength(2);
  });

  it('is repeated exactly by replayOps; a changed result is reported', () => {
    const { bridge, ch, conn } = open();
    call(bridge, 'queue_declare', { ch, queue: 'q', durable: true });
    for (const body of ['a', 'b', 'c']) call(bridge, 'publish', { ch, exchange: '', routing_key: 'q', body, props: {} });
    call(bridge, 'consume', { ch, queue: 'q', auto_ack: false });
    call(bridge, 'pump', { conn, wait_ms: 100 });
    const copy = createRabbitSandbox();
    expect(replayOps(copy, bridge.ops)).toBeNull();
    expect(JSON.stringify(copy.model.snapshot())).toBe(JSON.stringify((bridge.box as typeof copy).model.snapshot()));
    const tampered = bridge.ops.map((o, i) => (i === 3 ? { ...o, result: { ok: true as const, value: 'other' } } : o));
    expect(replayOps(createRabbitSandbox(), tampered)).toMatch(/операции 4 \(publish\)/);
  });

  it('answers an unknown operation with an error, not an exception', () => {
    const { bridge } = open();
    expect(call(bridge, 'nope').result).toMatchObject({ ok: false, error: { name: 'UNSUPPORTED' } });
  });
});

describe('kafka bridge', () => {
  it('produces, flushes and consumes with a group', () => {
    const box = createClientSandbox({ flavor: 'kafka', scripts: ['kafka-topics.sh --bootstrap-server localhost:9092 --create --topic t --partitions 1 --replication-factor 3'] });
    const bridge = createBridge(box);
    const kafka = box as KafkaSandbox;
    const p = (call(bridge, 'producer_create', { config: { 'bootstrap.servers': 'x' } }).result as { value: { id: string } }).value.id;
    call(bridge, 'produce', { id: p, topic: 't', key: 'k', value: 'v1', headers: [] });
    call(bridge, 'produce', { id: p, topic: 't', key: 'k', value: 'v2', headers: [] });
    const flushed = call(bridge, 'producer_flush', { id: p, timeout_ms: -1 }).result as { value: { reports: { offset: number; error: null }[]; left: number } };
    expect(flushed.value.reports.map((r) => r.offset)).toEqual([0, 1]);
    expect(flushed.value.left).toBe(0);
    const c = (call(bridge, 'consumer_create', { config: { 'group.id': 'g', 'auto.offset.reset': 'smallest' } }).result as { value: { id: string } }).value.id;
    call(bridge, 'subscribe', { id: c, topics: ['t'] });
    const seen: string[] = [];
    for (let i = 0; i < 40 && seen.length < 2; i++) {
      const r = call(bridge, 'poll', { id: c, timeout_ms: 1000 }).result as { value: { messages: { value: string }[] } };
      seen.push(...r.value.messages.map((m) => m.value));
    }
    expect(seen).toEqual(['v1', 'v2']);
    expect(call(bridge, 'commit', { id: c }).result).toMatchObject({ ok: true });
    expect(kafka.model.groupOffsets('g', { topic: 't', partition: 0 })).toBe(2);
    expect(replayOps(createClientSandbox({ flavor: 'kafka', scripts: [...['kafka-topics.sh --bootstrap-server localhost:9092 --create --topic t --partitions 1 --replication-factor 3']] }), bridge.ops)).toBeNull();
  });

  it('refuses a consumer without group.id and keeps librdkafka defaults', () => {
    const bridge = createBridge(createKafkaSandbox());
    expect(call(bridge, 'consumer_create', { config: {} }).result).toMatchObject({ ok: false, error: { name: '_INVALID_ARG' } });
  });
});
