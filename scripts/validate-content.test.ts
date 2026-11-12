// Content QA: every task's reference solution must pass its own check on a fresh sandbox, and the
// starting state (SQL starter code, or the Git setup alone) must not. Theory examples must run.
// Run with `npm run validate:content`.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createChecker } from '@/checker';
import { checkApiTask, readCorsConfig, readRequest } from '@/checker/api';
import { checkGraphql, checkProto } from '@/checker/apiSchema';
import { checkBrokerExamples, checkBrokerTask, checkClientTask, lintBrokerTask, type ClientRunner } from '@/checker/broker';
import { schemaOps } from '@/engine/api/schemaOps';
import { checkFastapi } from '@/checker/fastapi';
import { splitPythonExample } from '@/engine/python/example';
import { nodePython } from './pyodide/node';
import { HttpSimServer, sendTo, splitRequests, type ServerDef } from '@/engine/api/server';
import { createGitChecker, runReference, stoppedOnConflict } from '@/checker/git';
import { parseRequest } from '@/engine/api/http';
import { loadCatalog, type Catalog } from '@/content/catalog';
import type { BrokerTask, Task } from '@/content/loadCourse';
import type { Scenario } from '@/engine/sim/scenario';
import { theoryExampleBlocks, theoryExamples, theoryExamplesWithShownOutput } from '@/content/theory';
import { GitSandboxEngine } from '@/engine/git/GitSandboxEngine';
import { splitCommands } from '@/engine/git/shell';
import { PostgresEngine } from '@/engine/postgres/PostgresEngine';


function readTree(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files[`/${relative(process.cwd(), path).replaceAll('\\', '/')}`] = readFileSync(path, 'utf8');
  }
  return files;
}

const engine = new PostgresEngine();
const checker = createChecker(engine);
const gitChecker = createGitChecker();

beforeAll(() => engine.init());
afterAll(() => engine.dispose());

async function validateTask(task: Task, servers: Record<string, ServerDef>, scenarios: Record<string, Scenario> = {}) {
  if (task.type === 'drill') return; // drill tasks are checked in validate-drill.test.ts
  if (task.type === 'choice' || task.type === 'review') {
    expect((await checker.check(task, { kind: 'choice', selected: task.answer })).passed).toBe(true);
    const wrong = task.options.map((_, i) => i).filter((i) => !task.answer.includes(i));
    expect((await checker.check(task, { kind: 'choice', selected: wrong })).passed).toBe(false);
    return;
  }
  if ('brokerSolution' in task) {
    const broker = task as BrokerTask;
    expect(lintBrokerTask(broker, scenarios), 'content lint').toEqual([]);
    if (broker.type === 'client') {
      const { client } = await nodePython();
      const run: ClientRunner = async (source, setup) => client(source, setup);
      expect((await checkClientTask(broker, scenarios, broker.pythonSolution, run)).problems, 'reference must pass its own check').toEqual([]);
      expect((await checkClientTask(broker, scenarios, broker.pythonStarter, run)).passed, 'the starter must not pass the check').toBe(false);
      return;
    }
    const started = performance.now();
    const solved = checkBrokerTask(broker, scenarios, { commands: [broker.brokerSolution], props: broker.propsSolution });
    expect(solved.problems, 'reference must pass its own check').toEqual([]);
    expect(performance.now() - started, 'a broker check must stay fast (budget 300 ms; 1 s here for slow machines)').toBeLessThan(1000);
    const untouched = checkBrokerTask(broker, scenarios, { commands: [broker.brokerStarter], props: broker.propsStarter });
    expect(untouched.passed, 'the starter must not pass the check').toBe(false);
    if (broker.type === 'topology' || broker.type === 'console') {
      expect(checkBrokerTask(broker, scenarios, { commands: [], props: '' }).passed, 'empty input must not pass the check').toBe(false);
    }
    return;
  }
  if (task.type === 'fastapi') {
    const { run } = await nodePython();
    expect((await checkFastapi(task, task.pythonSolution, run)).problems, 'reference must pass its own check').toEqual([]);
    expect((await checkFastapi(task, task.pythonStarter, run)).passed, 'the starter must not pass the check').toBe(false);
    return;
  }
  if (task.type === 'graphql') {
    const server = task.server ? servers[task.server] : undefined;
    expect(checkGraphql(task, server, { query: task.graphqlSolution, variables: task.variables }).problems, 'reference must pass its own check').toEqual([]);
    expect(checkGraphql(task, server, { query: task.graphqlStarter, variables: task.variables }).passed, 'the starter must not pass the check').toBe(false);
    return;
  }
  if (task.type === 'proto') {
    expect(checkProto(task, task.protoSolution).problems, 'reference must pass its own check').toEqual([]);
    expect(checkProto(task, task.protoStarter).passed, 'the starter must not pass the check').toBe(false);
    return;
  }
  if ('httpSolution' in task) {
    const cors = (text: string) => (task.type === 'cors' ? readCorsConfig(text) : null);
    const solved = checkApiTask(task, servers, { draft: parseRequest(task.httpSolution), cors: cors(task.type === 'cors' ? task.jsonSolution : '') });
    expect(solved.problems, 'reference must pass its own check').toEqual([]);
    const starter = readRequest(task.httpStarter);
    const untouched = 'method' in starter ? checkApiTask(task, servers, { draft: starter, cors: cors(task.type === 'cors' ? task.jsonStarter : '') }) : starter;
    expect(untouched.passed, 'the starter must not pass the check').toBe(false);
    return;
  }
  if ('shellSolution' in task) {
    const reference = runReference(task);
    const solved = gitChecker.check(task, reference.world, reference.commands);
    expect(solved.problems, 'reference solution must pass its own check').toEqual([]);
    const untouched = new GitSandboxEngine();
    untouched.reset(task.shellSetup);
    expect(gitChecker.check(task, untouched.world, []).passed, 'the setup alone must not pass the check').toBe(false);
    return;
  }
  const solved = await checker.check(task, { kind: 'sql', code: task.solution });
  expect(solved.error, 'reference solution raised an SQL error').toBeUndefined();
  expect(solved.problems, 'reference solution must pass its own check').toEqual([]);
  const untouched = await checker.check(task, { kind: 'sql', code: task.starter });
  expect(untouched.passed, 'starter code must not pass the check').toBe(false);
}

