import type { BrokerTask } from '@/content/loadCourse';
import { explainFailure } from '@/engine/sim/explain';
import { kafkaRules, TOPIC_CONFIGS, BROKER_CONFIGS } from '@/engine/sim/kafka';
import type { KafkaSandbox } from './broker';
import { SolutionError } from './index';

type Attrs = Record<string, unknown>;
export type KafkaCategory = 'topics' | 'configs' | 'offsets';
export const KAFKA_CATEGORIES: readonly string[] = ['topics', 'configs', 'offsets', 'messages'];

/** The state of a Kafka cluster that checks compare. */
export interface KafkaCaptured {
  entities: Record<KafkaCategory, Map<string, Attrs>>;
  /** `topic-partition` -> records in offset order, as `key: value` (or just the value). */
  messages: Map<string, string[]>;
  /** Mistakes of the check's own publications (e.g. a topic that does not exist). */
  publishErrors: string[];
  /** Label of a published record -> its journal id, for journal paths. */
  published: Map<string, string>;
}

const quote = (s: string) => `«${s}»`;
const show = (v: unknown) => (typeof v === 'string' ? quote(v) : JSON.stringify(v));
const list = (xs: string[]) => (xs.length ? xs.map(quote).join(', ') : 'пусто');
const label = (key: string | null | undefined, value: string | null | undefined) => {
  const v = value === null || value === undefined ? '∅' : value;
  return key === null || key === undefined || key === '' ? v : `${key}: ${v}`;
};

/** Publications of a routing task go through a fresh producer on the learner's cluster, one record at a time. */
function publishAll(task: BrokerTask, box: KafkaSandbox): Pick<KafkaCaptured, 'publishErrors' | 'published'> {
  const out: Pick<KafkaCaptured, 'publishErrors' | 'published'> = { publishErrors: [], published: new Map() };
  if (task.type !== 'routing') return out;
  for (const item of task.check.publish) {
    if (!('topic' in item)) continue; // Rabbit publications are rejected by the lint
    const what = `Публикация ${quote(label(item.key, item.value))} в ${quote(item.topic)}`;
    const r = box.model.produce(item.topic, [{ key: item.key ?? null, value: item.value }]);
    if (!r.ok) {
      out.publishErrors.push(`${what}: ${r.error.code} ${r.error.name} — ${r.error.text}`);
      continue;
    }
    for (const d of r.value) {
      if (d.error) out.publishErrors.push(`${what}: ${d.error.code} ${d.error.name} — ${d.error.text}`);
      else out.published.set(label(item.key, item.value), d.msg);
    }
  }
  box.sim.runUntil(box.sim.now);
  return out;
}

export function captureKafka(task: BrokerTask, box: KafkaSandbox): KafkaCaptured {
  const extra = publishAll(task, box);
  const m = box.model;
  const entities: KafkaCaptured['entities'] = { topics: new Map(), configs: new Map(), offsets: new Map() };
  const messages: KafkaCaptured['messages'] = new Map();
  for (const name of m.listTopics()) {
    const d = m.describeTopic(name);
    if (!d.ok) continue;
    entities.topics.set(name, { partitions: d.value.partitionCount, replicationFactor: d.value.replicationFactor });
    const conf = m.describeConfigs('topics', name, true);
    if (conf.ok) {
      // Only what differs from the Kafka default counts: an override equal to the default changes nothing.
      for (const c of conf.value) if (c.value !== TOPIC_CONFIGS[c.name]?.def) entities.configs.set(`топик ${name}: ${c.name}`, { value: c.value });
    }
    for (const p of d.value.partitions) {
      const log = m.partitionOf(name, p.partition)?.leaderLog;
      messages.set(`${name}-${p.partition}`, log ? log.all().map((r) => label(r.key, r.value)) : []);
    }
  }
  for (const scope of ['', '1', '2', '3']) {
    const conf = m.describeConfigs('brokers', scope, true);
    if (!conf.ok) continue;
    for (const c of conf.value) if (c.value !== BROKER_CONFIGS[c.name]?.def) entities.configs.set(`${scope === '' ? 'все брокеры' : `брокер ${scope}`}: ${c.name}`, { value: c.value });
  }
  for (const id of m.listGroups()) {
    const g = m.describeGroup(id);
    if (!g.ok) continue;
    for (const o of g.value.offsets) if (o.current !== null) entities.offsets.set(`группа ${id}, ${o.topic}-${o.partition}`, { offset: o.current });
  }
  return { entities, messages, ...extra };
}

const NOUN: Record<KafkaCategory, { name: string; missing: string; extra: string }> = {
  topics: { name: 'Топик', missing: 'Нет топика', extra: 'Лишний топик' },
  configs: { name: 'Настройка', missing: 'Нет настройки', extra: 'Лишняя настройка' },
  offsets: { name: 'Смещение', missing: 'Нет закоммиченного смещения', extra: 'Лишнее закоммиченное смещение' },
};

