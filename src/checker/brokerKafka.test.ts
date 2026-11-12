import { describe, expect, it } from 'vitest';
import type { BrokerTask } from '@/content/loadCourse';
import { theoryExampleBlocks } from '@/content/theory';
import { checkBrokerExamples, checkBrokerTask, createKafkaSandbox, lintBrokerTask, type BrokerInput } from './broker';
import { kafkaFixtureCourse, fixtureTask } from './brokerFixture';

const course = kafkaFixtureCourse();
const task = (id: string) => fixtureTask(course, id);
const solution = (t: BrokerTask): BrokerInput => ({ commands: [t.brokerSolution], props: t.propsSolution });
const starter = (t: BrokerTask): BrokerInput => ({ commands: [t.brokerStarter], props: t.propsStarter });
const check = (t: BrokerTask, input: BrokerInput) => checkBrokerTask(t, course.scenarios, input);
const BS = '--bootstrap-server localhost:9092';

describe('kafka fixture course', () => {
  it('loads with the Kafka simulator on every task', () => {
    expect(course.flavor).toBe('kafka');
    const tasks = course.worlds[0].lessons[0].tasks;
    expect(tasks.map((t) => t.type)).toEqual(['topology', 'routing', 'console', 'client', 'scenario']);
    expect(tasks.every((t) => 'sim' in t && t.sim === 'kafka')).toBe(true);
  });

  it('each task: the reference passes its check, the starter does not', () => {
    for (const id of ['kx-topology', 'kx-routing', 'kx-console', 'kx-scenario']) {
      const t = task(id);
      const ok = check(t, solution(t));
      expect(ok, `${id} solution: ${ok.problems.join(' | ')}`).toEqual({ passed: true, problems: [] });
      expect(check(t, starter(t)).passed, `${id} starter`).toBe(false);
    }
  });

  it('every task lints clean', () => {
    for (const id of ['kx-topology', 'kx-routing', 'kx-console', 'kx-scenario']) expect(lintBrokerTask(task(id), course.scenarios), id).toEqual([]);
  });
});

describe('kafka topology', () => {
  const t = () => task('kx-topology');

  it('names what is missing and what differs', () => {
    const r = check(t(), { commands: [`kafka-topics.sh ${BS} --create --topic orders --partitions 2 --replication-factor 3`], props: '' });
    expect(r.passed).toBe(false);
    expect(r.problems).toContain('Топик «orders»: partitions — ожидается 3, у вас 2');
    expect(r.problems).toContain('Нет настройки «топик orders: retention.ms»');
    const empty = check(t(), { commands: [], props: '' });
    expect(empty.problems).toContain('Нет топика «orders»');
  });

  it('an extra topic and an extra config are reported, an override equal to the default is not', () => {
    const base = `kafka-topics.sh ${BS} --create --topic orders --partitions 3 --replication-factor 3 --config retention.ms=60000`;
    const r = check(t(), { commands: [base, `kafka-topics.sh ${BS} --create --topic extra --partitions 1`, `kafka-configs.sh ${BS} --entity-type topics --entity-name orders --alter --add-config segment.ms=3600000`], props: '' });
    expect(r.problems).toContain('Лишний топик «extra»');
    expect(r.problems).toContain('Лишняя настройка «топик orders: segment.ms»');
    const same = check(t(), { commands: [base, `kafka-configs.sh ${BS} --entity-type topics --entity-name orders --alter --add-config cleanup.policy=delete`], props: '' });
    expect(same.passed).toBe(true);
  });

  it('ignore skips an attribute', () => {
    const ignoring = { ...t(), check: { ...t().check, ignore: ['partitions'] } } as BrokerTask;
    const r = check(ignoring, { commands: [`kafka-topics.sh ${BS} --create --topic orders --partitions 2 --replication-factor 3 --config retention.ms=60000`], props: '' });
    expect(r.passed).toBe(true);
  });

  it('a command that failed is mentioned', () => {
    const r = check(t(), { commands: [`kafka-topics.sh ${BS} --create --topic orders --partitions 3 --replication-factor 9`], props: '' });
    expect(r.passed).toBe(false);
    expect(r.problems.some((p) => p.startsWith('Команда «kafka-topics.sh'))).toBe(true);
  });
});

