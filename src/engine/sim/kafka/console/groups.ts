import type { ConsoleCommand } from '../../console';
import type { GroupDescription } from '../consumer';
import type { KafkaModel, ResetRow, ResetSpec } from '../model';
import { defineTool, errorLine, intOption, Lines, parseDatetime, parseIsoDuration, parseOpts, renderColumns, UsageError, type OptDef, type Opts } from './format';

const DEFS: OptDef[] = [
  { key: 'bootstrap-server', long: '--bootstrap-server', kind: 'value' },
  { key: 'list', long: '--list', kind: 'switch' },
  { key: 'describe', long: '--describe', kind: 'switch' },
  { key: 'delete', long: '--delete', kind: 'switch' },
  { key: 'reset-offsets', long: '--reset-offsets', kind: 'switch' },
  { key: 'group', long: '--group', kind: 'value' },
  { key: 'all-groups', long: '--all-groups', kind: 'switch' },
  { key: 'topic', long: '--topic', kind: 'value' },
  { key: 'all-topics', long: '--all-topics', kind: 'switch' },
  { key: 'members', long: '--members', kind: 'switch' },
  { key: 'state', long: '--state', kind: 'switch' },
  { key: 'offsets', long: '--offsets', kind: 'switch' },
  { key: 'execute', long: '--execute', kind: 'switch' },
  { key: 'dry-run', long: '--dry-run', kind: 'switch' },
  { key: 'export', long: '--export', kind: 'switch' },
  { key: 'to-earliest', long: '--to-earliest', kind: 'switch' },
  { key: 'to-latest', long: '--to-latest', kind: 'switch' },
  { key: 'to-current', long: '--to-current', kind: 'switch' },
  { key: 'to-offset', long: '--to-offset', kind: 'value' },
  { key: 'shift-by', long: '--shift-by', kind: 'value' },
  { key: 'by-duration', long: '--by-duration', kind: 'value' },
  { key: 'to-datetime', long: '--to-datetime', kind: 'value' },
];

const SCENARIOS = ['to-datetime', 'by-duration', 'to-earliest', 'to-latest', 'shift-by', 'to-current', 'to-offset'];
const ACTIONS = ['list', 'describe', 'delete', 'reset-offsets'] as const;
const dash = (s: string | number | null): string => (s === null ? '-' : String(s));

function groupsOf(api: KafkaModel, opts: Opts, action: string): string[] {
  if (opts.has('all-groups')) return api.listGroups();
  const g = opts.list('group');
  if (g.length === 0) throw new UsageError(`Option [${action}] takes one of these options: --all-groups, --group`);
  return g;
}

function offsetsTable(d: GroupDescription): string[] {
  const rows = d.offsets.map((r) => [d.id, r.topic, String(r.partition), dash(r.current), String(r.logEnd), dash(r.lag), dash(r.memberId), dash(r.host), dash(r.clientId)]);
  if (rows.length === 0) return [];
  return ['', ...renderColumns(['GROUP', 'TOPIC', 'PARTITION', 'CURRENT-OFFSET', 'LOG-END-OFFSET', 'LAG', 'CONSUMER-ID', 'HOST', 'CLIENT-ID'], rows, [15, 15, 10, 15, 15, 15, 15, 15, 15])];
}
function membersTable(d: GroupDescription): string[] {
  const rows = d.members.map((m) => [d.id, m.memberId, m.host, m.clientId, String(m.assignment.length)]);
  if (rows.length === 0) return [];
  return ['', ...renderColumns(['GROUP', 'CONSUMER-ID', 'HOST', 'CLIENT-ID', '#PARTITIONS'], rows, [15, 15, 15, 15, 0])];
}
function stateTable(d: GroupDescription): string[] {
  const row = [d.id, `broker-${d.coordinator}:9092 (${d.coordinator})`, dash(d.protocol), d.state, String(d.members.length)];
  return ['', ...renderColumns(['GROUP', 'COORDINATOR (ID)', 'ASSIGNMENT-STRATEGY', 'STATE', '#MEMBERS'], [row], [15, 25, 15, 15, 0])];
}

function resetSpec(opts: Opts): ResetSpec {
  const given = SCENARIOS.filter((k) => opts.given(k));
  if (given.length !== 1) throw new UsageError(`Option [reset-offsets] takes exactly one of these options: ${SCENARIOS.map((s) => `--${s}`).join(', ')}`);
  switch (given[0]) {
    case 'to-earliest':
      return { mode: 'earliest' };
    case 'to-latest':
      return { mode: 'latest' };
    case 'to-current':
      return { mode: 'current' };
    case 'to-offset':
      return { mode: 'offset', value: intOption(opts.required('to-offset'), 'to-offset') };
    case 'shift-by':
      return { mode: 'shift-by', value: intOption(opts.required('shift-by'), 'shift-by') };
    case 'by-duration': {
      const ms = parseIsoDuration(opts.required('by-duration'));
      if (ms === null) throw new UsageError(`Error: invalid duration '${opts.value('by-duration')}'. Expected format: PnDTnHnMnS`);
      return { mode: 'duration', ms };
    }
    default: {
      const at = parseDatetime(opts.required('to-datetime'));
      if (at === null) throw new UsageError(`Error: invalid timestamp '${opts.value('to-datetime')}'. Expected format: YYYY-MM-DDTHH:mm:SS.sss`);
      return { mode: 'datetime', at };
    }
  }
}

