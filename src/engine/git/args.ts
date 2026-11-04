export interface OptionSpec {
  /** Flag spellings → canonical option name, e.g. { '-m': 'message', '--message': 'message' }. */
  flags: Record<string, string>;
  /** Canonical names that take a value. */
  values?: string[];
}

export interface ParsedArgs {
  opts: Record<string, string[] | true>;
  args: string[];
  /** Arguments after a literal "--". */
  paths: string[] | null;
  error?: string;
}

/** git-style option parsing: combined short flags (-am), --name=value, values in the next argument, "--". */
export function parseArgs(argv: string[], spec: OptionSpec): ParsedArgs {
  const values = new Set(spec.values ?? []);
  const opts: ParsedArgs['opts'] = {};
  const args: string[] = [];
  let paths: string[] | null = null;

  const set = (name: string, value: string | true) => {
    if (value === true) opts[name] = true;
    else opts[name] = [...(Array.isArray(opts[name]) ? opts[name] : []), value];
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (paths) {
      paths.push(arg);
      continue;
    }
    if (arg === '--') {
      paths = [];
      continue;
    }
    if (arg.startsWith('--')) {
      const [flag, inline] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
      const name = spec.flags[flag];
      if (!name) return { opts, args, paths, error: `unknown option \`${flag.slice(2)}'` };
      if (values.has(name)) {
        const value = inline ?? argv[++i];
        if (value === undefined) return { opts, args, paths, error: `option \`${flag.slice(2)}' requires a value` };
        set(name, value);
      } else set(name, true);
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !/^-\d+$/.test(arg)) {
      for (let j = 1; j < arg.length; j++) {
        const name = spec.flags[`-${arg[j]}`];
        if (!name) return { opts, args, paths, error: `unknown switch \`${arg[j]}'` };
        if (values.has(name)) {
          const rest = arg.slice(j + 1);
          const value = rest || argv[++i];
          if (value === undefined) return { opts, args, paths, error: `switch \`${arg[j]}' requires a value` };
          set(name, value);
          break;
        }
        set(name, true);
      }
      continue;
    }
    args.push(arg);
  }
  return { opts, args, paths };
}

export const flag = (p: ParsedArgs, name: string): boolean => p.opts[name] !== undefined;
export const value = (p: ParsedArgs, name: string): string | undefined => {
  const v = p.opts[name];
  return Array.isArray(v) ? v[v.length - 1] : undefined;
};
export const valuesOf = (p: ParsedArgs, name: string): string[] => {
  const v = p.opts[name];
  return Array.isArray(v) ? v : [];
};
