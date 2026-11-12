import type { BrokerTask } from '@/content/loadCourse';
import { replayOps, type ClientSetup } from '@/engine/python/brokerBridge';
import type { ClientRun, PythonError } from '@/engine/python/runtime';
import type { RuleRegistry } from '@/engine/sim/rules';
import { explainFailure } from '@/engine/sim/explain';
import { evaluate } from '@/engine/sim/invariants';
import { kafkaRules } from '@/engine/sim/kafka';
import { rabbitRules } from '@/engine/sim/rabbit';
import { createKafkaSandbox, createRabbitSandbox, createSandbox, splitScript, type AnySandbox, type CommandRecord, type KafkaSandbox, type RabbitSandbox, type Sandbox } from '@/engine/sim/sandbox';
import { applyProperties, parseScenario, type Scenario } from '@/engine/sim/scenario';
import type { Flavor } from '@/engine/sim/types';
import { captureKafka, compareKafka, kafkaCompare, lintKafkaPublications, type KafkaCaptured } from './brokerKafka';
import { SolutionError, type CheckResult } from './index';

const rules: RuleRegistry = rabbitRules;
const rulesOf = (sim: Flavor): RuleRegistry => (sim === 'kafka' ? kafkaRules : rabbitRules);

/** What the learner did: console commands (each entry is one typed chunk, a heredoc stays whole) and the properties text. */
export interface BrokerInput {
  commands: string[];
  props: string;
}

const fail = (problems: string[], trace?: string[]): CheckResult => ({ passed: false, problems, ...(trace?.length ? { trace } : {}) });
const quote = (s: string) => `«${s}»`;
const show = (v: unknown) => (typeof v === 'string' ? quote(v) : JSON.stringify(v));

// ---------------------------------------------------------------- sandbox

export { createKafkaSandbox, createRabbitSandbox, createSandbox, replayOps, splitScript };
export type { AnySandbox, CommandRecord, KafkaSandbox, RabbitSandbox, Sandbox };

const firstFailure = (records: CommandRecord[]) => records.find((r) => r.exit !== 0);

/** Runs a script that must succeed (setup, reference solution); a failing line is a content bug. */
function runStrict(box: AnySandbox, taskId: string, what: string, script: string): void {
  const bad = firstFailure(box.run(script));
  if (bad) throw new SolutionError(`${taskId}: ${what} упал(а) на «${bad.line}»:\n${bad.output}`);
}

interface Prepared {
  box: AnySandbox;
  scenario?: Scenario;
  /** Mistakes in the properties text. */
  propErrors: string[];
}

/** Scenario of the task (with its patch and the properties applied), a broker with the setup scripts run. */
function prepare(task: BrokerTask, scenarios: Record<string, Scenario>, props: string): Prepared {
  const base = task.scenario ? scenarios[task.scenario] : undefined;
  if (task.scenario && !base) throw new SolutionError(`${task.id}: нет сценария «${task.scenario}»`);
  let scenario: Scenario | undefined;
  let propErrors: string[] = [];
  if (base) {
    try {
      scenario = parseScenario({ ...base, ...(task.scenarioPatch ?? {}) });
    } catch (e) {
      throw new SolutionError(`${task.id}: scenarioPatch не подходит к сценарию: ${(e as Error).message}`);
    }
    const applied = applyProperties(scenario, props.split(/\r?\n/));
    scenario = applied.scenario;
    propErrors = applied.errors;
  } else if (props.split(/\r?\n/).some((l) => l.trim() !== '' && !l.trim().startsWith('#'))) {
    propErrors = ['В этом задании нет сценария, поэтому свойства ни к чему не применяются'];
  }
  const box = createSandbox(task.sim, scenario);
  if (scenario) runStrict(box, task.id, 'setup сценария', scenario.setup);
  runStrict(box, task.id, 'brokerSetup', task.brokerSetup);
  return { box, scenario, propErrors };
}

// ---------------------------------------------------------------- state

type Attrs = Record<string, unknown>;
type Category = 'exchanges' | 'queues' | 'bindings' | 'vhosts' | 'users' | 'permissions';

/** The state of a broker that checks compare. */
interface Captured {
  entities: Record<Category, Map<string, Attrs>>;
  /** Ready bodies in delivery order (redelivered ones marked) and the unacked count per queue. */
  messages: Map<string, { ready: string[]; unacked: number }>;
  returned: string[];
  /** Mistakes of the check's own publications (e.g. an exchange that does not exist). */
  publishErrors: string[];
  /** Body of a published message -> its id, for journal paths. */
  published: Map<string, string>;
}

