import type { ConsumerHandle, KafkaError, ProducerHandle, Rec } from '@/engine/sim/kafka';
import type { KafkaSandbox } from '@/engine/sim/sandbox';
import { err, num, ok, rec, str, waitFor, type Args, type BridgeResult, type OpHandler } from './brokerBridge';

type Config = Record<string, unknown>;

const fromError = (e: KafkaError): BridgeResult => ({ ok: false, error: { code: e.code, name: e.name, text: e.text } });
const MAX_WAIT_MS = 600_000;

/** librdkafka spells some values differently from the Java client the simulator is written after. */
const RESET: Record<string, string> = { smallest: 'earliest', beginning: 'earliest', earliest: 'earliest', largest: 'latest', end: 'latest', latest: 'latest', error: 'none', none: 'none' };

/** librdkafka properties → the simulator's (Java) names, with librdkafka's own defaults where they differ. */
function producerConfig(c: Config): Config {
  const out: Config = {};
  for (const [k, v] of Object.entries(c)) {
    if (k === 'message.timeout.ms') out['delivery.timeout.ms'] = v;
    else if (k === 'message.send.max.retries') out.retries = v;
    else out[k] = v;
  }
  // librdkafka: the idempotent producer is opt-in.
  if (out['enable.idempotence'] === undefined) out['enable.idempotence'] = false;
  return out;
}

function consumerConfig(c: Config): Config {
  const out: Config = { ...c };
  if (typeof out['auto.offset.reset'] === 'string') out['auto.offset.reset'] = RESET[out['auto.offset.reset'].toLowerCase()] ?? out['auto.offset.reset'];
  // librdkafka: range and round-robin by default (no cooperative-sticky), and poll() hands out one message at a time.
  if (out['partition.assignment.strategy'] === undefined) out['partition.assignment.strategy'] = 'range,roundrobin';
  out['max.poll.records'] = 1;
  return out;
}