/** `--topic T` or `--topic T:0,1`: topic names plus an optional partition filter per topic. */
function topicSelection(opts: Opts): { names: string[] | undefined; parts: Map<string, Set<number>> } {
  const parts = new Map<string, Set<number>>();
  if (opts.has('all-topics')) return { names: undefined, parts };
  const names: string[] = [];
  for (const t of opts.list('topic')) {
    const [name, list] = t.split(':', 2);
    if (!names.includes(name)) names.push(name);
    if (list !== undefined) parts.set(name, new Set(list.split(',').filter((x) => x !== '').map((x) => intOption(x, 'topic', 0))));
  }
  if (names.length === 0) throw new UsageError('Option [reset-offsets] takes one of these options: --all-topics, --topic');
  return { names, parts };
}

export function createGroupsCommands(api: KafkaModel): ConsoleCommand[] {
  return defineTool('kafka-consumer-groups', 'группы: --list, --describe [--members|--state], --reset-offsets, --delete', (args) => {
    const { opts } = parseOpts(args, DEFS);
    opts.required('bootstrap-server');
    const actions = ACTIONS.filter((a) => opts.has(a));
    if (actions.length !== 1) throw new UsageError('Command must include exactly one action: --list, --describe, --delete or --reset-offsets');
    const o = new Lines();
    let exit = 0;
    const fail = (text: string): void => {
      o.err(errorLine(text));
      exit = 1;
    };

    switch (actions[0]) {
      case 'list':
        return o.out(...api.listGroups()).done();
      case 'describe': {
        const wantMembers = opts.has('members');
        const wantState = opts.has('state');
        for (const id of groupsOf(api, opts, 'describe')) {
          const r = api.describeGroup(id);
          if (!r.ok) {
            fail(r.error.text);
            continue;
          }
          const d = r.value;
          if (d.members.length === 0) o.err(`Consumer group '${id}' has no active members.`);
          if (d.rebalancing) o.err(`Warning: Consumer group '${id}' is rebalancing.`);
          if (wantMembers) o.out(...membersTable(d));
          if (wantState) o.out(...stateTable(d));
          if (!wantMembers && !wantState) o.out(...offsetsTable(d));
          else if (opts.has('offsets')) o.out(...offsetsTable(d));
        }
        return o.done(exit);
      }
      case 'delete': {
        const ids = groupsOf(api, opts, 'delete');
        const failed: string[] = [];
        for (const id of ids) {
          const r = api.deleteGroup(id);
          if (!r.ok) failed.push(`* Group '${id}' could not be deleted due to: ${r.error.name}: ${r.error.text}`);
        }
        if (failed.length > 0) return o.err(errorLine('Deletion of some consumer groups failed:'), ...failed).done(1);
        return o.out(`Deletion of requested consumer groups (${ids.map((g) => `'${g}'`).join(', ')}) was successful.`).done();
      }
      case 'reset-offsets': {
        const ids = groupsOf(api, opts, 'reset-offsets');
        const spec = resetSpec(opts);
        const { names, parts } = topicSelection(opts);
        const execute = opts.has('execute') && !opts.has('dry-run');
        const all: ResetRow[] = [];
        for (const id of ids) {
          const dry = api.resetOffsets(id, spec, false, names);
          if (!dry.ok) {
            fail(dry.error.text);
            continue;
          }
          const rows = dry.value.filter((r) => (parts.get(r.topic)?.has(r.partition) ?? true));
          if (execute) {
            // Executed from the computed rows so that a `--topic T:0` filter touches only those partitions.
            const done = api.resetOffsets(id, { mode: 'from-file', rows: rows.map((r) => ({ topic: r.topic, partition: r.partition, offset: r.newOffset })) }, true, names);
            if (!done.ok) {
              fail(done.error.text);
              continue;
            }
          }
          all.push(...rows);
        }
        if (opts.has('export')) return o.out(...all.map((r) => `${r.topic},${r.partition},${r.newOffset}`)).done(exit);
        if (all.length > 0) {
          o.out('', ...renderColumns(['GROUP', 'TOPIC', 'PARTITION', 'NEW-OFFSET'], all.map((r) => [r.group, r.topic, String(r.partition), String(r.newOffset)]), [15, 15, 10, 15]));
        }
        return o.done(exit);
      }
    }
  });
}
