import type { ApiTask } from '@/content/loadCourse';
import { declaredVariables, explainGraphqlError, GraphqlServer, selectedFields, type GraphqlResult } from '@/engine/api/graphqlRun';
import { parseProto, type ProtoSummary } from '@/engine/api/protoRun';
import type { ServerDef } from '@/engine/api/server';
import { SolutionError, type CheckResult } from './index';

export type GraphqlTask = Extract<ApiTask, { type: 'graphql' }>;
export type ProtoTask = Extract<ApiTask, { type: 'proto' }>;

export interface GraphqlInput {
  query: string;
  variables: Record<string, unknown>;
}

const verdict = (problems: string[]): CheckResult => ({ passed: problems.length === 0, problems });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A server for a GraphQL task: its schema over a fresh copy of the collections. */
export function graphqlServerOf(task: ApiTask, server: ServerDef | undefined): GraphqlServer {
  if (!server?.graphql) throw new SolutionError(`${task.id}: у сервера ${task.server ?? '(нет)'} нет GraphQL-схемы`);
  return new GraphqlServer(server.graphql, server.collections ?? {});
}

/**
 * Where `got` misses or changes what `want` has (extra fields in `got` are allowed here; over-fetching is
 * checked by the selected fields). Paths look like `products[1].category.title`.
 */
function missing(want: unknown, got: unknown, path: string, out: string[]): void {
  if (out.length >= 5) return;
  if (Array.isArray(want)) {
    if (!Array.isArray(got)) out.push(`${path}: ожидается список, а пришло ${JSON.stringify(got)}`);
    else if (want.length !== got.length) out.push(`${path}: ожидается элементов — ${want.length}, а пришло ${got.length}`);
    else want.forEach((w, i) => missing(w, got[i], `${path}[${i}]`, out));
    return;
  }
  if (want && typeof want === 'object') {
    if (!got || typeof got !== 'object') {
      out.push(`${path}: ожидается объект, а пришло ${JSON.stringify(got)}`);
      return;
    }
    for (const [key, value] of Object.entries(want)) {
      const at = path ? `${path}.${key}` : key;
      const absent = `Не запрошено поле «${at.replace(/\[\d+\]/g, '')}»`;
      if (!(key in got)) {
        if (!out.includes(absent)) out.push(absent);
      }
      else missing(value, (got as Record<string, unknown>)[key], at, out);
    }
    return;
  }
  if (!same(want, got)) out.push(`${path}: ожидается ${JSON.stringify(want)}, а пришло ${JSON.stringify(got)}`);
}

/** Errors of a GraphQL answer in Russian. */
export function graphqlProblems(result: GraphqlResult): string[] {
  return (result.errors ?? []).map((e) => explainGraphqlError(e.message));
}

/**
 * `graphql` task: the learner's query returns the reference data on a fresh server (and leaves the same
 * data behind for mutations); with `exactFields` it selects nothing beyond the reference.
 */
export function checkGraphql(task: GraphqlTask, server: ServerDef | undefined, input: GraphqlInput): CheckResult {
  const reference = graphqlServerOf(task, server);
  const want = reference.run(task.graphqlSolution, task.variables);
  if (want.errors?.length) throw new SolutionError(`${task.id}: эталонный запрос упал: ${want.errors[0].message}`);

  const learner = graphqlServerOf(task, server);
  const got = learner.run(input.query, input.variables);
  if (got.errors?.length) return verdict(graphqlProblems(got));

  const problems: string[] = [];
  // Variables of the task are the point of such a task: a value written into the query text does not count.
  const declared = declaredVariables(input.query);
  for (const name of Object.keys(task.variables)) {
    if (!declared.includes(name)) problems.push(`Запрос должен принимать переменную $${name}: объявите её в скобках после query или mutation и подставьте вместо значения`);
  }
  missing(want.data, got.data, '', problems);
  if (task.check.exactFields) {
    let selected: string[] = [];
    try {
      selected = selectedFields(input.query);
    } catch {
      /* already reported as a syntax error above */
    }
    const allowed = new Set(selectedFields(task.graphqlSolution));
    const extra = selected.filter((f) => !allowed.has(f));
    if (extra.length) problems.push(`Запрошено лишнее: ${extra.map((f) => `«${f}»`).join(', ')}. Клиенту нужны только поля из условия`);
  }
  for (const name of task.check.state) {
    if (!same(reference.collections[name] ?? [], learner.collections[name] ?? [])) problems.push(`Данные «${name}» на сервере после запроса отличаются от ожидаемых`);
  }
  return verdict(problems);
}

