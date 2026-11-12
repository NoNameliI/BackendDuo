import { describe, expect, it } from 'vitest';
import { createConsole, err, out, tokenize, type ConsoleCommand } from './console';

describe('tokenize', () => {
  it('splits words and honours quotes, escapes and comments', () => {
    expect(tokenize(`publish --routing-key "order.created" --body 'a "b" c' x\\ y # tail`)).toEqual([
      'publish',
      '--routing-key',
      'order.created',
      '--body',
      'a "b" c',
      'x y',
    ]);
    expect(tokenize('say "he said \\"hi\\""')).toEqual(['say', 'he said "hi"']);
    expect(tokenize('a "" b')).toEqual(['a', '', 'b']);
    expect(tokenize('a#b')).toEqual(['a#b']);
  });
  it('rejects unclosed quotes and chaining', () => {
    expect(() => tokenize('a "b')).toThrow();
    expect(() => tokenize("a 'b")).toThrow();
    expect(() => tokenize('a && b')).toThrow();
    expect(() => tokenize('a | b')).toThrow();
    expect(tokenize('a "|" b')).toEqual(['a', '|', 'b']);
  });
});

describe('console', () => {
  const echo: ConsoleCommand = { name: 'echo', help: 'печатает аргументы', run: (a, stdin) => out(a.join('|') + (stdin === undefined ? '' : `<${stdin}>`)) };
  const fail: ConsoleCommand = { name: 'fail', help: 'ошибка', run: () => err('плохо', 3) };
  const c = () => createConsole([echo, fail]);

  it('runs commands and reports unknown ones with exit 127', () => {
    const k = c();
    expect(k.exec('echo a "b c"').lines[0].text).toBe('a|b c');
    expect(k.exec('nope')).toMatchObject({ exit: 127 });
    expect(k.exec('fail')).toMatchObject({ exit: 3, lines: [{ tone: 'err' }] });
  });
  it('joins backslash continuations', () => {
    expect(c().exec('echo a \\\n   b \\\n c').lines[0].text).toBe('a|b|c');
  });
  it('passes heredoc bodies as stdin', () => {
    const r = c().exec('echo x <<EOF\nline1\nline2\nEOF\necho after');
    expect(r.lines.map((l) => l.text)).toEqual(['x<line1\nline2>', 'after']);
    expect(c().exec('echo <<EOF\nnever closed')).toMatchObject({ exit: 2 });
  });
  it('keeps history, help and clear', () => {
    const k = c();
    k.exec('echo 1');
    k.exec('# just a comment');
    k.exec('echo 2');
    expect(k.history()).toEqual(['echo 1', 'echo 2']);
    expect(k.exec('history').lines.map((l) => l.text.trim())).toEqual(['1  echo 1', '2  echo 2', '3  history']);
    expect(k.exec('help').lines.some((l) => l.text.includes('печатает аргументы'))).toBe(true);
    expect(k.exec('clear')).toMatchObject({ clear: true, lines: [] });
  });
  it('refuses pipes with a syntax error', () => {
    expect(c().exec('echo a | cat')).toMatchObject({ exit: 2, lines: [{ tone: 'err' }] });
  });
});
