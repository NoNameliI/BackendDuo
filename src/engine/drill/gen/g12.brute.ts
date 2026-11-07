import type { Brute } from '../types';
import type { P12 } from './g12';

/** Direct simulation of the statement with strings and arrays. */
export const brute: Brute<P12> = (p) => {
  if (p.shape === 'rewrite') {
    let s = p.start;
    for (let guard = 0; guard < 1_000_000; guard++) {
      const rule = p.rules.find((r) => s.indexOf(r.find) >= 0);
      if (!rule) break;
      const at = s.indexOf(rule.find);
      s = s.slice(0, at) + rule.repl + s.slice(at + rule.find.length);
    }
    const digits = s.split('').filter((c) => '0123456789'.includes(c));
    if (p.ask === 'sum') return [String(digits.map(Number).reduce((a, b) => a + b, 0))];
    if (p.ask === 'count') return [String(digits.filter((c) => c === String(p.digit)).length)];
    return [String(s.length)];
  }

  const PAD = 200_000;
  const tape: string[] = new Array(2 * PAD).fill('_');
  for (let i = 0; i < p.start.length; i++) tape[PAD + i] = p.start[i];
  let head = PAD;
  let state = 1;
  for (let guard = 0; state !== 0 && guard < 1_000_000; guard++) {
    const row = p.table.find((r) => r.state === state && r.read === tape[head]);
    if (!row) return [];
    tape[head] = row.write;
    head += row.move === 'R' ? 1 : -1;
    state = row.next;
  }
  const filled = tape.filter((c) => c !== '_');
  if (p.ask === 'ones') return [String(filled.filter((c) => c === '1').length)];
  if (p.ask === 'sum') return [String(filled.reduce((a, c) => a + Number(c), 0))];
  return [String(filled.length)];
};
