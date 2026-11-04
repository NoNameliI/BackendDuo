import { runGit } from './commands';
import type { Ctx } from './commands/common';
import { resolvePath, type World } from './world';

export interface OutputLine {
  text: string;
  stream: 'out' | 'err';
}

export interface ShellResult {
  lines: OutputLine[];
  exit: number;
  /** `clear` was run: the terminal should be emptied. */
  clear: boolean;
}

type Token = { op: '&&' | ';' | '>' | '>>' | '|' } | { word: string };

/** Splits a command line into words and operators; quotes group words, backslash escapes outside single quotes. */
export function tokenize(line: string): Token[] | { error: string } {
  const tokens: Token[] = [];
  let word = '';
  let inWord = false;
  const flush = () => {
    if (inWord) tokens.push({ word });
    word = '';
    inWord = false;
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" || c === '"') {
      const end = line.indexOf(c, i + 1);
      if (end === -1) return { error: 'незакрытая кавычка' };
      const chunk = line.slice(i + 1, end);
      word += c === '"' ? chunk.replace(/\\(["\\$`])/g, '$1') : chunk;
      inWord = true;
      i = end;
    } else if (c === '\\' && i + 1 < line.length) {
      word += line[++i];
      inWord = true;
    } else if (/\s/.test(c)) flush();
    else if (c === '&' && line[i + 1] === '&') {
      flush();
      tokens.push({ op: '&&' });
      i++;
    } else if (c === ';' || c === '|') {
      flush();
      tokens.push({ op: c });
    } else if (c === '>') {
      flush();
      const append = line[i + 1] === '>';
      tokens.push({ op: append ? '>>' : '>' });
      if (append) i++;
    } else if (c === '#' && !inWord) break;
    else {
      word += c;
      inWord = true;
    }
  }
  flush();
  return tokens;
}

interface Simple {
  argv: string[];
  redirect?: { path: string; append: boolean };
}

function builtin(ctx: Ctx, argv: string[], stdin: string | undefined): number {
  const world = ctx.world;
  const [cmd, ...args] = argv;
  const flags = new Set(args.filter((a) => a.startsWith('-')).flatMap((a) => a.slice(1).split('')));
  const operands = args.filter((a) => !a.startsWith('-'));
  const at = (path: string) => resolvePath(world.cwd, path);
  switch (cmd) {
    case 'git':
      return runGit(ctx, args);
    case 'cd': {
      const target = at(operands[0] ?? '~');
      if (!world.isDir(target)) {
        ctx.err(`bash: cd: ${operands[0]}: No such file or directory`);
        return 1;
      }
      world.cwd = target;
      return 0;
    }
    case 'pwd':
      ctx.out(world.cwd);
      return 0;
    case 'ls': {
      const dir = at(operands[0] ?? '.');
      if (world.files.has(dir)) {
        ctx.out(operands[0]);
        return 0;
      }
      if (!world.isDir(dir)) {
        ctx.err(`ls: cannot access '${operands[0]}': No such file or directory`);
        return 2;
      }
      const prefix = dir === '/' ? '/' : `${dir}/`;
      const names = new Set<string>();
      for (const path of [...world.files.keys(), ...world.dirs]) {
        if (path.startsWith(prefix) && path.length > prefix.length) names.add(path.slice(prefix.length).split('/')[0]);
      }
      const shown = [...names].filter((n) => flags.has('a') || !n.startsWith('.')).sort();
      if (flags.has('a')) shown.unshift('.', '..');
      if (shown.length) ctx.out(shown.join('  '));
      return 0;
    }
    case 'cat': {
      if (operands.length === 0 && stdin !== undefined) {
        ctx.out(stdin.replace(/\n$/, ''));
        return 0;
      }
      let code = 0;
      for (const name of operands) {
        const content = world.files.get(at(name));
        if (content === undefined) {
          ctx.err(`cat: ${name}: ${world.isDir(at(name)) ? 'Is a directory' : 'No such file or directory'}`);
          code = 1;
        } else if (content) ctx.out(content.replace(/\n$/, ''));
      }
      return code;
    }
    case 'echo':
      ctx.out(args.join(' '));
      return 0;
    case 'touch':
      for (const name of operands) if (!world.files.has(at(name))) world.writeFile(at(name), '');
      return 0;
    case 'mkdir':
      for (const name of operands) {
        const path = at(name);
        if (world.isDir(path) && !flags.has('p')) {
          ctx.err(`mkdir: cannot create directory '${name}': File exists`);
          return 1;
        }
        world.mkdirp(path);
      }
      return 0;
    case 'rm':
      for (const name of operands) {
        const path = at(name);
        if (world.files.has(path)) world.files.delete(path);
        else if (world.isDir(path)) {
          if (!flags.has('r')) {
            ctx.err(`rm: cannot remove '${name}': Is a directory`);
            return 1;
          }
          for (const f of [...world.files.keys()]) if (f.startsWith(`${path}/`)) world.files.delete(f);
          for (const d of [...world.dirs]) if (d === path || d.startsWith(`${path}/`)) world.dirs.delete(d);
          for (const root of [...world.repos.keys()]) if (root === path || root.startsWith(`${path}/`)) world.repos.delete(root);
        } else if (!flags.has('f')) {
          ctx.err(`rm: cannot remove '${name}': No such file or directory`);
          return 1;
        }
      }
      return 0;
    case 'mv': {
      const [from, to] = operands.map(at);
      const content = from ? world.files.get(from) : undefined;
      if (content === undefined || !to) {
        ctx.err(`mv: cannot stat '${operands[0] ?? ''}': No such file or directory`);
        return 1;
      }
      world.files.delete(from);
      world.writeFile(world.isDir(to) ? `${to}/${from.split('/').pop()}` : to, content);
      return 0;
    }
    default:
      ctx.err(`bash: ${cmd}: command not found`);
      return 127;
  }
}

/** Runs one command line. `stdin` feeds a heredoc collected by runScript. */
export function runLine(world: World, line: string, stdin?: string): ShellResult {
  const lines: OutputLine[] = [];
  const tokens = tokenize(line);
  if ('error' in tokens) return { lines: [{ text: `bash: ${tokens.error}`, stream: 'err' }], exit: 2, clear: false };

  const chain: { cmd: Simple; op: '&&' | ';' }[] = [];
  let current: Simple = { argv: [] };
  let pendingOp: '&&' | ';' = ';';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if ('word' in t) current.argv.push(t.word);
    else if (t.op === '>' || t.op === '>>') {
      const next = tokens[++i];
      if (!next || !('word' in next)) return { lines: [{ text: 'bash: syntax error near unexpected token `newline\'', stream: 'err' }], exit: 2, clear: false };
      current.redirect = { path: next.word, append: t.op === '>>' };
    } else if (t.op === '|') {
      return { lines: [{ text: 'bash: конвейеры (|) в учебной песочнице не поддерживаются', stream: 'err' }], exit: 2, clear: false };
    } else {
      chain.push({ cmd: current, op: pendingOp });
      current = { argv: [] };
      pendingOp = t.op;
    }
  }
  chain.push({ cmd: current, op: pendingOp });

  let exit = 0;
  let clear = false;
  for (const { cmd, op } of chain) {
    if (cmd.argv.length === 0) continue;
    if (op === '&&' && exit !== 0) continue;
    if (cmd.argv[0] === 'clear') {
      clear = true;
      lines.length = 0;
      exit = 0;
      continue;
    }
    const captured: string[] = [];
    const split = (text: string) => text.split('\n');
    const ctx: Ctx = {
      world,
      out: (text) => (cmd.redirect ? captured.push(...split(text)) : lines.push(...split(text).map((t) => ({ text: t, stream: 'out' as const })))),
      err: (text) => lines.push(...split(text).map((t) => ({ text: t, stream: 'err' as const }))),
    };
    exit = builtin(ctx, cmd.argv, stdin);
    if (cmd.redirect) {
      const path = resolvePath(world.cwd, cmd.redirect.path);
      const text = captured.length ? `${captured.join('\n')}\n` : '';
      world.writeFile(path, cmd.redirect.append ? (world.files.get(path) ?? '') + text : text);
    }
  }
  return { lines, exit, clear };
}

/**
 * Runs a multi-line script (task setup or solution). `cmd <<'EOF'` takes the following lines up to EOF as its
 * input. Stops at the first failing line and reports it.
 */
export function runScript(world: World, script: string): { lines: OutputLine[]; failed?: { line: string; exit: number } } {
  const source = script.replace(/\r\n?/g, '\n').split('\n');
  const lines: OutputLine[] = [];
  for (let i = 0; i < source.length; i++) {
    let line = source[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    let stdin: string | undefined;
    const heredoc = /<<-?\s*(['"]?)(\w+)\1\s*/.exec(line);
    if (heredoc) {
      const body: string[] = [];
      while (++i < source.length && source[i] !== heredoc[2]) body.push(source[i]);
      stdin = body.length ? `${body.join('\n')}\n` : '';
      line = line.replace(heredoc[0], ' ');
    }
    const result = runLine(world, line, stdin);
    lines.push(...result.lines);
    if (result.exit !== 0) return { lines, failed: { line, exit: result.exit } };
  }
  return { lines };
}