const shortName = (name: string) => name.split('.').at(-1)!;

function findMessage(summary: ProtoSummary, name: string) {
  return summary.messages.find((m) => m.name === name) ?? summary.messages.find((m) => shortName(m.name) === shortName(name));
}

/**
 * `proto` task: the learner's .proto has the reference's package, messages (fields with the same names,
 * types and, by default, numbers), enums and services; extra fields are mistakes, extra messages are not.
 */
export function checkProto(task: ProtoTask, source: string): CheckResult {
  const ref = parseProto(task.protoSolution);
  if (!ref.ok) throw new SolutionError(`${task.id}: эталонный .proto не читается: ${ref.error}`);
  const got = parseProto(source);
  if (!got.ok) return verdict([got.error]);
  const want = ref.summary;
  const have = got.summary;
  const problems: string[] = [];

  if (want.package !== have.package) problems.push(want.package ? `Нужен package ${want.package};` : `Пакет здесь не нужен: уберите package ${have.package};`);
  for (const message of want.messages) {
    const mine = findMessage(have, message.name);
    if (!mine) {
      problems.push(`Нет сообщения message ${shortName(message.name)}`);
      continue;
    }
    const label = shortName(message.name);
    for (const field of message.fields) {
      const f = mine.fields.find((x) => x.name === field.name);
      if (!f) problems.push(`В ${label} нет поля ${field.name}`);
      else if (f.type !== field.type && shortName(f.type) !== shortName(field.type)) problems.push(`${label}.${field.name}: тип ${field.type}, а у вас ${f.type}`);
      else if (f.repeated !== field.repeated) problems.push(`${label}.${field.name}: ${field.repeated ? 'это список — нужен repeated' : 'это одно значение — repeated не нужен'}`);
      else if (task.check.fieldNumbers && f.number !== field.number) problems.push(`${label}.${field.name}: номер поля ${field.number}, а у вас ${f.number}. Номер — это то, что уходит по сети вместо имени`);
    }
    for (const f of mine.fields) if (!message.fields.some((x) => x.name === f.name)) problems.push(`В ${label} лишнее поле ${f.name}`);
  }
  for (const e of want.enums) {
    const mine = have.enums.find((x) => shortName(x.name) === shortName(e.name));
    if (!mine) problems.push(`Нет перечисления enum ${shortName(e.name)}`);
    else if (!same(Object.entries(mine.values).sort(), Object.entries(e.values).sort())) problems.push(`enum ${shortName(e.name)}: ожидаются значения ${Object.entries(e.values).map(([k, v]) => `${k} = ${v}`).join(', ')}`);
  }
  for (const service of want.services) {
    const mine = have.services.find((s) => shortName(s.name) === shortName(service.name));
    if (!mine) {
      problems.push(`Нет сервиса service ${shortName(service.name)}`);
      continue;
    }
    for (const m of service.methods) {
      const rpc = mine.methods.find((x) => x.name === m.name);
      const sig = `rpc ${m.name} (${m.clientStream ? 'stream ' : ''}${shortName(m.request)}) returns (${m.serverStream ? 'stream ' : ''}${shortName(m.response)})`;
      if (!rpc) problems.push(`В ${shortName(service.name)} нет метода ${sig}`);
      else if (shortName(rpc.request) !== shortName(m.request) || shortName(rpc.response) !== shortName(m.response) || rpc.clientStream !== m.clientStream || rpc.serverStream !== m.serverStream) {
        problems.push(`Метод ${m.name}: ожидается ${sig}`);
      }
    }
  }
  return verdict(problems);
}
