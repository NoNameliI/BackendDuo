import type { ConsoleCommand, ConsoleLine, ConsoleResult } from '../../console';

/**
 * All Kafka console output formats and option parsing live here so they can be corrected in one place.
 * Verified (kafka-notes §11 and the final addendum, trunk = 4.4 behaviour): `Created topic X.`, the describe
 * lines (with `Elr: N/A`, `LastKnownElr: N/A`), the consumer-groups columns, `Processed a total of N messages`,
 * the deprecation warnings of `--property`, `Consumer group 'G' has no active members.`, the delete and
 * kafka-configs confirmations, `Dynamic configs for topic X are:` and its entry lines.
 *
 * Simplified wording (not in the notes, neutral plain form):
 * - `Error: <broker text>` as the prefix of every topic/group/config error (the real tools print Java exceptions);
 * - `Missing required argument "[name]"` for absent options, `<name> is not a recognized option`,
 *   `Option [name] requires an argument`;
 * - topics: `Command must include exactly one action: ...`, `Option "[config]" can't be used with action "[alter]"`,
 *   partition decrease text (comes from the model), existing topic `Topic 'x' already exists.`;
 * - producer: `Options --property and --reader-property cannot be specified together.`, parse errors
 *   (`No key separator found on line number N: '...'`, header errors), the unknown-topic error;
 * - consumer: `The partition is required when offset is specified.`, invalid values, the `(песочница: ...)` idle note;
 * - groups: the options-required messages, the reset scenario message, the date parse message, the failed-delete block,
 *   coordinator shown as `broker-N:9092 (N)`;
 * - configs: `At least one of --add-config or --delete-config must be specified with --alter`, unsupported entity types,
 *   `synonyms={SOURCE:name=value}` for every entry, default-entity captions;
 * - times: records carry virtual milliseconds, printed and parsed as UTC from SIM_EPOCH_MS (2026-01-01T00:00:00Z).
 */

export const SIM_EPOCH_MS = Date.UTC(2026, 0, 1);

export class UsageError extends Error {}

export interface OptDef {
  key: string;
  long: string;
  kind: 'value' | 'switch';
}

export class Opts {
  constructor(
    private readonly vals: ReadonlyMap<string, string[]>,
    private readonly sw: ReadonlySet<string>,
  ) {}
  has(key: string): boolean {
    return this.sw.has(key);
  }
  /** Last value given for the option, or undefined. */
  value(key: string): string | undefined {
    const v = this.vals.get(key);
    return v?.[v.length - 1];
  }
  list(key: string): string[] {
    return this.vals.get(key) ?? [];
  }
  given(key: string): boolean {
    return this.sw.has(key) || this.vals.has(key);
  }
  required(key: string): string {
    const v = this.value(key);
    if (v === undefined) throw new UsageError(`Missing required argument "[${key}]"`);
    return v;
  }
}

/**
 * Long options only, `--opt value` or `--opt=value`, unique prefixes allowed (jopt style).
 * Words that are not options are returned in `rest`.
 */
export function parseOpts(args: readonly string[], defs: readonly OptDef[]): { opts: Opts; rest: string[] } {
  const vals = new Map<string, string[]>();
  const sw = new Set<string>();
  const rest: string[] = [];
  const find = (w: string): OptDef => {
    const exact = defs.find((d) => d.long === w);
    if (exact) return exact;
    const cands = defs.filter((d) => d.long.startsWith(w));
    if (cands.length === 1) return cands[0];
    if (cands.length > 1) throw new UsageError(`Ambiguous option: ${w} (could be: ${cands.map((c) => c.long).join(', ')})`);
    throw new UsageError(`${w.replace(/^-+/, '')} is not a recognized option`);
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      rest.push(...args.slice(i + 1));
      break;
    }
    if (a.length > 1 && a.startsWith('-') && !/^-\d/.test(a)) {
      const eq = a.startsWith('--') ? a.indexOf('=') : -1;
      const d = find(eq > 0 ? a.slice(0, eq) : a);
      if (d.kind === 'switch') sw.add(d.key);
      else {
        let v: string;
        if (eq > 0) v = a.slice(eq + 1);
        else if (i + 1 < args.length) v = args[++i];
        else throw new UsageError(`Option [${d.long.slice(2)}] requires an argument`);
        vals.set(d.key, [...(vals.get(d.key) ?? []), v]);
      }
    } else rest.push(a);
  }
  return { opts: new Opts(vals, sw), rest };
}

