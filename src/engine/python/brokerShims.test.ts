import { beforeAll, describe, expect, it } from 'vitest';
import { nodePython } from '../../../scripts/pyodide/node';
import { createSandbox, type KafkaSandbox, type RabbitSandbox } from '@/engine/sim/sandbox';
import { replayOps, type ClientSetup } from './brokerBridge';
import type { ClientRunner } from './runtime';

let client: ClientRunner;
beforeAll(async () => {
  ({ client } = await nodePython());
}, 60_000);

const RABBIT: ClientSetup = { flavor: 'rabbit', scripts: [] };
const BS = '--bootstrap-server localhost:9092';
const KAFKA: ClientSetup = { flavor: 'kafka', scripts: [`kafka-topics.sh ${BS} --create --topic orders --partitions 2 --replication-factor 3`] };

/** The main thread's way: build the same simulator and repeat the operations on it. */
function replayed(setup: ClientSetup, ops: ReturnType<ClientRunner>['ops']) {
  const box = createSandbox(setup.flavor, setup.scenario);
  for (const s of setup.scripts) box.run(s);
  expect(replayOps(box, ops)).toBeNull();
  return box;
}

describe('pika shim', () => {
  const PRODUCER_CONSUMER = `
import pika

connection = pika.BlockingConnection(pika.ConnectionParameters('localhost', credentials=pika.PlainCredentials('guest', 'guest')))
channel = connection.channel()
channel.exchange_declare(exchange='logs', exchange_type='topic', durable=True)
channel.queue_declare(queue='errors', durable=True)
channel.queue_bind(queue='errors', exchange='logs', routing_key='app.error.#')
channel.confirm_delivery()
for i in range(3):
    channel.basic_publish('logs', 'app.error.disk', f'm{i}'.encode(), pika.BasicProperties(delivery_mode=pika.DeliveryMode.Persistent, headers={'n': i}))
channel.basic_qos(prefetch_count=1)
got = []

def on_message(ch, method, properties, body):
    got.append((body.decode(), method.delivery_tag, properties.headers, properties.delivery_mode))
    ch.basic_ack(method.delivery_tag)
    if len(got) == 3:
        ch.stop_consuming()

channel.basic_consume('errors', on_message)
channel.start_consuming()
print(got)
print(channel.queue_declare('errors', passive=True).method.message_count)
connection.close()
`;

  it('publishes with confirms, consumes with prefetch and ack, stops from the callback', () => {
    const run = client(PRODUCER_CONSUMER, RABBIT);
    expect(run.error).toBeUndefined();
    expect(run.stopped).toBe(false);
    expect(run.output).toBe("[('m0', 1, {'n': 0}, 2), ('m1', 2, {'n': 1}, 2), ('m2', 3, {'n': 2}, 2)]\n0\n");
    const box = replayed(RABBIT, run.ops) as RabbitSandbox;
    const q = box.model.snapshot().vhosts[0].queues.find((x) => x.name === 'errors');
    expect(q).toMatchObject({ ready: 0, unacked: 0, consumers: 0 });
  });

  it('basic_get, nack with requeue, mandatory returns and broker errors as pika exceptions', () => {
    const run = client(
      `
import pika
from pika.exceptions import ChannelClosedByBroker, UnroutableError
c = pika.BlockingConnection()
ch = c.channel()
ch.queue_declare('jobs', durable=True)
ch.basic_publish('', 'jobs', b'one')
m, props, body = ch.basic_get('jobs')
print(body, m.redelivered)
ch.basic_nack(m.delivery_tag, requeue=True)
m, props, body = ch.basic_get('jobs', auto_ack=True)
print(body, m.redelivered)
print(ch.basic_get('jobs'))
ch.confirm_delivery()
try:
    ch.basic_publish('', 'nowhere', b'x', mandatory=True)
except UnroutableError as e:
    print('unroutable', e.messages[0].body)
try:
    ch.queue_declare('jobs', durable=False)
except ChannelClosedByBroker as e:
    print(e.reply_code, e.reply_text.split(" - ")[0])
print(ch.is_open)
try:
    ch.basic_publish('', 'jobs', b'x')
except pika.exceptions.ChannelWrongStateError as e:
    print('closed')
ch2 = c.channel()
try:
    ch2.tx_select()
except NotImplementedError as e:
    print(e)
`,
      RABBIT,
    );
    expect(run.error).toBeUndefined();
    expect(run.output.split('\n')).toEqual([
      "b'one' False",
      "b'one' True",
      '(None, None, None)',
      'unroutable b\'x\'',
      "406 PRECONDITION_FAILED",
      'False',
      'closed',
      'channel.tx_select(): эта возможность pika не поддерживается в учебной песочнице',
      '',
    ]);
  });

  it('time.sleep and connection.sleep advance virtual time, not real time', () => {
    const started = Date.now();
    const run = client('import time, pika\nc = pika.BlockingConnection()\ntime.sleep(30)\nc.sleep(5)\nprint("done")', RABBIT);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(run.output).toBe('done\n');
    expect(replayed(RABBIT, run.ops).sim.now).toBe(35_000);
  });

  it('stops an endless consumer loop at the horizon without an error', () => {
    const run = client(
      `
import pika
c = pika.BlockingConnection()
ch = c.channel()
ch.queue_declare('q', durable=True)
n = 0
while True:
    c.process_data_events(time_limit=1)
    n += 1
`,
      RABBIT,
    );
    expect(run.error).toBeUndefined();
    expect(run.stopped).toBe(true);
    expect(run.ops.length).toBeGreaterThan(30);
    replayed(RABBIT, run.ops);
  });

  it('reports a mistake of the program with its line', () => {
    const run = client('import pika\nc = pika.BlockingConnection()\nch = c.channel()\nch.queue_declare(1 / 0)\n', RABBIT);
    expect(run.error).toMatchObject({ type: 'ZeroDivisionError', line: 4 });
    expect(client('x = (', RABBIT).error).toMatchObject({ kind: 'syntax' });
    expect(client('import js', RABBIT).error).toMatchObject({ type: 'ImportError' });
  });

  it('each run starts from a fresh simulator', () => {
    const declare = 'import pika\nch = pika.BlockingConnection().channel()\nprint(ch.queue_declare("q", durable=True).method.message_count)\nch.basic_publish("", "q", b"x")';
    expect(client(declare, RABBIT).output).toBe('0\n');
    expect(client(declare, RABBIT).output).toBe('0\n');
  });
});