/** Operations of the `confluent_kafka` shim on the Kafka simulator. */
export function kafkaHandler(box: KafkaSandbox): OpHandler {
  const { model } = box;
  const producers = new Map<string, { h: ProducerHandle; produced: number; served: number }>();
  const consumers = new Map<string, ConsumerHandle>();
  let nextProducer = 1;
  let nextConsumer = 1;

  const message = (r: Rec) => ({ topic: r.topic, partition: r.partition, offset: r.offset, timestamp: r.timestamp, key: r.key, value: r.value, headers: r.headers });
  const unknown = (id: string) => err(-1, 'SANDBOX_ERROR', `Нет клиента ${id}`);

  /** Delivery reports that arrived since the last look. */
  const drain = (p: { h: ProducerHandle; served: number }) => {
    const fresh = p.h.results.slice(p.served);
    p.served = p.h.results.length;
    return fresh.map((d) => ({ id: d.id, topic: d.topic, partition: d.partition, offset: d.offset, timestamp: d.timestamp, error: d.error }));
  };

  return (op, a) => {
    switch (op) {
      case 'producer_create': {
        const id = `python-producer-${nextProducer++}`;
        try {
          producers.set(id, { h: model.producer(id, producerConfig(rec(a, 'config'))), produced: 0, served: 0 });
        } catch (e) {
          return err(-186, '_INVALID_ARG', e instanceof Error ? e.message : String(e));
        }
        return ok({ id });
      }
      case 'produce': {
        const p = producers.get(str(a, 'id'));
        if (!p) return unknown(str(a, 'id'));
        const headers = (Array.isArray(a.headers) ? a.headers : []) as [string, string][];
        const partition = typeof a.partition === 'number' && a.partition >= 0 ? a.partition : undefined;
        p.produced++;
        return ok({ n: p.h.send({ topic: str(a, 'topic'), key: typeof a.key === 'string' ? a.key : null, value: typeof a.value === 'string' ? a.value : null, headers, ...(partition !== undefined ? { partition } : {}), ...(typeof a.timestamp === 'number' && a.timestamp > 0 ? { timestamp: a.timestamp } : {}) }) });
      }
      case 'producer_poll': {
        const p = producers.get(str(a, 'id'));
        if (!p) return unknown(str(a, 'id'));
        const wait = Math.max(0, Math.min(num(a, 'wait_ms'), MAX_WAIT_MS));
        if (wait > 0) waitFor(box, wait, () => p.h.results.length > p.served);
        return ok({ reports: drain(p), left: p.produced - p.h.results.length });
      }
      case 'producer_flush': {
        const p = producers.get(str(a, 'id'));
        if (!p) return unknown(str(a, 'id'));
        const timeout = num(a, 'timeout_ms', -1);
        if (timeout < 0) p.h.flush();
        else model.waitIdle(p.h.raw, Math.min(timeout, MAX_WAIT_MS));
        return ok({ reports: drain(p), left: p.produced - p.h.results.length });
      }
      case 'producer_len': {
        const p = producers.get(str(a, 'id'));
        return p ? ok({ left: p.produced - p.served }) : unknown(str(a, 'id'));
      }
      case 'consumer_create': {
        const config = rec(a, 'config');
        if (typeof config['group.id'] !== 'string' || config['group.id'] === '') return err(-186, '_INVALID_ARG', 'Failed to create consumer: group.id must be set');
        const id = `python-consumer-${nextConsumer++}`;
        try {
          consumers.set(id, model.consumer(id, consumerConfig(config)));
        } catch (e) {
          return err(-186, '_INVALID_ARG', e instanceof Error ? e.message : String(e));
        }
        return ok({ id });
      }
      case 'create_topics': {
        const topics = (Array.isArray(a.topics) ? a.topics : []) as Args[];
        return ok({
          results: topics.map((t) => {
            const parts = num(t, 'num_partitions', -1);
            const rf = num(t, 'replication_factor', -1);
            const config = Object.fromEntries(Object.entries(rec(t, 'config')).map(([k, v]) => [k, String(v)]));
            const r = model.createTopic({ name: str(t, 'topic'), ...(parts > 0 ? { partitions: parts } : {}), ...(rf > 0 ? { replicationFactor: rf } : {}), configs: config });
            return { topic: str(t, 'topic'), error: r.ok ? null : r.error };
          }),
        });
      }
      case 'delete_topics': {
        const names = (Array.isArray(a.topics) ? a.topics : []) as string[];
        return ok({ results: names.map((t) => ({ topic: t, error: (() => { const r = model.deleteTopic(t); return r.ok ? null : r.error; })() })) });
      }
      case 'list_topics': {
        const topics = model.listTopics().map((name) => {
          const d = model.describeTopic(name);
          return d.ok ? { topic: name, partitions: d.value.partitions.map((p) => ({ id: p.partition, leader: p.leader ?? -1, replicas: p.replicas, isrs: p.isr })) } : { topic: name, partitions: [] };
        });
        return ok({ topics });
      }
      case 'watermarks': {
        const part = model.partitionOf(str(a, 'topic'), num(a, 'partition'));
        return part ? ok({ low: part.logStart, high: part.hw }) : err(3, 'UNKNOWN_TOPIC_OR_PARTITION', 'This server does not host this topic-partition.');
      }
    }

    const id = str(a, 'id');
    const c = consumers.get(id);
    if (!c) return undefined;
    const tp = (x: Args) => ({ topic: str(x, 'topic'), partition: num(x, 'partition') });
    const list = (Array.isArray(a.partitions) ? a.partitions : []) as Args[];
    switch (op) {
      case 'subscribe':
        c.subscribe((Array.isArray(a.topics) ? a.topics : []) as string[]);
        return ok();
      case 'unsubscribe':
        c.subscribe([]);
        return ok();
      case 'assign': {
        c.assign(list.map(tp));
        for (const x of list) {
          const off = num(x, 'offset', -1001);
          const part = model.partitionOf(str(x, 'topic'), num(x, 'partition'));
          if (off >= 0) c.seek(tp(x), off);
          else if (off === -2 && part) c.seek(tp(x), part.logStart);
          else if (off === -1 && part) c.seek(tp(x), part.hw);
        }
        return ok();
      }
      case 'assignment':
        return ok({ partitions: c.assignment.map((p) => ({ topic: p.topic, partition: p.partition })) });
      case 'poll': {
        const got = c.poll(Math.max(0, Math.min(num(a, 'timeout_ms'), MAX_WAIT_MS)));
        if (got.length === 0 && c.raw.error) {
          const e = c.raw.error;
          c.raw.error = null;
          return ok({ messages: [], error: e });
        }
        return ok({ messages: got.map(message), error: null });
      }
      case 'seek':
        c.seek(tp(a), num(a, 'offset'));
        return ok();
      case 'commit': {
        const r = Array.isArray(a.offsets) ? c.commitOffsets((a.offsets as Args[]).map((x) => ({ tp: tp(x), offset: num(x, 'offset') }))) : c.commitSync();
        return r ? fromError(r) : ok();
      }
      case 'committed': {
        const group = c.raw.cfg.groupId;
        return ok({ partitions: list.map((x) => ({ ...tp(x), offset: (group ? model.groupOffsets(group, tp(x)) : undefined) ?? -1001 })) });
      }
      case 'position':
        return ok({ partitions: list.map((x) => ({ ...tp(x), offset: c.raw.position(tp(x)) ?? -1001 })) });
      case 'close':
        c.close();
        return ok();
      default:
        return undefined;
    }
  };
}
