export class UsageError extends Error {}

export interface FlagDef {
  key: string;
  long: string;
  short?: string;
  kind: 'value' | 'switch';
}
export interface Parsed {
  values: Record<string, string>;
  switches: Set<string>;
  rest: string[];
}

/**
 * Minimal long/short flag parser: `--opt value`, `--opt=value`, `-o value`, unique long prefixes
 * (clap's infer_long_options), `--` ends flags. Words that are not flags are returned in `rest`.
 * With `stopAtWord` parsing ends at the first non-flag word (used for leading global flags).
 */
export function parseFlags(args: readonly string[], defs: readonly FlagDef[], stopAtWord = false): Parsed {
  const values: Record<string, string> = {};
  const switches = new Set<string>();
  const rest: string[] = [];
  const find = (w: string): FlagDef => {
    if (w.startsWith('--')) {
      const exact = defs.find((d) => d.long === w);
      if (exact) return exact;
      const cands = defs.filter((d) => d.long.startsWith(w));
      if (cands.length === 1) return cands[0];
      if (cands.length > 1) throw new UsageError(`error: option '${w}' is ambiguous (${cands.map((c) => c.long).join(', ')})`);
    } else {
      const d = defs.find((x) => x.short === w);
      if (d) return d;
    }
    throw new UsageError(`error: unexpected argument '${w}' found`);
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
      if (d.kind === 'switch') {
        if (eq > 0) throw new UsageError(`error: unexpected value for '${d.long}'`);
        switches.add(d.key);
      } else if (eq > 0) {
        values[d.key] = a.slice(eq + 1);
      } else if (i + 1 < args.length) {
        values[d.key] = args[++i];
      } else {
        throw new UsageError(`error: a value is required for '${d.long} <${d.key.toUpperCase()}>' but none was supplied`);
      }
    } else if (stopAtWord) {
      rest.push(...args.slice(i));
      break;
    } else {
      rest.push(a);
    }
  }
  return { values, switches, rest };
}

export function requireFlags(p: Parsed, defs: readonly FlagDef[], keys: readonly string[]): void {
  const missing = keys.filter((k) => p.values[k] === undefined);
  if (missing.length === 0) return;
  const lines = missing.map((k) => {
    const d = defs.find((x) => x.key === k);
    return `  ${d?.long ?? k} <${k.toUpperCase()}>`;
  });
  throw new UsageError(['error: the following required arguments were not provided:', ...lines].join('\n'));
}

export function boolValue(p: Parsed, key: string, long: string): boolean | undefined {
  const v = p.values[key];
  if (v === undefined) return undefined;
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw new UsageError(`error: invalid value '${v}' for '${long} <${key.toUpperCase()}>': provided string was not \`true\` or \`false\``);
}

export function jsonObject(p: Parsed, key: string, long: string): Record<string, unknown> | undefined {
  const v = p.values[key];
  if (v === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(v);
  } catch {
    throw new UsageError(`error: invalid value '${v}' for '${long} <${key.toUpperCase()}>': not a valid JSON object`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new UsageError(`error: invalid value '${v}' for '${long} <${key.toUpperCase()}>': not a valid JSON object`);
  }
  return parsed as Record<string, unknown>;
}