let catalog: Catalog | undefined;
let loadError: unknown;
try {
  catalog = loadCatalog(readTree('courses'), '/courses');
} catch (e) {
  loadError = e;
}

it('all courses load without structural problems', () => {
  if (loadError) throw loadError;
});

for (const course of catalog?.courses ?? []) {
  describe(`course ${course.id}`, () => {

    for (const world of course?.worlds ?? []) {
      for (const lesson of world.lessons) {
        describe(`${world.id} › ${lesson.id}`, () => {
          const examples = theoryExamples(lesson.theory);
          if (examples.length > 0) {
            it('theory examples run in order without errors', async () => {
              if (course.engine === 'broker') {
                // Same rule as the lesson UI (brokerExamples.ts): the sim of the lesson's first practical task.
                const first = lesson.tasks.find((t) => 'brokerSolution' in t) as BrokerTask | undefined;
                const flavor = first?.sim ?? course.flavor ?? 'rabbit';
                expect(checkBrokerExamples(theoryExamplesWithShownOutput(lesson.theory), lesson.exampleSetup, flavor), 'theory examples').toEqual([]);
                return;
              }
              if (course.engine === 'api') {
                const def = lesson.exampleServer ? course.servers[lesson.exampleServer] : undefined;
                expect(def, 'http examples need a server (a task of the lesson with "server")').toBeDefined();
                const server = new HttpSimServer(def!);
                let collections = structuredClone(def!.collections ?? {});
                for (const { lang, code } of theoryExampleBlocks(lesson.theory)) {
                  if (lang === 'graphql') {
                    expect(def!.graphql, 'graphql examples need a server with graphqlFile').toBeDefined();
                    const out = schemaOps.graphql(def!.graphql!, collections, code, {});
                    collections = out.collections;
                    expect(out.explained, `example failed:
${code}`).toEqual([]);
                  } else if (lang === 'python') {
                    const { source, requests, crashes } = splitPythonExample(code);
                    const out = await (await nodePython()).run(source, requests);
                    const failed = out.load.ok
                      ? out.responses.flatMap((r, i) => (Boolean(r.error) !== crashes[i] ? [`request ${i + 1}: ${r.error ? `${r.error.type}: ${r.error.message}` : 'expected a crash (### 500)'}`] : []))
                      : [`${out.load.error.type}: ${out.load.error.message}`];
                    expect(failed, `example failed: ${code}`).toEqual([]);
                  } else if (lang === 'proto') {
                    const out = schemaOps.protoExample(code, collections);
                    collections = out.collections;
                    expect([out.error, ...out.outputs.filter((o) => !o.ok).map((o) => `${o.line}: ${o.text}`)].filter(Boolean), `example failed:
${code}`).toEqual([]);
                  } else {
                    for (const text of splitRequests(code)) {
                      const res = sendTo(server, parseRequest(text));
                      expect(typeof res === 'string' ? res : null, `example failed:
${text}`).toBeNull();
                    }
                  }
                }
                return;
              }
              if (course.engine === 'git') {
                const sandbox = new GitSandboxEngine();
                sandbox.reset(lesson.exampleSetup);
                for (const command of examples.flatMap(splitCommands)) {
                  const result = command.includes('\n') ? sandbox.runScript(command) : sandbox.run(command);
                  const failed = ('exit' in result ? result.exit !== 0 : Boolean(result.failed)) && !stoppedOnConflict(sandbox.world, command);
                  const output = result.lines.map((l) => l.text).join('\n');
                  expect(failed, `example command failed: ${command}\n${output}`).toBe(false);
                }
                return;
              }
              await engine.reset(lesson.exampleSetup);
              for (const sql of examples) {
                const out = await engine.execute(sql);
                expect(out.error?.message, `example failed:
${sql}`).toBeUndefined();
              }
            });
          }
          for (const task of lesson.tasks) {
            it(`${task.id} (${task.type})`, () => validateTask(task, course.servers, course.scenarios));
          }
        });
      }
    }

    const extra = [...(course?.placement?.blocks.flatMap((b) => b.questions) ?? []), ...(course?.onboarding ? [course.onboarding.kind === 'sql' ? course.onboarding.firstQuery : course.onboarding.firstTask] : [])];
    if (extra.length) {
      describe('placement and onboarding', () => {
        for (const task of extra) {
          it(`${task.id} (${task.type})`, () => validateTask(task, course.servers, course.scenarios));
        }
      });
    }
  });
}
