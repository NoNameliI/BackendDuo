import { beforeAll, describe, expect, it } from 'vitest';
import { nodePython } from '../../scripts/pyodide/node';
import { parseScenario } from '@/engine/sim/scenario';
import { checkClientTask, type ClientRunner } from './broker';
import { fixtureCourse, fixtureTask, kafkaFixtureCourse, SCENARIO } from './brokerFixture';
import type { BrokerTask } from '@/content/loadCourse';

let run: ClientRunner;
beforeAll(async () => {
  const { client } = await nodePython();
  run = async (source, setup) => client(source, setup);
}, 60_000);

const rabbit = fixtureCourse();
const kafka = kafkaFixtureCourse();
const python = (t: BrokerTask) => t as BrokerTask & { type: 'client'; pythonSolution: string; pythonStarter: string };

describe('client tasks (RabbitMQ)', () => {
  const task = python(fixtureTask(rabbit, 'fx-client'));

  it('is read from the lesson: python blocks, simulator, check rules', () => {
    expect(task.type).toBe('client');
    expect(task.sim).toBe('rabbit');
    expect(task.pythonSolution).toContain('basic_publish');
    expect(task.pythonStarter).toMatch(/^#/);
    expect(task.check.require).toHaveLength(1);
  });

  it('passes with the reference program and fails with the starter', async () => {
    expect(await checkClientTask(task, rabbit.scenarios, task.pythonSolution, run)).toEqual({ passed: true, problems: [] });
    const bad = await checkClientTask(task, rabbit.scenarios, task.pythonStarter, run);
    expect(bad.passed).toBe(false);
    expect(bad.problems.join('\n')).toMatch(/basic_publish/);
    expect(bad.problems.join('\n')).toMatch(/jobs/);
  });

  it('compares what the program did, not how it is written', async () => {
    const other = `
import pika
ch = pika.BlockingConnection().channel()
ch.basic_publish('', 'jobs', 'one')
ch.basic_publish('', 'jobs', 'two')
`;
    expect((await checkClientTask(task, rabbit.scenarios, other, run)).passed).toBe(true);
    const wrong = other.replace("'two'", "'three'");
    const r = await checkClientTask(task, rabbit.scenarios, wrong, run);
    expect(r.passed).toBe(false);
    expect(r.problems.join('\n')).toMatch(/«three»/);
  });

  it('applies forbid and reports a Python error with its line, without comparing', async () => {
    const slept = await checkClientTask(task, rabbit.scenarios, `${task.pythonSolution}\nimport time\ntime.sleep(1)`, run);
    expect(slept.problems).toContain('Без sleep');
    const broken = await checkClientTask(task, rabbit.scenarios, 'import pika\nx = 1 / 0\n', run);
    expect(broken.passed).toBe(false);
    expect(broken.problems[0]).toBe('Ошибка в программе: ZeroDivisionError: division by zero (строка 2)');
    const syntax = await checkClientTask(task, rabbit.scenarios, 'x = (', run);
    expect(syntax.problems[0]).toMatch(/^Синтаксическая ошибка/);
  });

  it('judges a scenario task by its expect list after the program ran', async () => {
    const scenario = parseScenario({
      ...SCENARIO,
      actors: SCENARIO.actors.filter((a) => a.kind === 'producer'),
      faults: [],
      expect: [{ kind: 'depthBelow', queue: 'emails', value: 1, byMs: 3500 }],
    });
    const t = { ...task, scenario: 'orders', check: { ...task.check, compare: [], require: [], forbid: [] }, brokerSetup: '' } as typeof task;
    const idle = await checkClientTask(t, { orders: scenario }, 'import pika\nc = pika.BlockingConnection()\nc.channel()\n', run);
    expect(idle.passed).toBe(false);
    const worker = `
import pika
c = pika.BlockingConnection()
ch = c.channel()
ch.basic_consume('emails', lambda ch, method, props, body: None, auto_ack=True)
for _ in range(60):
    c.process_data_events(time_limit=0.1)
`;
    const done = await checkClientTask(t, { orders: scenario }, worker, run);
    expect(done, done.problems.join(' | ')).toEqual({ passed: true, problems: [] });
  });
});

describe('client tasks (Kafka)', () => {
  const task = python(fixtureTask(kafka, 'kx-client'));

  it('passes with the reference program (produce, flush, consume, commit) and fails without', async () => {
    const ok = await checkClientTask(task, kafka.scenarios, task.pythonSolution, run);
    expect(ok, ok.problems.join(' | ')).toEqual({ passed: true, problems: [] });
    const unflushed = await checkClientTask(task, kafka.scenarios, "from confluent_kafka import Producer\np = Producer({})\np.produce('jobs', 'one')\np.produce('jobs', 'two')\n", run);
    expect(unflushed.passed).toBe(false);
    expect(unflushed.problems).toContain('Вызовите flush()');
  });

  it('notices a missing commit through the offsets comparison', async () => {
    const noCommit = task.pythonSolution.replace("'auto.offset.reset': 'earliest'", "'auto.offset.reset': 'earliest', 'enable.auto.commit': False").replace(/\s+consumer\.commit\(msg, asynchronous=False\)/, '');
    expect(noCommit).not.toContain('consumer.commit');
    const r = await checkClientTask(task, kafka.scenarios, noCommit, run);
    expect(r.passed).toBe(false);
  });
});