describe('kafka routing', () => {
  const t = () => task('kx-routing');

  it('key to partition: a different partition count sends records elsewhere, with the journal path', () => {
    const r = check(t(), starter(t()));
    expect(r.passed).toBe(false);
    expect(r.problems.some((p) => p.startsWith('Раздел «events-'))).toBe(true);
    expect(r.problems.some((p) => p.startsWith('Путь записи у вас'))).toBe(true);
    expect(r.trace?.length ?? 0).toBeGreaterThan(0);
  });

  it('a missing topic is a publication error, not a crash', () => {
    const r = check(t(), { commands: [], props: '' });
    expect(r.passed).toBe(false);
  });

  it('lint: a keyless record on a many-partition topic has no fixed partition', () => {
    const keyless = { ...t(), check: { publish: [{ topic: 'events', value: 'x' }] } } as BrokerTask;
    expect(lintBrokerTask(keyless, course.scenarios)[0]).toContain('без ключа');
    const rabbitItem = { ...t(), check: { publish: [{ exchange: 'x', routingKey: 'y', body: 'z', mandatory: true }] } } as BrokerTask;
    expect(lintBrokerTask(rabbitItem, course.scenarios)[0]).toContain('относится к RabbitMQ');
  });
});

describe('kafka console', () => {
  const t = () => task('kx-console');

  it('compares the records of the partitions and the committed offsets of groups', () => {
    const produce = `kafka-console-producer.sh ${BS} --topic jobs <<EOF\none\ntwo\nEOF`;
    const noRead = check(t(), { commands: [produce], props: '' });
    expect(noRead.passed).toBe(false);
    expect(noRead.problems).toContain('Нет закоммиченного смещения «группа g1, jobs-0»');
    const oneOnly = check(t(), { commands: [`kafka-console-producer.sh ${BS} --topic jobs <<EOF\none\nEOF`], props: '' });
    expect(oneOnly.problems.some((p) => p.startsWith('Раздел «jobs-0»: ожидается «one», «two»'))).toBe(true);
  });

  it('require patterns are checked against successful commands', () => {
    const r = check(t(), { commands: [`kafka-topics.sh ${BS} --list`], props: '' });
    expect(r.problems).toContain('Запишите сообщения kafka-console-producer');
  });
});

describe('kafka scenario', () => {
  it('invariants of the scenario decide; the explanation names the duplicated record', () => {
    const t = task('kx-scenario');
    const r = check(t, starter(t));
    expect(r.passed).toBe(false);
    expect(r.problems.length).toBeGreaterThan(1);
    expect(check(t, solution(t)).passed).toBe(true);
  });

  it('is deterministic and fast', () => {
    const t = task('kx-scenario');
    const t0 = performance.now();
    const a = check(t, starter(t));
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(check(t, starter(t))).toEqual(a);
  });

  it('a broker crash scenario can be written with scenarioPatch and runs to its end', () => {
    const t = { ...task('kx-scenario'), scenarioPatch: { faults: [{ at: 1000, kind: 'broker.crash', broker: 1 }, { at: 8000, kind: 'broker.restart', broker: 1 }], expect: [{ kind: 'noLoss' }] } } as BrokerTask;
    expect(check(t, starter(t)).passed).toBe(true);
  });
});

describe('kafka theory examples', () => {
  it('run on the Kafka console and scenarios run to their end', () => {
    const lesson = course.worlds[0].lessons[0];
    const blocks = theoryExampleBlocks(lesson.theory);
    expect(blocks.map((b) => b.lang)).toEqual(['broker', 'scenario']);
    expect(checkBrokerExamples(blocks, lesson.exampleSetup, 'kafka')).toEqual([]);
  });

  it('a failing command and an unreadable scenario are reported', () => {
    const bad = checkBrokerExamples([{ lang: 'broker', code: `kafka-topics.sh ${BS} --describe --topic nope` }, { lang: 'scenario', code: '{' }], '', 'kafka');
    expect(bad.length).toBe(2);
    expect(bad[0]).toContain('завершилась с ошибкой');
  });

  it('the sandbox is a Kafka cluster with its console', () => {
    const box = createKafkaSandbox();
    const out = box.run(`kafka-topics.sh ${BS} --create --topic a --partitions 1`);
    expect(out[0].exit).toBe(0);
    expect(box.model.listTopics()).toEqual(['a']);
  });
});
