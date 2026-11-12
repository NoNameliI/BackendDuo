import type { ConsoleCommand } from '../../console';
import type { Header } from '../log';
import type { KafkaModel } from '../model';
import type { ProducerRecord } from '../producer';
import { defineTool, Lines, parseOpts, parseProps, UsageError, type OptDef } from './format';

const DEFS: OptDef[] = [
  { key: 'bootstrap-server', long: '--bootstrap-server', kind: 'value' },
  { key: 'topic', long: '--topic', kind: 'value' },
  { key: 'reader-property', long: '--reader-property', kind: 'value' },
  { key: 'property', long: '--property', kind: 'value' },
  { key: 'command-property', long: '--command-property', kind: 'value' },
  { key: 'producer-property', long: '--producer-property', kind: 'value' },
];

type Parsed = Omit<ProducerRecord, 'topic'>;

/** One input line → record, by the reader properties (LineMessageReader rules). Throws UsageError with the line number. */
function parseLine(line: string, n: number, p: Map<string, string>): Parsed {
  const flag = (k: string): boolean => p.get(k) === 'true';
  const keySep = p.get('key.separator') ?? '\t';
  const nullMarker = p.get('null.marker');
  const bad = (): never => {
    throw new UsageError(`No key separator found on line number ${n}: '${line}'`);
  };
  let rest = line;
  const headers: Header[] = [];
  if (flag('parse.headers')) {
    const delim = p.get('headers.delimiter') ?? '\t';
    const i = rest.indexOf(delim);
    if (i < 0) throw new UsageError(`No headers delimiter found on line number ${n}: '${line}'`);
    const sep = p.get('headers.separator') ?? ',';
    const keySepH = p.get('headers.key.separator') ?? ':';
    for (const h of rest.slice(0, i).split(sep)) {
      if (h === '') continue;
      const j = h.indexOf(keySepH);
      if (j < 0) throw new UsageError(`No header key separator found in '${h}' on line number ${n}`);
      headers.push([h.slice(0, j), h.slice(j + keySepH.length)]);
    }
    rest = rest.slice(i + delim.length);
  }
  let key: string | null = null;
  if (flag('parse.key')) {
    const i = rest.indexOf(keySep);
    if (i < 0) {
      if (!flag('ignore.error')) bad();
    } else {
      key = rest.slice(0, i);
      rest = rest.slice(i + keySep.length);
    }
  }
  const nul = (s: string | null): string | null => (s !== null && nullMarker !== undefined && s === nullMarker ? null : s);
  return { key: nul(key), value: nul(rest), headers };
}

/** Text after `<<<` (here-string): the first word after the operator, or the rest of the same word. */
function hereString(rest: string[]): string | undefined {
  const i = rest.findIndex((w) => w.startsWith('<<<'));
  if (i < 0) return undefined;
  const inline = rest[i].slice(3);
  return inline !== '' ? inline : rest[i + 1];
}

export function createProducerCommands(api: KafkaModel): ConsoleCommand[] {
  return defineTool('kafka-console-producer', 'отправка строк в топик (строки из heredoc или <<<)', (args, stdin) => {
    const { opts, rest } = parseOpts(args, DEFS);
    opts.required('bootstrap-server');
    const topic = opts.required('topic');
    const o = new Lines();
    if (opts.given('property') && opts.given('reader-property')) throw new UsageError('Options --property and --reader-property cannot be specified together.');
    if (opts.given('property')) o.err('Warning: --property is deprecated and will be removed in a future version. Use --reader-property instead.');
    const props = parseProps(opts.given('reader-property') ? opts.list('reader-property') : opts.list('property'));
    const config = Object.fromEntries(parseProps([...opts.list('producer-property'), ...opts.list('command-property')]));

    const text = stdin ?? hereString(rest);
    if (text === undefined) return o.dim('(песочница: нет входных строк — передайте их через heredoc или <<<)').done();
    const input = text.split('\n');
    const records: Parsed[] = [];
    let problem: string | null = null;
    for (let i = 0; i < input.length; i++) {
      try {
        records.push(parseLine(input[i], i + 1, props));
      } catch (e) {
        if (!(e instanceof UsageError)) throw e;
        problem = e.message;
        break;
      }
    }
    let exit = 0;
    if (records.length > 0) {
      const r = api.produce(topic, records, config);
      if (!r.ok) return o.err(`Error: ${r.error.text}`).done(1);
      for (const d of r.value) {
        if (d.error) {
          o.err(`Error: record not sent to ${d.topic}: ${d.error.name}: ${d.error.text}`);
          exit = 1;
        }
      }
    }
    if (problem !== null) {
      o.err(`Error: ${problem}`);
      exit = 1;
    }
    return o.done(exit);
  });
}
