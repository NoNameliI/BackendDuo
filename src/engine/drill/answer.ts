export type AnswerSpec = { kind: 'int' } | { kind: 'decimal' } | { kind: 'word'; latin?: boolean } | { kind: 'pair' };
export type Normalized = { ok: true; value: string } | { ok: false; problem: 'empty' | 'format' };

const cp = String.fromCodePoint;
const SPACES = new RegExp(`[${cp(0xa0)}${cp(0x2000)}-${cp(0x200a)}${cp(0x202f)}${cp(0x205f)}${cp(0x3000)}\t]`, 'g');
const MINUS_SIGN = cp(0x2212);
// Cyrillic capitals that look like Latin ones (code points of A B E K M H O P C T Y X).
const LOOK_ALIKES = new Map<string, string>(
  [
    [0x410, 'A'],
    [0x412, 'B'],
    [0x415, 'E'],
    [0x41a, 'K'],
    [0x41c, 'M'],
    [0x41d, 'H'],
    [0x41e, 'O'],
    [0x420, 'P'],
    [0x421, 'C'],
    [0x422, 'T'],
    [0x423, 'Y'],
    [0x425, 'X'],
  ].map(([code, latin]) => [String.fromCodePoint(code as number), latin as string]),
);
const LOOK_ALIKE = new RegExp(`[${[...LOOK_ALIKES.keys()].join('')}]`, 'g');

function common(input: string): string {
  return input.normalize('NFKC').replace(SPACES, ' ').replaceAll(MINUS_SIGN, '-').trim();
}

function intValue(text: string): string | null {
  const m = /^([+-]?)(\d{1,3}(?: \d{3})+|\d+)$/.exec(text);
  if (!m) return null;
  const digits = m[2].replaceAll(' ', '').replace(/^0+(?=\d)/, '');
  return m[1] === '-' && digits !== '0' ? `-${digits}` : digits;
}

function decimalValue(text: string): string | null {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text.replaceAll(',', '.'));
  if (!m || (m[2] === '' && !m[3])) return null;
  const whole = m[2].replace(/^0+(?=\d)/, '') || '0';
  const frac = (m[3] ?? '').replace(/0+$/, '');
  const body = frac ? `${whole}.${frac}` : whole;
  return m[1] === '-' && body !== '0' ? `-${body}` : body;
}

export function normalizeAnswer(input: string, spec: AnswerSpec): Normalized {
  const text = common(input);
  if (text === '') return { ok: false, problem: 'empty' };
  const done = (value: string | null): Normalized => (value === null ? { ok: false, problem: 'format' } : { ok: true, value });
  switch (spec.kind) {
    case 'int':
      return done(intValue(text));
    case 'decimal':
      return done(decimalValue(text));
    case 'word': {
      let word = text.replace(/\s+/g, '').toUpperCase();
      if (spec.latin) word = word.replace(LOOK_ALIKE, (ch) => LOOK_ALIKES.get(ch)!);
      return done(word);
    }
    case 'pair': {
      const parts = text.split(/[\s;,]+/).filter(Boolean);
      if (parts.length !== 2) return { ok: false, problem: 'format' };
      const [a, b] = parts.map(intValue);
      return done(a === null || b === null ? null : `${a} ${b}`);
    }
  }
}

/** null: the input is empty or malformed (shown to the learner, not counted as an attempt). */
export function sameAnswer(input: string, expected: string, spec: AnswerSpec): boolean | null {
  const got = normalizeAnswer(input, spec);
  if (!got.ok) return null;
  const want = normalizeAnswer(expected, spec);
  return got.value === (want.ok ? want.value : expected);
}
