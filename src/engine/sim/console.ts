export interface ConsoleLine {
  text: string;
  tone: 'out' | 'err' | 'dim';
}
export interface ConsoleResult {
  lines: ConsoleLine[];
  exit: number;
  /** Set by the built-in `clear`: the view drops earlier output. */
  clear?: boolean;
}

export class ConsoleSyntaxError extends Error {}

/**
 * Splits one command line into words: single quotes are literal, double quotes allow \" and \\,
 * a backslash outside quotes escapes the next character, `#` at a word start begins a comment.
 * Unquoted `&&`, `||`, `|` and `&` are rejected (no chaining, no pipes).
 */
export function tokenize(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let has = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end < 0) throw new ConsoleSyntaxError('незакрытая одинарная кавычка');
      cur += line.slice(i + 1, end);
      has = true;
      i = end;
    } else if (c === '"') {
      i++;
      for (;;) {
        if (i >= line.length) throw new ConsoleSyntaxError('незакрытая двойная кавычка');
        const d = line[i];
        if (d === '"') break;
        if (d === '\\' && (line[i + 1] === '"' || line[i + 1] === '\\')) {
          cur += line[i + 1];
          i += 2;
        } else {
          cur += d;
          i++;
        }
      }
      has = true;
    } else if (c === '\\') {
      if (i + 1 < line.length) cur += line[++i];
      has = true;
    } else if (c === ' ' || c === '\t') {
      if (has) out.push(cur);
      cur = '';
      has = false;
    } else if (c === '#' && !has) {
      break;
    } else if (c === '&' || c === '|') {
      throw new ConsoleSyntaxError('цепочки команд и конвейеры не поддерживаются');
    } else {
      cur += c;
      has = true;
    }
  }
  if (has) out.push(cur);
  return out;
}

export interface ConsoleCommand {
  name: string;
  /** One Russian line for `help`. */
  help: string;
  /** `stdin` is the heredoc body (without the terminator line), if any. */
  run(args: string[], stdin?: string): ConsoleResult;
}

export interface Console {
  /** Runs one or more lines (backslash continuations and heredocs included). */
  exec(input: string): ConsoleResult;
  history(): readonly string[];
}

export const out = (...texts: string[]): ConsoleResult => ({ lines: texts.map((text) => ({ text, tone: 'out' as const })), exit: 0 });
export const err = (text: string, exit = 1): ConsoleResult => ({ lines: [{ text, tone: 'err' }], exit });

// `<<WORD` / `<<-WORD` start a heredoc; `<<< word` is a here-string and must not.
const HEREDOC = /(?<!<)<<(?!<)-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1\s*$/;

export function createConsole(commands: readonly ConsoleCommand[]): Console {
  const hist: string[] = [];
  const byName = new Map(commands.map((c) => [c.name, c]));
  const help = (): ConsoleResult => {
    const all = [...commands, { name: 'history', help: 'показать введённые команды' }, { name: 'clear', help: 'очистить экран' }, { name: 'help', help: 'список команд' }];
    return out(...all.map((c) => `  ${c.name.padEnd(16)}${c.help}`));
  };

  function runLine(line: string, stdin: string | undefined): ConsoleResult {
    let words: string[];
    try {
      words = tokenize(line);
    } catch (e) {
      if (e instanceof ConsoleSyntaxError) return err(`Синтаксис: ${e.message}`, 2);
      throw e;
    }
    if (words.length === 0) return { lines: [], exit: 0 };
    const [name, ...args] = words;
    if (name === 'help') return help();
    if (name === 'clear') return { lines: [], exit: 0, clear: true };
    if (name === 'history') return out(...hist.map((h, i) => `${String(i + 1).padStart(4)}  ${h}`));
    const cmd = byName.get(name);
    return cmd ? cmd.run(args, stdin) : err(`${name}: команда не найдена (help — список команд)`, 127);
  }

  return {
    history: () => hist,
    exec(input) {
      const raw = input.split(/\r?\n/);
      const lines: ConsoleLine[] = [];
      let exit = 0;
      let clear = false;
      for (let i = 0; i < raw.length; i++) {
        let line = raw[i];
        while (line.endsWith('\\') && !line.endsWith('\\\\') && i + 1 < raw.length) line = `${line.slice(0, -1)} ${raw[++i].trimStart()}`;
        if (line.trim() === '') continue;
        let stdin: string | undefined;
        const m = HEREDOC.exec(line);
        if (m) {
          const body: string[] = [];
          let closed = false;
          while (++i < raw.length) {
            if (raw[i].trim() === m[2]) {
              closed = true;
              break;
            }
            body.push(raw[i]);
          }
          if (!closed) {
            lines.push({ text: `Синтаксис: нет строки ${m[2]} в конце ввода`, tone: 'err' });
            exit = 2;
            break;
          }
          stdin = body.join('\n');
          line = line.slice(0, m.index);
        }
        if (!line.trim().startsWith('#')) hist.push(line.trim());
        const r = runLine(line, stdin);
        if (r.clear) {
          lines.length = 0;
          clear = true;
        }
        lines.push(...r.lines);
        exit = r.exit;
      }
      return clear ? { lines, exit, clear } : { lines, exit };
    },
  };
}
