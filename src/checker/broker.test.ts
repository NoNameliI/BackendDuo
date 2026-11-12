import { describe, expect, it } from 'vitest';
import { loadCatalog } from '@/content/catalog';
import { theoryExampleBlocks } from '@/content/theory';
import type { BrokerTask } from '@/content/loadCourse';
import { SolutionError } from './index';

import { checkBrokerExamples, checkBrokerTask, lintBrokerTask, splitScript, type BrokerInput } from './broker';
import { fixtureCourse, fixtureFiles, fixtureTask } from './brokerFixture';

const course = fixtureCourse();
const task = (id: string) => fixtureTask(course, id);
const solution = (t: BrokerTask): BrokerInput => ({ commands: [t.brokerSolution], props: t.propsSolution });
const starter = (t: BrokerTask): BrokerInput => ({ commands: [t.brokerStarter], props: t.propsStarter });
const check = (t: BrokerTask, input: BrokerInput) => checkBrokerTask(t, course.scenarios, input);

describe('fixture course', () => {
  it('loads with resolved simulators and the example setup', () => {
    expect(course.engine).toBe('broker');
    expect(course.flavor).toBe('rabbit');
    expect(Object.keys(course.scenarios)).toEqual(['orders']);
    const tasks = course.worlds[0].lessons[0].tasks;
    expect(tasks.map((t) => t.type)).toEqual(['topology', 'routing', 'console', 'scenario']);
    expect(tasks.every((t) => 'sim' in t && t.sim === 'rabbit')).toBe(true);
    expect(course.worlds[0].lessons[0].exampleSetup).toBe('');
    expect(theoryExampleBlocks(course.worlds[0].lessons[0].theory).map((b) => b.lang)).toEqual(['broker', 'scenario']);
    expect(task('fx-scenario').propsSolution).toBe('mailer.idempotent=true');
  });

  it('each task: the reference passes its check, the starter does not', () => {
    for (const id of ['fx-topology', 'fx-routing', 'fx-console', 'fx-scenario']) {
      const t = task(id);
      expect(check(t, solution(t)).problems, id).toEqual([]);
      const bad = check(t, starter(t));
      expect(bad.passed, id).toBe(false);
      expect(bad.problems.length, id).toBeGreaterThan(0);
    }
  });
});

describe('splitScript', () => {
  it('joins continuations, keeps heredocs whole, drops comments', () => {
    expect(splitScript('# c\na b \\\n  c\n\nx <<EOF\nline\nEOF\ny')).toEqual(['a b  c', 'x <<EOF\nline\nEOF', 'y']);
  });
});

describe('topology', () => {
  it('names what is missing, extra and different, with the rule for a wrong type', () => {
    const t = task('fx-topology');
    const r = check(t, {
      commands: [
        'rabbitmqadmin exchanges declare --name events --type topic --durable true',
        'rabbitmqadmin queues declare --name audit --type classic --durable true',
        'rabbitmqadmin queues declare --name extra --type classic --durable true',
        'rabbitmqadmin bindings declare --source events --destination-type queue --destination audit --routing-key ""',
      ],
      props: '',
    });
    const text = r.problems.join('\n');
    expect(r.passed).toBe(false);
    expect(text).toContain('Exchange «events»: type — ожидается «fanout», у вас «topic»');
    expect(text).toContain('[правило: fanout:');
    expect(text).toContain('Нет очереди «metrics»');
    expect(text).toContain('Лишняя очередь «extra»');
    expect(text).toContain('Нет привязки');
  });

  it('ignore skips attributes; failed commands are explained', () => {
    const t: BrokerTask = { ...task('fx-topology'), check: { compare: ['exchanges', 'queues', 'bindings'], ignore: ['durable'] } } as BrokerTask;
    const lines = t.brokerSolution.replaceAll('--durable true', '--durable true').split('\n');
    const ok = check(t, { commands: [lines.join('\n')], props: '' });
    expect(ok.passed).toBe(true);
    const bad = check(t, { commands: ['rabbitmqadmin queues declare --name audit --type classic --durable true', 'rabbitmqadmin queues declare --name audit --type classic --durable false'], props: '' });
    expect(bad.problems.join('\n')).toContain('PRECONDITION_FAILED');
  });
});

describe('routing', () => {
  it('compares where messages end up and explains the path of a misrouted one', () => {
    const t = task('fx-routing');
    const wrong = check(t, {
      commands: [
        'rabbitmqadmin bindings declare --source logs --destination-type queue --destination errors --routing-key "app.#"',
        'rabbitmqadmin bindings declare --source logs --destination-type queue --destination all --routing-key "app.#"',
      ],
      props: '',
    });
    expect(wrong.passed).toBe(false);
    const text = wrong.problems.join('\n');
    expect(text).toContain('Очередь «errors»: ожидается «disk», у вас «disk», «start»');
    expect(text).toContain('Путь сообщения у вас');
    expect(wrong.trace?.length).toBeGreaterThan(0);
    expect(text).toContain('правило');
  });

  it('a message nobody routes comes back to the publisher (mandatory)', () => {
    const t = task('fx-routing');
    expect(check(t, starter(t)).problems.join('\n')).toContain('Вернулись издателю');
  });
});

