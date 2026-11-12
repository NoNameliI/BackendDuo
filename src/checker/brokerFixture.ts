// A small neutral broker course for tests: every task type with the Rabbit flavor, theory examples of both kinds.
import { loadCourse, type BrokerTask, type Course } from '@/content/loadCourse';

const fence = '```';
const block = (info: string, body: string) => `${fence}${info}\n${body}\n${fence}\n`;
const meta = (o: object) => block('json', JSON.stringify(o, null, 2));

export const DECLARE_FANOUT = [
  'rabbitmqadmin exchanges declare --name events --type fanout --durable true',
  'rabbitmqadmin queues declare --name audit --type classic --durable true',
  'rabbitmqadmin queues declare --name metrics --type classic --durable true',
  'rabbitmqadmin bindings declare --source events --destination-type queue --destination audit --routing-key ""',
  'rabbitmqadmin bindings declare --source events --destination-type queue --destination metrics --routing-key ""',
].join('\n');

export const SCENARIO = {
  sim: 'rabbit',
  seed: 3,
  durationMs: 4000,
  setup: [
    'rabbitmqadmin exchanges declare --name orders --type direct --durable true',
    'rabbitmqadmin queues declare --name emails --type classic --durable true',
    'rabbitmqadmin bindings declare --source orders --destination-type queue --destination emails --routing-key mail',
  ].join('\n'),
  actors: [
    { id: 'api', kind: 'producer', rate: 10, count: 10, message: { body: 'order {n}', exchange: 'orders', routingKey: 'mail' }, config: {} },
    { id: 'mailer', kind: 'consumer', queue: 'emails', processMs: 50, config: { prefetch_count: 1, auto_ack: false, idempotent: false } },
  ],
  faults: [{ at: 320, kind: 'consumer.crash', actor: 'mailer', afterProcess: true }],
  expect: [{ kind: 'noLoss' }, { kind: 'noDuplicateProcessing', actor: 'mailer' }],
};

const lesson = [
  '# Фикстура брокера',
  '',
  'Теория урока.',
  '',
  block('broker example', 'rabbitmqadmin queues declare --name demo --type classic --durable true\nrabbitmqadmin publish message --routing-key demo --payload hi\nrabbitmqadmin queues list --non-interactive'),
  block('scenario example', JSON.stringify(SCENARIO)),
  '## task fx-topology',
  meta({ type: 'topology', title: 'Fanout', hints: ['h'] }),
  'Объявите fanout events с очередями audit и metrics.',
  block('broker solution', DECLARE_FANOUT),
  '## task fx-routing',
  meta({
    type: 'routing',
    title: 'Topic',
    hints: ['h'],
    check: { publish: [{ exchange: 'logs', routingKey: 'app.error.disk', body: 'disk' }, { exchange: 'logs', routingKey: 'app.info.start', body: 'start' }, { exchange: 'logs', routingKey: 'db', body: 'lost' }] },
  }),
  'Привяжите очереди так, чтобы errors получала только ошибки, а all — все сообщения app.',
  block(
    'broker setup',
    [
      'rabbitmqadmin exchanges declare --name logs --type topic --durable true',
      'rabbitmqadmin queues declare --name errors --type classic --durable true',
      'rabbitmqadmin queues declare --name all --type classic --durable true',
    ].join('\n'),
  ),
  block(
    'broker solution',
    [
      'rabbitmqadmin bindings declare --source logs --destination-type queue --destination errors --routing-key "app.error.*"',
      'rabbitmqadmin bindings declare --source logs --destination-type queue --destination all --routing-key "app.#"',
    ].join('\n'),
  ),
  '## task fx-console',
  meta({
    type: 'console',
    title: 'Публикация',
    hints: ['h'],
    check: { compare: ['messages'], require: [{ pattern: 'publish message', message: 'Опубликуйте сообщения командой publish message' }] },
  }),
  'Положите в очередь jobs два сообщения: one и two.',
  block('broker setup', 'rabbitmqadmin queues declare --name jobs --type classic --durable true'),
  block('broker solution', 'rabbitmqadmin publish message --routing-key jobs --payload one\nrabbitmqadmin publish message --routing-key jobs --payload two'),
  '## task fx-scenario',
  meta({ type: 'scenario', title: 'Дубли', hints: ['h'], scenario: 'orders' }),
  'Сделайте обработку писем безопасной к повторной доставке.',
  block('properties starter', '# mailer.idempotent=false'),
  block('properties solution', 'mailer.idempotent=true'),
].join('\n');

const manifest = {
  id: 'fixture',
  title: 'Fixture',
  description: 'D',
  engine: 'broker',
  flavor: 'rabbit',
  errors: 'errors.json',
  scenarios: { orders: 'scenarios/orders.json' },
  worlds: [{ id: 'w1', title: 'W', summary: 'S', lessons: [{ id: 'fx-l1', file: 'l1.md' }] }],
  levels: [
    { xp: 0, title: 'A' },
    { xp: 10, title: 'B' },
  ],
};

export const fixtureFiles = (root = '/courses/fixture'): Record<string, string> => ({
  [`${root}/manifest.json`]: JSON.stringify(manifest),
  [`${root}/errors.json`]: '{}',
  [`${root}/scenarios/orders.json`]: JSON.stringify(SCENARIO),
  [`${root}/l1.md`]: lesson,
});

export function fixtureCourse(): Course {
  return loadCourse(fixtureFiles(), '/courses/fixture');
}

export function fixtureTask(course: Course, id: string): BrokerTask {
  const task = course.worlds[0].lessons[0].tasks.find((t) => t.id === id);
  if (!task || !('brokerSolution' in task)) throw new Error(`no broker task ${id}`);
  return task as BrokerTask;
}