function diffEntities(cat: KafkaCategory, want: Map<string, Attrs>, got: Map<string, Attrs>, ignore: Set<string>): string[] {
  const n = NOUN[cat];
  const problems: string[] = [];
  for (const [key, w] of want) {
    const g = got.get(key);
    if (!g) {
      problems.push(`${n.missing} ${quote(key)}`);
      continue;
    }
    for (const attr of Object.keys(w)) {
      if (!ignore.has(attr) && w[attr] !== g[attr]) problems.push(`${n.name} ${quote(key)}: ${attr} — ожидается ${show(w[attr])}, у вас ${show(g[attr])}`);
    }
  }
  for (const key of got.keys()) if (!want.has(key)) problems.push(`${n.extra} ${quote(key)}`);
  return problems;
}

function diffMessages(want: KafkaCaptured, got: KafkaCaptured, routing: boolean, learner: KafkaSandbox): { problems: string[]; trace: string[] } {
  const problems: string[] = [];
  const trace: string[] = [];
  const lost: string[] = [];
  for (const [part, w] of want.messages) {
    const g = got.messages.get(part);
    if (!g) {
      if (routing || w.length > 0) problems.push(`Нет раздела ${quote(part)}${w.length ? `: ожидается ${list(w)}` : ''}`);
      continue;
    }
    if (w.join('\n') !== g.join('\n')) {
      problems.push(`Раздел ${quote(part)}: ожидается ${list(w)}, у вас ${list(g)}`);
      lost.push(...w.filter((b) => !g.includes(b)), ...g.filter((b) => !w.includes(b)));
    }
  }
  for (const [part, g] of got.messages) if (!want.messages.has(part) && g.length > 0) problems.push(`Раздел ${quote(part)}: лишние записи ${list(g)}`);
  // Where the learner's cluster put the records that differ: the journal path with the rule texts.
  if (routing) {
    for (const l of [...new Set(lost)].slice(0, 2)) {
      const msg = got.published.get(l);
      if (!msg) continue;
      const lines = explainFailure({ ok: false, text: `Запись ${quote(l)}`, evidence: [msg] }, learner.sim.journal, kafkaRules);
      problems.push(...lines.slice(1).map((x) => `Путь записи у вас — ${x}`));
      trace.push(...lines.slice(1));
    }
  }
  return { problems, trace };
}

/** Kafka categories of a `compare` list; Rabbit-only ones are ignored, an unset list (the schema default) means topics + configs. */
export function kafkaCompare(compare: readonly string[]): Set<string> {
  const own = compare.filter((c) => KAFKA_CATEGORIES.includes(c));
  return new Set(own.length > 0 ? own : ['topics', 'configs']);
}

export function compareKafka(task: BrokerTask, categories: Set<string>, ignore: string[], want: KafkaCaptured, got: KafkaCaptured, learner: KafkaSandbox): { problems: string[]; trace: string[] } {
  const skip = new Set(ignore);
  const problems: string[] = [];
  for (const cat of ['topics', 'configs', 'offsets'] as const) {
    if (categories.has(cat)) problems.push(...diffEntities(cat, want.entities[cat], got.entities[cat], skip));
  }
  let trace: string[] = [];
  const routing = task.type === 'routing';
  if (routing || categories.has('messages')) {
    const m = diffMessages(want, got, routing, learner);
    problems.push(...m.problems);
    trace = m.trace;
  }
  if (routing) problems.push(...got.publishErrors.filter((e) => !want.publishErrors.includes(e)));
  return { problems, trace };
}

/** Lint of a Kafka routing task after its reference ran: topics exist; a keyless record on a many-partition topic has no deterministic partition. */
export function lintKafkaPublications(task: BrokerTask, box: KafkaSandbox): string[] {
  const problems: string[] = [];
  if (task.type !== 'routing') return problems;
  for (const item of task.check.publish) {
    if (!('topic' in item)) {
      problems.push(`${task.id}: публикация exchange/routingKey относится к RabbitMQ, а симулятор kafka`);
      continue;
    }
    const d = box.model.describeTopic(item.topic);
    if (!d.ok) throw new SolutionError(`${task.id}: после эталонного решения нет топика «${item.topic}», в который публикует проверка`);
    if ((item.key === undefined || item.key === '') && d.value.partitionCount > 1) {
      problems.push(`${task.id}: запись «${item.value}» без ключа в топик «${item.topic}» из ${d.value.partitionCount} разделов: раздел выбирает продюсер, а не ключ`);
    }
  }
  return problems;
}