const qname = (vhost: string, name: string) => (vhost === '/' ? name : `${vhost}:${name}`);
const argsKey = (a: Record<string, unknown>) => (Object.keys(a).length ? JSON.stringify(Object.fromEntries(Object.entries(a).sort(([x], [y]) => (x < y ? -1 : 1)))) : '');
const redelivered = ' (повторно)';

function publishAll(task: BrokerTask, box: RabbitSandbox): Pick<Captured, 'returned' | 'publishErrors' | 'published'> {
  const out: Pick<Captured, 'returned' | 'publishErrors' | 'published'> = { returned: [], publishErrors: [], published: new Map() };
  if (task.type !== 'routing') return out;
  const { model, sim } = box;
  const open = () => {
    const r = model.openChannel('guest', '/');
    if (!r.ok) throw new SolutionError(`${task.id}: не удалось открыть канал для проверки`);
    return r.value;
  };
  let ch = open();
  for (const item of task.check.publish) {
    if (!('body' in item)) continue; // Kafka publications are rejected earlier
    const before = sim.journal.entries().length;
    const r = model.publish(ch, { exchange: item.exchange, routingKey: item.routingKey, body: item.body, mandatory: item.mandatory, props: item.headers ? { headers: item.headers } : {} });
    if (!r.ok) {
      out.publishErrors.push(`Публикация ${quote(item.body)}: ${r.error.code} ${r.error.name} — ${r.error.text}`);
      ch = open();
      continue;
    }
    const entry = sim.journal.entries().slice(before).find((e) => e.kind === 'publish');
    if (entry?.msg) out.published.set(item.body, entry.msg);
  }
  sim.runUntil(sim.now);
  for (const x of model.takeReturns(ch)) out.returned.push(x.body);
  return out;
}

function capture(task: BrokerTask, box: RabbitSandbox): Captured {
  const extra = publishAll(task, box);
  const snap = box.model.snapshot();
  const entities: Captured['entities'] = {
    exchanges: new Map(),
    queues: new Map(),
    bindings: new Map(),
    vhosts: new Map(),
    users: new Map(),
    permissions: new Map(),
  };
  const messages: Captured['messages'] = new Map();
  for (const v of snap.vhosts) {
    entities.vhosts.set(v.name, {});
    for (const e of v.exchanges) {
      entities.exchanges.set(qname(v.name, e.name), { type: e.type, durable: e.durable, autoDelete: e.autoDelete, internal: e.internal, arguments: argsKey(e.arguments) });
    }
    for (const q of v.queues) {
      const key = qname(v.name, q.name);
      entities.queues.set(key, { type: q.type, durable: q.durable, autoDelete: q.autoDelete, exclusive: q.exclusive, arguments: argsKey(q.arguments) });
      messages.set(key, { ready: q.head.map((m) => (m.redelivered ? `${m.body}${redelivered}` : m.body)), unacked: q.unacked });
    }
    for (const b of v.bindings) {
      const where = `${b.source === '' ? '(по умолчанию)' : qname(v.name, b.source)} → ${b.destinationType === 'exchange' ? 'exchange ' : ''}${qname(v.name, b.destination)} по ключу ${quote(b.routingKey)}`;
      entities.bindings.set(`${where}${argsKey(b.arguments) ? ` ${argsKey(b.arguments)}` : ''}`, {});
    }
  }
  for (const u of snap.users) entities.users.set(u.name, { tags: u.tags.slice().sort().join(',') });
  for (const p of snap.permissions) entities.permissions.set(`${p.user} в ${p.vhost}`, { configure: p.configure, write: p.write, read: p.read });
  return { entities, messages, ...extra };
}

// ---------------------------------------------------------------- comparison

const NOUN: Record<Category, { name: string; missing: string; extra: string }> = {
  exchanges: { name: 'Exchange', missing: 'Нет exchange', extra: 'Лишний exchange' },
  queues: { name: 'Очередь', missing: 'Нет очереди', extra: 'Лишняя очередь' },
  bindings: { name: 'Привязка', missing: 'Нет привязки', extra: 'Лишняя привязка' },
  vhosts: { name: 'Vhost', missing: 'Нет vhost', extra: 'Лишний vhost' },
  users: { name: 'Пользователь', missing: 'Нет пользователя', extra: 'Лишний пользователь' },
  permissions: { name: 'Права', missing: 'Нет прав', extra: 'Лишние права' },
};
const CATEGORIES = Object.keys(NOUN) as Category[];
/** The default exchange and the amq.* ones exist in every broker. */
const builtin = (key: string) => key === '' || key.startsWith('amq.');