describe('confluent_kafka shim', () => {
  const PROGRAM = `
from confluent_kafka import Producer, Consumer, KafkaException, TopicPartition
delivered = []

def report(err, msg):
    delivered.append((err, msg.topic(), msg.partition(), msg.offset()))

p = Producer({'bootstrap.servers': 'localhost:9092', 'acks': 'all'})
for i in range(4):
    p.produce('orders', value=f'v{i}', key='user-1', on_delivery=report)
print(len(p))
print(p.flush())
print(delivered)

c = Consumer({'bootstrap.servers': 'localhost:9092', 'group.id': 'billing', 'auto.offset.reset': 'earliest', 'enable.auto.commit': False})
c.subscribe(['orders'])
seen = []
while len(seen) < 4:
    msg = c.poll(1.0)
    if msg is None:
        continue
    if msg.error():
        raise KafkaException(msg.error())
    seen.append((msg.key(), msg.value(), msg.offset()))
    c.commit(msg, asynchronous=False)
print(seen)
print(c.committed([TopicPartition('orders', 0), TopicPartition('orders', 1)]))
c.close()
`;

  it('produces with delivery callbacks, consumes in a group and commits', () => {
    const run = client(PROGRAM, KAFKA);
    expect(run.error).toBeUndefined();
    const [length, left, delivered, seen, committed] = run.output.trim().split('\n');
    expect(length).toBe('4');
    expect(left).toBe('0');
    expect(delivered).toBe("[(None, 'orders', 0, 0), (None, 'orders', 0, 1), (None, 'orders', 0, 2), (None, 'orders', 0, 3)]");
    expect(seen).toBe("[(b'user-1', b'v0', 0), (b'user-1', b'v1', 1), (b'user-1', b'v2', 2), (b'user-1', b'v3', 3)]");
    expect(committed).toContain('offset=4');
    const box = replayed(KAFKA, run.ops) as KafkaSandbox;
    expect(box.model.groupOffsets('billing', { topic: 'orders', partition: 0 })).toBe(4);
  });

  it('keeps unflushed messages unsent and a poll without messages returns None', () => {
    const run = client(
      `
from confluent_kafka import Producer, Consumer
p = Producer({'bootstrap.servers': 'x'})
p.produce('orders', 'lost')
c = Consumer({'bootstrap.servers': 'x', 'group.id': 'g', 'auto.offset.reset': 'earliest'})
c.subscribe(['orders'])
print(c.poll(2.0))
`,
      KAFKA,
    );
    expect(run.error).toBeUndefined();
    expect(run.output).toBe('None\n');
  });

  it('raises KafkaException for admin errors and names unsupported calls', () => {
    const run = client(
      `
from confluent_kafka import KafkaException, KafkaError
from confluent_kafka.admin import AdminClient, NewTopic
a = AdminClient({'bootstrap.servers': 'x'})
fs = a.create_topics([NewTopic('orders', 3, 3), NewTopic('fresh', 2, 3)])
for name, f in fs.items():
    try:
        f.result()
        print(name, 'created')
    except KafkaException as e:
        print(name, e.args[0].code() == KafkaError.TOPIC_ALREADY_EXISTS, e.args[0].name())
print(sorted(a.list_topics().topics))
try:
    a.describe_acls()
except NotImplementedError as e:
    print(e)
`,
      KAFKA,
    );
    expect(run.error).toBeUndefined();
    expect(run.output.split('\n')).toEqual([
      'orders True TOPIC_ALREADY_EXISTS',
      'fresh created',
      "['fresh', 'orders']",
      'AdminClient.describe_acls(): эта возможность confluent_kafka не поддерживается в учебной песочнице',
      '',
    ]);
  });

  it('a Consumer needs group.id and stops an endless poll loop at the horizon', () => {
    expect(client("from confluent_kafka import Consumer\nConsumer({'bootstrap.servers': 'x'})", KAFKA).error?.message).toMatch(/group\.id must be set/);
    const run = client(
      `
from confluent_kafka import Consumer
c = Consumer({'bootstrap.servers': 'x', 'group.id': 'g'})
c.subscribe(['orders'])
while True:
    msg = c.poll(1.0)
`,
      KAFKA,
    );
    expect(run.error).toBeUndefined();
    expect(run.stopped).toBe(true);
  });
});