describe('console', () => {
  it('require needs a successful command, compare looks at queue contents', () => {
    const t = task('fx-console');
    const r = check(t, { commands: ['rabbitmqadmin publish message --routing-key jobs --payload two', 'rabbitmqadmin publish message --routing-key jobs --payload one'], props: '' });
    expect(r.passed).toBe(false);
    expect(r.problems.join('\n')).toContain('Очередь «jobs»: ожидается «one», «two», у вас «two», «one»');
    const noPublish = check(t, { commands: ['rabbitmqadmin queues list'], props: '' });
    expect(noPublish.problems).toContain('Опубликуйте сообщения командой publish message');
  });
});

describe('scenario', () => {
  it('explains a duplicate through the journal path', () => {
    const t = task('fx-scenario');
    const r = check(t, starter(t));
    expect(r.passed).toBe(false);
    expect(r.problems[0]).toContain('mailer: повторно обработано сообщений');
    expect(r.problems.join('\n')).toContain('redelivered');
    expect(r.trace?.length).toBe(1);
    expect(r.trace?.[0]).toMatch(/^\S+: /);
  });

  it('reports mistakes in the properties and applies the right ones', () => {
    const t = task('fx-scenario');
    const r = check(t, { commands: [], props: 'nobody.idempotent=true\nmailer.idempotent=true' });
    expect(r.passed).toBe(false);
    expect(r.problems[0]).toContain('Неизвестный участник nobody');
  });

  it('scenarioPatch replaces expect as a whole', () => {
    const t = { ...task('fx-scenario'), scenarioPatch: { expect: [{ kind: 'noLoss' }] } } as BrokerTask;
    expect(check(t, starter(t)).passed).toBe(true);
  });

  it('is deterministic and fast', () => {
    const t = task('fx-scenario');
    const t0 = performance.now();
    const a = check(t, starter(t));
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(check(t, starter(t))).toEqual(a);
  });
});

describe('kafka and lint', () => {
  it('the Kafka flavor is rejected with a clear problem', () => {
    const t = { ...task('fx-topology'), sim: 'kafka' } as BrokerTask;
    const r = check(t, solution(t));
    expect(r.passed).toBe(false);
    expect(r.problems[0]).toContain('Kafka пока недоступен');
    expect(lintBrokerTask(t, course.scenarios)[0]).toContain('Kafka пока недоступен');
    expect(checkBrokerExamples([], '', 'kafka')[0]).toContain('Kafka пока недоступен');
  });

  it('forbids an empty routing key on a topic exchange', () => {
    const t = task('fx-routing');
    expect(lintBrokerTask(t, course.scenarios)).toEqual([]);
    const empty = { ...t, check: { ...t.check, publish: [{ exchange: 'logs', routingKey: '', body: 'x', mandatory: true }] } } as BrokerTask;
    expect(lintBrokerTask(empty, course.scenarios)).toEqual(['fx-routing: пустой ключ маршрутизации в topic-exchange «logs» (в документации не описан)']);
  });

  it('a broken reference is a content bug', () => {
    const t = { ...task('fx-topology'), brokerSolution: 'rabbitmqadmin nonsense' } as BrokerTask;
    expect(() => check(t, solution(t))).toThrow(SolutionError);
  });
});

describe('theory examples', () => {
  const blocks = theoryExampleBlocks(course.worlds[0].lessons[0].theory);
  it('run without problems', () => {
    expect(checkBrokerExamples(blocks, '', 'rabbit')).toEqual([]);
  });
  it('report failing commands, bad scenarios and limits', () => {
    const bad = checkBrokerExamples(
      [
        { lang: 'broker', code: 'rabbitmqadmin queues declare --name q --type classic --durable false' },
        { lang: 'scenario', code: '{"sim":"rabbit"}' },
        { lang: 'scenario', code: JSON.stringify({ sim: 'rabbit', seed: 1, durationMs: 1000, setup: 'rabbitmqadmin queues declare --name q --type classic --durable true', actors: [], faults: [], expect: [] }) },
      ],
      '',
      'rabbit',
    );
    expect(bad).toHaveLength(2);
    expect(bad[0]).toContain('завершилась с ошибкой');
    expect(bad[1]).toContain('не читается');
  });
});

describe('catalog companions', () => {
  const platform = (courses: string[]) => ({
    '/courses/platform.json': JSON.stringify({ courses, levels: [{ xp: 0, title: 'A' }, { xp: 100, title: 'B' }] }),
  });
  const withCompanions = (companions: string[], companion = false) => {
    const files = fixtureFiles('/courses/fixture');
    const m = JSON.parse(files['/courses/fixture/manifest.json']);
    files['/courses/fixture/manifest.json'] = JSON.stringify({ ...m, companions, companion });
    return files;
  };

  it('requires companion links to point at companion courses that exist', () => {
    expect(() => loadCatalog({ ...withCompanions(['fixture']), ...platform(['fixture']) })).toThrow(/не помечен companion/);
    expect(() => loadCatalog({ ...withCompanions(['ghost']), ...platform(['fixture']) })).toThrow(/не найден/);
    expect(loadCatalog({ ...withCompanions([], true), ...platform(['fixture']) }).courses[0].companion).toBe(true);
  });

  it('a course without flavor must be a companion with a simulator on every task', () => {
    const files = fixtureFiles('/courses/fixture');
    const m = JSON.parse(files['/courses/fixture/manifest.json']);
    delete m.flavor;
    files['/courses/fixture/manifest.json'] = JSON.stringify(m);
    expect(() => loadCatalog({ ...files, ...platform(['fixture']) })).toThrow(/flavor/);
    files['/courses/fixture/manifest.json'] = JSON.stringify({ ...m, companion: true });
    expect(() => loadCatalog({ ...files, ...platform(['fixture']) })).toThrow(/не указан симулятор/);
  });
});
