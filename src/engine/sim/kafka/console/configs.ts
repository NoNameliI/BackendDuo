import type { ConsoleCommand } from '../../console';
import type { KafkaModel } from '../model';
import { defineTool, errorLine, Lines, parseConfigList, parseOpts, UsageError, type OptDef } from './format';

const DEFS: OptDef[] = [
  { key: 'bootstrap-server', long: '--bootstrap-server', kind: 'value' },
  { key: 'entity-type', long: '--entity-type', kind: 'value' },
  { key: 'entity-name', long: '--entity-name', kind: 'value' },
  { key: 'entity-default', long: '--entity-default', kind: 'switch' },
  { key: 'alter', long: '--alter', kind: 'switch' },
  { key: 'describe', long: '--describe', kind: 'switch' },
  { key: 'add-config', long: '--add-config', kind: 'value' },
  { key: 'delete-config', long: '--delete-config', kind: 'value' },
  { key: 'all', long: '--all', kind: 'switch' },
];

export function createConfigsCommands(api: KafkaModel): ConsoleCommand[] {
  return defineTool('kafka-configs', 'конфигурация: --entity-type topics|brokers, --alter --add-config, --describe [--all]', (args) => {
    const { opts } = parseOpts(args, DEFS);
    opts.required('bootstrap-server');
    const type = opts.required('entity-type');
    if (type !== 'topics' && type !== 'brokers') throw new UsageError(`Error: entity type '${type}' is not supported in the sandbox (use topics or brokers)`);
    if (opts.has('alter') === opts.has('describe')) throw new UsageError('Command must include exactly one action: --alter or --describe');
    const isDefault = opts.has('entity-default');
    const name = isDefault ? '' : opts.value('entity-name');
    const what = type === 'topics' ? 'topic' : 'broker';
    const caption = (n: string): string => (n === '' ? 'brokers in the cluster' : `${what} ${n}`);
    const o = new Lines();

    if (opts.has('alter')) {
      if (name === undefined) throw new UsageError(`--entity-name or --entity-default must be specified with --alter of ${type}`);
      const add = opts.list('add-config').flatMap(parseConfigList);
      const del = opts.list('delete-config').flatMap((s) => s.split(',').filter((x) => x !== ''));
      if (add.length === 0 && del.length === 0) throw new UsageError('At least one of --add-config or --delete-config must be specified with --alter');
      const r = api.alterConfigs(type, name, Object.fromEntries(add), del);
      if (!r.ok) return o.err(errorLine(r.error.text)).done(1);
      return o.out(name === '' ? 'Completed updating default config for brokers in the cluster.' : `Completed updating config for ${what} ${name}.`).done();
    }

    let names: string[];
    if (name !== undefined) names = [name];
    else if (type === 'topics') names = api.listTopics();
    else throw new UsageError('--entity-name or --entity-default must be specified with --describe of brokers');
    const all = opts.has('all');
    for (const n of names) {
      const r = api.describeConfigs(type, n, all);
      if (!r.ok) return o.err(errorLine(r.error.text)).done(1);
      o.out(`${all ? 'All' : 'Dynamic'} configs for ${caption(n)} are:`);
      for (const e of r.value) o.out(`  ${e.name}=${e.value} sensitive=false synonyms={${e.source}:${e.name}=${e.value}}`);
    }
    return o.done();
  });
}
