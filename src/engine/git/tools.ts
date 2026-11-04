import type { Ctx } from './commands/common';
import { resolvePath } from './world';

/** Extra commands of the sandbox shell, used by CI scripts and by task checks in the terminal. */
export interface ToolEnv {
  stdin?: string;
  /** Runs a command line in the same world, printing to the same output. */
  exec: (line: string) => number;
}

export type Tool = (ctx: Ctx, args: string[], env: ToolEnv) => number;

const read = (ctx: Ctx, path: string) => ctx.world.files.get(resolvePath(ctx.world.cwd, path));

function test(ctx: Ctx, args: string[]): number {
  const at = (p: string) => resolvePath(ctx.world.cwd, p);
  if (args[0] === '!') return test(ctx, args.slice(1)) === 0 ? 1 : 0;
  if (args.length === 0) return 1;
  if (args.length === 1) return args[0] ? 0 : 1;
  if (args.length === 2) {
    const [op, v] = args;
    const ok = {
      '-f': () => ctx.world.files.has(at(v)),
      '-d': () => ctx.world.isDir(at(v)),
      '-e': () => ctx.world.files.has(at(v)) || ctx.world.isDir(at(v)),
      '-s': () => Boolean(ctx.world.files.get(at(v))),
      '-z': () => v === '',
      '-n': () => v !== '',
    }[op];
    if (!ok) {
      ctx.err(`test: ${op}: unary operator expected`);
      return 2;
    }
    return ok() ? 0 : 1;
  }
  const [a, op, b] = args;
  const n = (x: string) => Number(x);
  const result = {
    '=': a === b,
    '==': a === b,
    '!=': a !== b,
    '-eq': n(a) === n(b),
    '-ne': n(a) !== n(b),
    '-gt': n(a) > n(b),
    '-lt': n(a) < n(b),
    '-ge': n(a) >= n(b),
    '-le': n(a) <= n(b),
  }[op];
  if (result === undefined) {
    ctx.err(`test: ${op}: binary operator expected`);
    return 2;
  }
  return result ? 0 : 1;
}

const grep: Tool = (ctx, args, env) => {
  const flags = new Set<string>();
  const rest: string[] = [];
  for (const a of args) {
    if (/^-[a-zA-Z]+$/.test(a) && !rest.length) for (const f of a.slice(1)) flags.add(f);
    else rest.push(a);
  }
  const [pattern, ...files] = rest;
  if (pattern === undefined) {
    ctx.err('Usage: grep [OPTION]... PATTERNS [FILE]...');
    return 2;
  }
  let re: RegExp;
  try {
    re = new RegExp(flags.has('F') ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pattern, flags.has('i') ? 'i' : '');
  } catch {
    ctx.err(`grep: Invalid regular expression: ${pattern}`);
    return 2;
  }
  const sources: [string, string | undefined][] = files.length ? files.map((f) => [f, read(ctx, f)]) : [['(standard input)', env.stdin ?? '']];
  let found = false;
  let failed = false;
  for (const [name, text] of sources) {
    if (text === undefined) {
      ctx.err(`grep: ${name}: No such file or directory`);
      failed = true;
      continue;
    }
    const lines = text.replace(/\n$/, '').split('\n');
    const hits = lines.map((l, i) => [l, i + 1] as const).filter(([l]) => re.test(l) !== flags.has('v'));
    if (hits.length) found = true;
    if (flags.has('q')) continue;
    const prefix = sources.length > 1 ? `${name}:` : '';
    if (flags.has('c')) ctx.out(`${prefix}${hits.length}`);
    else for (const [l, i] of hits) ctx.out(`${prefix}${flags.has('n') ? `${i}:` : ''}${l}`);
  }
  if (failed && !(flags.has('q') && found)) return 2;
  return found ? 0 : 1;
};

/** Runs a script file; `set -e` makes it stop at the first failing line. */
function script(ctx: Ctx, path: string, env: ToolEnv): number {
  const text = read(ctx, path);
  if (text === undefined) {
    ctx.err(`bash: ${path}: No such file or directory`);
    return 127;
  }
  const strict = /^\s*set\s+-\w*e/m.test(text);
  let code = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || /^set\s/.test(line)) continue;
    const exit = /^exit(?:\s+(\d+))?$/.exec(line);
    if (exit) return Number(exit[1] ?? code);
    code = env.exec(line);
    if (code !== 0 && strict) return code;
  }
  return code;
}

const npm: Tool = (ctx, args, env) => {
  const [sub, name] = args;
  const pkgText = read(ctx, 'package.json');
  if (sub === 'ci' || sub === 'install' || sub === 'i') {
    ctx.out('');
    ctx.out('added 0 packages in 1s (учебная песочница: пакеты не скачиваются)');
    return 0;
  }
  const scriptName = sub === 'test' || sub === 't' ? 'test' : sub === 'run' || sub === 'run-script' ? name : undefined;
  if (!scriptName) {
    ctx.err(`npm error: команда «npm ${args.join(' ')}» в учебной песочнице не поддерживается`);
    return 1;
  }
  if (pkgText === undefined) {
    ctx.err('npm error code ENOENT');
    ctx.err(`npm error path ${resolvePath(ctx.world.cwd, 'package.json')}`);
    ctx.err('npm error enoent Could not read package.json');
    return 254;
  }
  let pkg: { name?: string; version?: string; scripts?: Record<string, string> };
  try {
    pkg = JSON.parse(pkgText);
  } catch {
    ctx.err('npm error code EJSONPARSE');
    ctx.err('npm error JSON.parse Invalid package.json');
    return 1;
  }
  const command = pkg.scripts?.[scriptName];
  if (!command) {
    ctx.err(`npm error Missing script: "${scriptName}"`);
    return 1;
  }
  ctx.out('');
  ctx.out(`> ${pkg.name ?? 'project'}@${pkg.version ?? '1.0.0'} ${scriptName}`);
  ctx.out(`> ${command}`);
  ctx.out('');
  return env.exec(command);
};

export const TOOLS: Record<string, Tool> = {
  test: (ctx, args) => test(ctx, args),
  '[': (ctx, args) => {
    if (args.at(-1) !== ']') {
      ctx.err("[: missing `]'");
      return 2;
    }
    return test(ctx, args.slice(0, -1));
  },
  grep,
  true: () => 0,
  false: () => 1,
  exit: (_ctx, args) => Number(args[0] ?? 0),
  npm,
  sh: (ctx, args, env) => script(ctx, args[0] ?? '', env),
  bash: (ctx, args, env) => script(ctx, args[0] ?? '', env),
  wc: (ctx, args) => {
    const file = args.find((a) => !a.startsWith('-'));
    const text = file ? read(ctx, file) : undefined;
    if (text === undefined) {
      ctx.err(`wc: ${file}: No such file or directory`);
      return 1;
    }
    ctx.out(`${text.split('\n').length - 1} ${file}`);
    return 0;
  },
};

export function runScriptFile(ctx: Ctx, path: string, env: ToolEnv): number {
  return script(ctx, path, env);
}