function diffEntities(cat: Category, want: Map<string, Attrs>, got: Map<string, Attrs>, ignore: Set<string>): string[] {
  const n = NOUN[cat];
  const problems: string[] = [];
  for (const [key, w] of want) {
    const g = got.get(key);
    if (!g) {
      if (!builtin(key)) problems.push(`${n.missing} ${quote(key)}`);
      continue;
    }
    for (const attr of Object.keys(w)) {
      if (ignore.has(attr) || w[attr] === g[attr]) continue;
      const rule = cat === 'exchanges' && attr === 'type' && typeof w[attr] === 'string' ? rules[w[attr] as string]?.ru : undefined;
      problems.push(`${n.name} ${quote(key)}: ${attr} — ожидается ${show(w[attr])}, у вас ${show(g[attr])}${rule ? ` [правило: ${rule}]` : ''}`);
    }
  }
  for (const key of got.keys()) if (!want.has(key) && !builtin(key)) problems.push(`${n.extra} ${quote(key)}`);
  return problems;
}

const list = (xs: string[]) => (xs.length ? xs.map(quote).join(', ') : 'пусто');

function diffMessages(want: Captured, got: Captured, task: BrokerTask, learner: RabbitSandbox, withUnacked: boolean): { problems: string[]; trace: string[] } {
  const problems: string[] = [];
  const trace: string[] = [];
  const lost: string[] = [];
  for (const [name, w] of want.messages) {
    const g = got.messages.get(name);
    if (!g) {
      // a missing queue is reported by the topology part; routing tasks compare contents only
      if (task.type === 'routing') problems.push(`Нет очереди ${quote(name)}`);
      continue;
    }
    if (w.ready.join('\n') !== g.ready.join('\n')) {
      problems.push(`Очередь ${quote(name)}: ожидается ${list(w.ready)}, у вас ${list(g.ready)}`);
      lost.push(...w.ready.filter((b) => !g.ready.includes(b)), ...g.ready.filter((b) => !w.ready.includes(b)));
    }
    if (withUnacked && w.unacked !== g.unacked) problems.push(`Очередь ${quote(name)}: без подтверждения ожидается ${w.unacked}, у вас ${g.unacked}`);
  }
  for (const [name, g] of got.messages) {
    if (!want.messages.has(name) && g.ready.length > 0 && task.type === 'routing') problems.push(`Очередь ${quote(name)}: лишние сообщения ${list(g.ready)}`);
  }
  if (task.type === 'routing') {
    if (want.returned.join('\n') !== got.returned.join('\n')) {
      problems.push(`Вернулись издателю (нет маршрута, флаг mandatory): ожидается ${list(want.returned)}, у вас ${list(got.returned)}`);
      lost.push(...want.returned.filter((b) => !got.returned.includes(b)), ...got.returned.filter((b) => !want.returned.includes(b)));
    }
  }
  // Where the learner's broker sent the messages that differ: the journal path with the rule texts.
  for (const body of [...new Set(lost.map((b) => b.replace(redelivered, '')))].slice(0, 2)) {
    const msg = got.published.get(body);
    if (!msg) continue;
    const lines = explainFailure({ ok: false, text: `Сообщение ${quote(body)}`, evidence: [msg] }, learner.sim.journal, rules);
    problems.push(...lines.slice(1).map((l) => `Путь сообщения у вас — ${l}`));
    trace.push(...lines.slice(1));
  }
  return { problems, trace };
}

function compareStates(task: BrokerTask, categories: Set<string>, ignore: string[], want: Captured, got: Captured, learner: RabbitSandbox): { problems: string[]; trace: string[] } {
  const skip = new Set(ignore);
  const problems: string[] = [];
  for (const cat of CATEGORIES) {
    if (categories.has(cat)) problems.push(...diffEntities(cat, want.entities[cat], got.entities[cat], skip));
  }
  let trace: string[] = [];
  if (task.type === 'routing' || categories.has('messages')) {
    const m = diffMessages(want, got, task, learner, task.type !== 'routing');
    problems.push(...m.problems);
    trace = m.trace;
  }
  if (task.type === 'routing') problems.push(...got.publishErrors.filter((e) => !want.publishErrors.includes(e)));
  return { problems, trace };
}

