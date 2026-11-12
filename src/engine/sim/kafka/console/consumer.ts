import type { ConsoleCommand } from '../../console';
import type { Rec } from '../consumer';
import type { KafkaModel } from '../model';
import { createTime, defineTool, intOption, Lines, parseOpts, parseProps, UsageError, type OptDef } from './format';

const DEFS: OptDef[] = [
  { key: 'bootstrap-server', long: '--bootstrap-server', kind: 'value' },
  { key: 'topic', long: '--topic', kind: 'value' },
  { key: 'partition', long: '--partition', kind: 'value' },
  { key: 'offset', long: '--offset', kind: 'value' },
  { key: 'from-beginning', long: '--from-beginning', kind: 'switch' },
  { key: 'group', long: '--group', kind: 'value' },
  { key: 'max-messages', long: '--max-messages', kind: 'value' },
  { key: 'timeout-ms', long: '--timeout-ms', kind: 'value' },
  { key: 'formatter-property', long: '--formatter-property', kind: 'value' },
  { key: 'property', long: '--property', kind: 'value' },
  { key: 'command-property', long: '--command-property', kind: 'value' },
  { key: 'consumer-property', long: '--consumer-property', kind: 'value' },
];

/** DefaultMessageFormatter: the enabled fields in a fixed order, joined by key.separator. */
function formatRecord(r: Rec, p: Map<string, string>): string {
  const on = (k: string, def = false): boolean => (p.has(k) ? p.get(k) === 'true' : def);
  const nul = p.get('null.literal') ?? 'null';
  const parts: string[] = [];
  if (on('print.timestamp')) parts.push(`CreateTime:${createTime(r.timestamp)}`);
  if (on('print.partition')) parts.push(`Partition:${r.partition}`);
  if (on('print.offset')) parts.push(`Offset:${r.offset}`);
  if (on('print.headers')) parts.push(r.headers.length === 0 ? 'NO_HEADERS' : r.headers.map(([k, v]) => `${k}:${v}`).join(p.get('headers.separator') ?? ','));
  if (on('print.key')) parts.push(r.key ?? nul);
  if (on('print.value', true)) parts.push(r.value ?? nul);
  return parts.join(p.get('key.separator') ?? '\t');
}

export function createConsumerCommands(api: KafkaModel): ConsoleCommand[] {
  return defineTool('kafka-console-consumer', 'чтение топика: --from-beginning, --group, --max-messages, --formatter-property', (args) => {
    const { opts } = parseOpts(args, DEFS);
    opts.required('bootstrap-server');
    const topic = opts.required('topic');
    const o = new Lines();
    if (opts.given('property') && opts.given('formatter-property')) throw new UsageError('Options --property and --formatter-property cannot be specified together.');
    if (opts.given('property')) o.err('Option --property is deprecated and will be removed in a future version. Use --formatter-property instead.');
    const fmt = parseProps(opts.given('formatter-property') ? opts.list('formatter-property') : opts.list('property'));
    const config = Object.fromEntries(parseProps([...opts.list('consumer-property'), ...opts.list('command-property')]));

    const partition = opts.value('partition');
    const offset = opts.value('offset');
    if (offset !== undefined && partition === undefined) throw new UsageError('The partition is required when offset is specified.');
    const maxMessages = opts.value('max-messages');
    const timeout = opts.value('timeout-ms');
    const r = api.consume({
      topic,
      config,
      fromBeginning: opts.has('from-beginning'),
      ...(partition !== undefined ? { partition: intOption(partition, 'partition', 0) } : {}),
      ...(offset !== undefined ? { offset: offset === 'earliest' || offset === 'latest' ? offset : intOption(offset, 'offset', 0) } : {}),
      ...(opts.value('group') !== undefined ? { group: opts.value('group') } : {}),
      ...(maxMessages !== undefined ? { maxMessages: intOption(maxMessages, 'max-messages', 1) } : {}),
      ...(timeout !== undefined ? { timeoutMs: intOption(timeout, 'timeout-ms', 1) } : {}),
    });
    if (!r.ok) return o.err(`Error: ${r.error.text}`, 'Processed a total of 0 messages').code(r.error.code).done(1);
    const { records, idle, error } = r.value;
    o.out(...records.map((rec) => formatRecord(rec, fmt)));
    if (error) o.err(`Error: ${error.name}: ${error.text}`).code(error.code);
    else if (idle) o.dim('(песочница: новых сообщений нет)');
    o.err(`Processed a total of ${records.length} messages`);
    return o.done(error ? 1 : 0);
  });
}
