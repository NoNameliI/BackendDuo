/**
 * Counting and ranking of fixed-length words over an ordered alphabet 0..size-1 that obey a rule automaton.
 * Memoized by (position, state key). Pure; no task text.
 */
export interface Machine<S> {
  init: S;
  /** Next state after appending letter `c` at index `pos`, or null when the rules forbid it. */
  step(s: S, c: number, pos: number): S | null;
  /** True when a complete word that ended in `s` is allowed. */
  accept(s: S): boolean;
  /** Equal keys must mean equal futures. */
  key(s: S): string;
}

export function wordCounter<S>(m: Machine<S>, size: number, length: number) {
  const memo = new Map<string, number>();
  const completions = (s: S, pos: number): number => {
    if (pos === length) return m.accept(s) ? 1 : 0;
    const k = `${pos}|${m.key(s)}`;
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    let total = 0;
    for (let c = 0; c < size; c++) {
      const n = m.step(s, c, pos);
      if (n !== null) total += completions(n, pos + 1);
    }
    memo.set(k, total);
    return total;
  };
  return {
    completions,
    count: () => completions(m.init, 0),
    /** Number of valid words that start with `prefix`. */
    prefix(prefix: readonly number[]): number {
      let s: S | null = m.init;
      for (let i = 0; i < prefix.length && s !== null; i++) s = m.step(s, prefix[i], i);
      return s === null ? 0 : completions(s, prefix.length);
    },
    /** 1-based place of `word` among valid words in alphabetical order; 0 when the word is not valid. */
    rank(word: readonly number[]): number {
      let s: S = m.init;
      let before = 0;
      for (let i = 0; i < word.length; i++) {
        for (let c = 0; c < word[i]; c++) {
          const n = m.step(s, c, i);
          if (n !== null) before += completions(n, i + 1);
        }
        const next = m.step(s, word[i], i);
        if (next === null) return 0;
        s = next;
      }
      return m.accept(s) ? before + 1 : 0;
    },
  };
}