// ---------------------------------------------------------------- tasks

/** Commands of a console task: every `require` pattern must match a successful command, no `forbid` pattern any command. */
function checkCommands(task: Extract<BrokerTask, { type: 'console' }>, records: CommandRecord[]): string[] {
  const problems: string[] = [];
  for (const rule of task.check.require) {
    const re = new RegExp(rule.pattern);
    if (!records.some((r) => r.exit === 0 && re.test(r.line))) problems.push(rule.message);
  }
  for (const rule of task.check.forbid) {
    const re = new RegExp(rule.pattern);
    if (records.some((r) => re.test(r.line))) problems.push(rule.message);
  }
  return problems;
}

function checkScenario(task: BrokerTask, prep: Prepared): { problems: string[]; trace: string[] } {
  const { box, scenario } = prep;
  const problems: string[] = [];
  const trace: string[] = [];
  if (!scenario) throw new SolutionError(`${task.id}: у задания scenario нет сценария`);
  const stats = box.sim.runUntil(Math.max(scenario.durationMs, box.sim.now));
  if (stats.stoppedBy === 'horizon' || stats.stoppedBy === 'maxEvents') {
    const why = stats.stoppedBy === 'maxEvents' ? 'слишком много событий' : 'вышло виртуальное время';
    problems.push(`Симуляция остановлена на пределе (${why}): проверьте, нет ли бесконечного повтора`);
  }
  for (const inv of scenario.expect) {
    const r = evaluate(inv, box.sim);
    if (r.ok) continue;
    const lines = explainFailure(r, box.sim.journal, rulesOf(task.sim));
    problems.push(...lines);
    trace.push(...lines.slice(1));
  }
  return { problems, trace };
}

/** Plain-data states of finished reference runs; a task's reference does not change between checks. */
const references = new WeakMap<BrokerTask, Captured | KafkaCaptured>();

function reference(task: BrokerTask, scenarios: Record<string, Scenario>): Captured | KafkaCaptured {
  let ref = references.get(task);
  if (!ref) {
    const prep = prepare(task, scenarios, task.propsSolution);
    if (prep.propErrors.length) throw new SolutionError(`${task.id}: propsSolution: ${prep.propErrors.join('; ')}`);
    runStrict(prep.box, task.id, 'эталонное решение', task.brokerSolution);
    ref = task.sim === 'kafka' ? captureKafka(task, prep.box as KafkaSandbox) : capture(task, prep.box as RabbitSandbox);
    references.set(task, ref);
  }
  return ref;
}

/** What the learner's broker holds compared with the reference state, by the categories the task names. */
function diffAgainst(task: BrokerTask, want: Captured | KafkaCaptured, box: AnySandbox): { problems: string[]; trace: string[] } {
  const compare: readonly string[] = 'compare' in task.check ? task.check.compare : [];
  return task.sim === 'kafka'
    ? compareKafka(task, kafkaCompare(compare), task.check.ignore, want as KafkaCaptured, captureKafka(task, box as KafkaSandbox), box as KafkaSandbox)
    : compareStates(task, new Set(compare), task.check.ignore, want as Captured, capture(task, box as RabbitSandbox), box as RabbitSandbox);
}

/**
 * Checks a broker task. Topology, routing and console tasks compare the learner's broker (setup + typed
 * commands) with the reference one (setup + solution) on a fresh simulator; a scenario task runs the
 * scenario with the learner's commands and properties and evaluates its `expect` list. A failed check
 * explains itself: differences by name, then the journal path of the first message that went wrong with
 * the texts of the rules involved (`problems`; `trace` holds only the path lines).
 */
export function checkBrokerTask(task: BrokerTask, scenarios: Record<string, Scenario>, input: BrokerInput): CheckResult {
  if (task.type === 'client') throw new Error(`${task.id}: задание-клиент проверяет checkClientTask`);
  const prep = prepare(task, scenarios, input.props);
  const records = input.commands.flatMap((c) => prep.box.run(c));
  const complaints = prep.propErrors;
  let problems: string[];
  let trace: string[] = [];
  if (task.type === 'scenario') {
    ({ problems, trace } = checkScenario(task, prep));
  } else {
    prep.box.sim.runUntil(prep.box.sim.now);
    problems = [];
    if (task.type === 'console') problems.push(...checkCommands(task, records));
    if (task.type !== 'console' || task.check.compare.length > 0) {
      const d = diffAgainst(task, reference(task, scenarios), prep.box);
      problems.push(...d.problems);
      trace = d.trace;
    }
  }
  if (problems.length === 0 && complaints.length === 0) return { passed: true, problems: [] };
  const failed = records.filter((r) => r.exit !== 0).slice(0, 3);
  const hints = failed.map((r) => `Команда ${quote(r.line)} завершилась с ошибкой: ${r.output.split('\n')[0]}`);
  return fail([...complaints, ...problems, ...(problems.length > 0 ? hints : [])], trace);
}

