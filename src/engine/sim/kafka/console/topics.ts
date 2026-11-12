import type { ConsoleCommand } from '../../console';
import type { KafkaModel, PartitionFilter, TopicDescription } from '../model';
import { defineTool, errorLine, intOption, Lines, parseConfigList, parseOpts, UsageError, type OptDef } from './format';

const DEFS: OptDef[] = [
  { key: 'bootstrap-server', long: '--bootstrap-server', kind: 'value' },
  { key: 'topic', long: '--topic', kind: 'value' },
  { key: 'partitions', long: '--partitions', kind: 'value' },
  { key: 'replication-factor', long: '--replication-factor', kind: 'value' },
  { key: 'config', long: '--config', kind: 'value' },
  { key: 'create', long: '--create', kind: 'switch' },
  { key: 'list', long: '--list', kind: 'switch' },
  { key: 'describe', long: '--describe', kind: 'switch' },
  { key: 'alter', long: '--alter', kind: 'switch' },
  { key: 'delete', long: '--delete', kind: 'switch' },
  { key: 'if-not-exists', long: '--if-not-exists', kind: 'switch' },
  { key: 'if-exists', long: '--if-exists', kind: 'switch' },
  { key: 'exclude-internal', long: '--exclude-internal', kind: 'switch' },
  { key: 'topics-with-overrides', long: '--topics-with-overrides', kind: 'switch' },
  { key: 'under-replicated-partitions', long: '--under-replicated-partitions', kind: 'switch' },
  { key: 'under-min-isr-partitions', long: '--under-min-isr-partitions', kind: 'switch' },
  { key: 'at-min-isr-partitions', long: '--at-min-isr-partitions', kind: 'switch' },
  { key: 'unavailable-partitions', long: '--unavailable-partitions', kind: 'switch' },
];

const FILTERS: [string, PartitionFilter][] = [
  ['under-replicated-partitions', 'underReplicated'],
  ['under-min-isr-partitions', 'underMinIsr'],
  ['at-min-isr-partitions', 'atMinIsr'],
  ['unavailable-partitions', 'unavailable'],
];

const ACTIONS = ['create', 'list', 'describe', 'alter', 'delete'] as const;

function describeLines(d: TopicDescription, filtered: boolean, overridesOnly: boolean): string[] {
  const configs = Object.entries(d.configs)
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
  const lines: string[] = [];
  if (!filtered) lines.push(`Topic: ${d.name}\tTopicId: ${d.topicId}\tPartitionCount: ${d.partitionCount}\tReplicationFactor: ${d.replicationFactor}\tConfigs: ${configs}`);
  if (overridesOnly) return configs === '' ? [] : lines;
  for (const p of d.partitions) {
    lines.push(`\tTopic: ${d.name}\tPartition: ${p.partition}\tLeader: ${p.leader ?? 'none'}\tReplicas: ${p.replicas.join(',')}\tIsr: ${p.isr.join(',')}\tElr: N/A\tLastKnownElr: N/A`);
  }
  return lines;
}

export function createTopicsCommands(api: KafkaModel): ConsoleCommand[] {
  return defineTool('kafka-topics', 'темы: --create, --list, --describe, --alter --partitions, --delete', (args) => {
    const { opts } = parseOpts(args, DEFS);
    opts.required('bootstrap-server');
    const actions = ACTIONS.filter((a) => opts.has(a));
    if (actions.length !== 1) throw new UsageError('Command must include exactly one action: --list, --describe, --create, --alter or --delete');
    const action = actions[0];
    const o = new Lines();
    const fail = (e: { text: string }) => o.err(errorLine(e.text)).done(1);
    const topic = opts.value('topic');
    const exists = (name: string): boolean => api.listTopics().includes(name);

    switch (action) {
      case 'list':
        return o.out(...api.listTopics().filter((n) => topic === undefined || n === topic)).done();
      case 'create': {
        const name = opts.required('topic');
        const partitions = opts.value('partitions');
        const rf = opts.value('replication-factor');
        const configs = Object.fromEntries(opts.list('config').flatMap(parseConfigList));
        if (opts.has('if-not-exists') && exists(name)) return o.done();
        const r = api.createTopic({
          name,
          configs,
          ...(partitions !== undefined ? { partitions: intOption(partitions, 'partitions') } : {}),
          ...(rf !== undefined ? { replicationFactor: intOption(rf, 'replication-factor') } : {}),
        });
        return r.ok ? o.out(`Created topic ${name}.`).done() : fail(r.error);
      }
      case 'alter': {
        const name = opts.required('topic');
        if (opts.given('config')) throw new UsageError('Option "[config]" can\'t be used with action "[alter]"');
        if (opts.given('replication-factor')) throw new UsageError('Option "[replication-factor]" can\'t be used with action "[alter]"');
        const n = intOption(opts.required('partitions'), 'partitions');
        if (opts.has('if-exists') && !exists(name)) return o.done();
        const r = api.alterPartitions(name, n);
        return r.ok ? o.done() : fail(r.error);
      }
      case 'delete': {
        const name = opts.required('topic');
        if (opts.has('if-exists') && !exists(name)) return o.done();
        const r = api.deleteTopic(name);
        return r.ok ? o.done() : fail(r.error);
      }
      case 'describe': {
        const names = topic !== undefined ? [topic] : api.listTopics();
        const filter = FILTERS.find(([key]) => opts.has(key))?.[1];
        for (const name of names) {
          if (topic !== undefined && opts.has('if-exists') && !exists(name)) continue;
          const r = api.describeTopic(name, filter);
          if (!r.ok) return fail(r.error);
          o.out(...describeLines(r.value, filter !== undefined, opts.has('topics-with-overrides')));
        }
        return o.done();
      }
    }
  });
}