export class Lines {
  readonly lines: ConsoleLine[] = [];
  private errorCode?: string;
  /** Remembers the first broker error code of the command (decimal text). */
  code(c: number): this {
    this.errorCode ??= String(c);
    return this;
  }
  out(...t: string[]): this {
    for (const text of t) this.lines.push({ text, tone: 'out' });
    return this;
  }
  err(...t: string[]): this {
    for (const text of t) this.lines.push({ text, tone: 'err' });
    return this;
  }
  dim(...t: string[]): this {
    for (const text of t) this.lines.push({ text, tone: 'dim' });
    return this;
  }
  done(exit = 0): ConsoleResult {
    return { lines: this.lines, exit, ...(exit !== 0 && this.errorCode !== undefined ? { code: this.errorCode } : {}) };
  }
}

export const errorLine = (text: string): string => `Error: ${text}`;

/** A tool under both names: `kafka-topics.sh` and `kafka-topics`; usage errors become an error line with exit 1. */
export function defineTool(name: string, help: string, run: (args: string[], stdin?: string) => ConsoleResult): ConsoleCommand[] {
  const safe = (args: string[], stdin?: string): ConsoleResult => {
    try {
      return run(args, stdin);
    } catch (e) {
      if (e instanceof UsageError) return new Lines().err(e.message).done(1);
      throw e;
    }
  };
  return [
    { name: `${name}.sh`, help, run: safe },
    { name, help: `то же, что ${name}.sh`, run: safe },
  ];
}

/** Columns separated by one space, each at least `min[i]` wide and as wide as its data; the last one is not padded. */
export function renderColumns(header: readonly string[], rows: readonly (readonly string[])[], min: readonly number[]): string[] {
  const widths = header.map((h, i) => Math.max(min[i] ?? 0, h.length, ...rows.map((r) => r[i].length)));
  const line = (r: readonly string[]): string => r.map((c, i) => c.padEnd(widths[i])).join(' ').trimEnd();
  return [line(header), ...rows.map(line)];
}

export function intOption(value: string, name: string, min?: number): number {
  const n = Number(value);
  if (value.trim() === '' || !Number.isInteger(n)) throw new UsageError(`Invalid value for option '--${name}': '${value}' is not an integer`);
  if (min !== undefined && n < min) throw new UsageError(`Invalid value for option '--${name}': ${value} must be at least ${min}`);
  return n;
}

/** `k=v` pairs of --property style options; the value is everything after the first `=`. */
export function parseProps(list: readonly string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of list) {
    const i = p.indexOf('=');
    if (i < 0) m.set(p, '');
    else m.set(p.slice(0, i), p.slice(i + 1));
  }
  return m;
}

/** `a=1,b=[x,y]` → entries; commas inside brackets stay, the brackets are dropped from the value. */
export function parseConfigList(s: string): [string, string][] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const c of s) {
    if (c === '[') depth++;
    else if (c === ']') depth = Math.max(0, depth - 1);
    if (c === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += c;
  }
  parts.push(cur);
  return parts
    .filter((p) => p !== '')
    .map((p) => {
      const i = p.indexOf('=');
      if (i <= 0) throw new UsageError(`Invalid config entry '${p}': expected name=value`);
      const v = p.slice(i + 1);
      return [p.slice(0, i).trim(), v.startsWith('[') && v.endsWith(']') ? v.slice(1, -1) : v];
    });
}

/** `5s`, `1500ms`, `2m`, `0.5s`, bare number = seconds → ms; null if malformed. */
export function parseDuration(s: string): number | null {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m)?$/.exec(s);
  if (!m) return null;
  const unit = m[2] === 'ms' ? 1 : m[2] === 'm' ? 60000 : 1000;
  return Math.round(Number(m[1]) * unit);
}

/** ISO-8601 duration such as PT1H30M or P1DT2S → ms; null if malformed. */
export function parseIsoDuration(s: string): number | null {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(s);
  if (!m || s === 'P' || s.endsWith('T')) return null;
  const n = (x: string | undefined): number => (x === undefined ? 0 : Number(x));
  return Math.round(((n(m[1]) * 24 + n(m[2])) * 60 + n(m[3])) * 60000 + n(m[4]) * 1000);
}

/** `YYYY-MM-DDTHH:mm:SS[.sss][Z|±hh:mm]` (UTC when no zone) → virtual ms; null if malformed. */
export function parseDatetime(s: string): number | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (!m) return null;
  const zone = m[4] === undefined ? 'Z' : m[4] === 'Z' || m[4].includes(':') ? m[4] : `${m[4].slice(0, 3)}:${m[4].slice(3)}`;
  const t = Date.parse(`${m[1]}T${m[2]}.${(m[3] ?? '0').padEnd(3, '0')}${zone}`);
  return Number.isNaN(t) ? null : t - SIM_EPOCH_MS;
}

export const createTime = (ts: number): number => SIM_EPOCH_MS + ts;