// ---------------------------------------------------------------- Python clients

/** Runs a Python client against a fresh simulator described by `setup` (the app's Python worker; Node in tests). */
export type ClientRunner = (source: string, setup: ClientSetup) => Promise<ClientRun>;

type ClientTask = BrokerTask & { type: 'client' };

const clientSetup = (task: BrokerTask, prep: Prepared): ClientSetup => ({
  flavor: task.sim,
  ...(prep.scenario ? { scenario: prep.scenario } : {}),
  scripts: [prep.scenario?.setup ?? '', task.brokerSetup].filter((s) => s.trim() !== ''),
});

const programError = (e: PythonError): string =>
  `${e.kind === 'syntax' ? 'Синтаксическая ошибка' : 'Ошибка в программе'}: ${e.kind === 'syntax' ? e.message : `${e.type}: ${e.message}`}${e.line ? ` (строка ${e.line})` : ''}`;

/** Runs the client, then repeats its operations on the prepared simulator; the two must agree. */
async function runClient(task: BrokerTask, prep: Prepared, source: string, run: ClientRunner): Promise<ClientRun> {
  const result = await run(source, clientSetup(task, prep));
  if (!result.error) {
    const mismatch = replayOps(prep.box, result.ops);
    if (mismatch) throw new Error(`${task.id}: внутренняя ошибка. ${mismatch}`);
    prep.box.sim.runUntil(prep.box.sim.now);
  }
  return result;
}

const clientReferences = new WeakMap<BrokerTask, Promise<Captured | KafkaCaptured>>();

function clientReference(task: BrokerTask, scenarios: Record<string, Scenario>, run: ClientRunner): Promise<Captured | KafkaCaptured> {
  let ref = clientReferences.get(task);
  if (!ref) {
    ref = (async () => {
      const prep = prepare(task, scenarios, '');
      const result = await runClient(task, prep, (task as ClientTask).pythonSolution, run);
      if (result.error) throw new SolutionError(`${task.id}: эталонное решение: ${programError(result.error)}`);
      return task.sim === 'kafka' ? captureKafka(task, prep.box as KafkaSandbox) : capture(task, prep.box as RabbitSandbox);
    })();
    clientReferences.set(task, ref);
    ref.catch(() => clientReferences.delete(task));
  }
  return ref;
}

/**
 * Checks a `client` task: the learner's Python program runs against a fresh simulator (setup + scenario), its operations
 * are repeated on the checker's own simulator, then `require` / `forbid` (regular expressions over the source), the
 * comparison with the reference program's result and the scenario's `expect` list are applied.
 */
export async function checkClientTask(task: BrokerTask, scenarios: Record<string, Scenario>, source: string, run: ClientRunner): Promise<CheckResult> {
  if (task.type !== 'client') throw new Error(`${task.id}: это не задание-клиент`);
  const prep = prepare(task, scenarios, '');
  const problems: string[] = [];
  for (const rule of task.check.require) if (!new RegExp(rule.pattern, 'm').test(source)) problems.push(rule.message);
  for (const rule of task.check.forbid) if (new RegExp(rule.pattern, 'm').test(source)) problems.push(rule.message);
  const result = await runClient(task, prep, source, run);
  if (result.error) return fail([programError(result.error), ...problems]);
  let trace: string[] = [];
  if (task.check.compare.length > 0) {
    const d = diffAgainst(task, await clientReference(task, scenarios, run), prep.box);
    problems.push(...d.problems);
    trace = d.trace;
  }
  if (task.scenario) {
    const s = checkScenario(task, prep);
    problems.push(...s.problems);
    trace = [...trace, ...s.trace];
  }
  return problems.length === 0 ? { passed: true, problems: [] } : fail(problems, trace);
}

