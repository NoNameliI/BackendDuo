/** Positional notation helpers (digits 0-9, A-Z). Pure; no task text. */

export const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const digitChar = (d: number): string => {
  if (!Number.isInteger(d) || d < 0 || d >= DIGITS.length) throw new RangeError(`digit ${d}`);
  return DIGITS[d];
};

/** Digits of a non-negative integer in the given base (2..36), most significant first. */
export function toBase(n: bigint, base: number): string {
  if (n < 0n) throw new RangeError('negative number');
  if (n === 0n) return '0';
  const b = BigInt(base);
  let out = '';
  let rest = n;
  while (rest > 0n) {
    out = DIGITS[Number(rest % b)] + out;
    rest /= b;
  }
  return out;
}

/** Value of a digit string (upper or lower case); throws on a digit outside the base. */
export function fromBase(textValue: string, base: number): bigint {
  const b = BigInt(base);
  let v = 0n;
  for (const ch of textValue.toUpperCase()) {
    const d = DIGITS.indexOf(ch);
    if (d < 0 || d >= base) throw new RangeError(`digit ${ch} in base ${base}`);
    v = v * b + BigInt(d);
  }
  return v;
}