const RABBIT_COMPARE = new Set(['exchanges', 'queues', 'bindings', 'vhosts', 'users', 'permissions']);
const DEFAULT_COMPARE = 'exchanges,queues,bindings';

/** Content lint for a broker task (run by validate:content): reference runs, no empty topic keys, simulator fits. */
export function lintBrokerTask(task: BrokerTask, scenarios: Record<string, Scenario>): string[] {
  const problems: string[] = [];
  if (task.type === 'routing') {
    const prep = prepare(task, scenarios, task.propsSolution);
    runStrict(prep.box, task.id, 'эталонное решение', task.brokerSolution);
    if (task.sim === 'kafka') {
      problems.push(...lintKafkaPublications(task, prep.box as KafkaSandbox));
    } else {
      const exchanges = new Map((prep.box as RabbitSandbox).model.snapshot().vhosts.flatMap((v) => v.exchanges.map((e) => [e.name, e.type] as const)));
      for (const item of task.check.publish) {
        if (!('body' in item)) problems.push(`${task.id}: публикация topic/key/value относится к Kafka, а симулятор rabbit`);
        else if (exchanges.get(item.exchange) === 'topic' && item.routingKey === '') problems.push(`${task.id}: пустой ключ маршрутизации в topic-exchange «${item.exchange}» (в документации не описан)`);
      }
    }
  }
  if ('compare' in task.check) {
    const compare = task.check.compare;
    if (task.sim === 'kafka') {
      // The schema default (exchanges, queues, bindings) of an unset list stands for topics + configs here.
      const rabbitOnly = compare.filter((c) => RABBIT_COMPARE.has(c));
      if (rabbitOnly.length && compare.join(',') !== DEFAULT_COMPARE) problems.push(`${task.id}: compare ${rabbitOnly.join(', ')} бывает только у RabbitMQ`);
    } else {
      const kafkaOnly = compare.filter((c) => c === 'topics' || c === 'configs' || c === 'offsets');
      if (kafkaOnly.length) problems.push(`${task.id}: compare ${kafkaOnly.join(', ')} бывает только у Kafka`);
    }
  }
  return problems;
}

/**
 * Theory examples of a lesson: `broker` blocks run in order on one broker (after `setup`), every command must
 * exit 0; `scenario` blocks are whole scenarios that must run to the end without hitting the simulator's limits.
 */
export function checkBrokerExamples(blocks: { lang: string; code: string; shown?: string }[], setup: string, flavor: Flavor): string[] {
  const problems: string[] = [];
  const shared = createSandbox(flavor);
  const bad = firstFailure(shared.run(setup));
  if (bad) return [`setup примеров упал на «${bad.line}»: ${bad.output}`];
  for (const { lang, code, shown } of blocks) {
    if (lang === 'broker') {
      const records = shared.run(code);
      // The output printed in the lesson right after the example must be what the sandbox really prints.
      // An example that shows its exact output may demonstrate an error; one without shown output must succeed.
      const norm = (s: string) => s.split('\n').map((l) => l.trimEnd()).filter((l) => l !== '').join('\n');
      const actual = norm(records.map((r) => r.output).join('\n'));
      const matches = shown !== undefined && norm(shown) === actual;
      if (!matches) for (const r of records) if (r.exit !== 0) problems.push(`Команда примера «${r.line}» завершилась с ошибкой: ${r.output}`);
      if (shown !== undefined && !matches) problems.push(`Вывод в тексте после примера «${records[0]?.line ?? ''}» не совпадает с песочницей. Настоящий вывод:\n${actual}`);
    } else if (lang === 'scenario') {
      let scenario: Scenario;
      try {
        scenario = parseScenario(JSON.parse(code));
      } catch (e) {
        problems.push(`Сценарий-пример не читается: ${(e as Error).message}`);
        continue;
      }
      const box = createSandbox(scenario.sim, scenario);
      const failedSetup = firstFailure(box.run(scenario.setup));
      if (failedSetup) {
        problems.push(`Сценарий-пример: setup упал на «${failedSetup.line}»: ${failedSetup.output}`);
        continue;
      }
      box.sim.runUntil(scenario.durationMs);
      const entries = box.sim.journal.entries();
      const limit = entries.find((e) => e.kind === 'sim.limit');
      if (limit) problems.push(`Сценарий-пример: ${limit.text}`);
      for (const e of entries.filter((x) => x.kind === 'error').slice(0, 3)) problems.push(`Сценарий-пример: ошибка модели — ${e.text}`);
    }
  }
  return problems;
}
