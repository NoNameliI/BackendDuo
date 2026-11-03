/**
 * Theory may contain runnable examples written as fenced blocks with the info string `sql example`.
 * They run in order on the lesson's example database (the setup of its first SQL task).
 */
export type TheorySegment = { kind: 'markdown'; text: string } | { kind: 'example'; sql: string };

const EXAMPLE = /^```sql[ \t]+example[ \t]*\n([\s\S]*?)^```[ \t]*$\n?/gm;

export function splitTheory(theory: string): TheorySegment[] {
  const segments: TheorySegment[] = [];
  let last = 0;
  for (const match of theory.matchAll(EXAMPLE)) {
    const text = theory.slice(last, match.index).trim();
    if (text) segments.push({ kind: 'markdown', text });
    segments.push({ kind: 'example', sql: match[1].trim() });
    last = match.index + match[0].length;
  }
  const tail = theory.slice(last).trim();
  if (tail) segments.push({ kind: 'markdown', text: tail });
  return segments;
}

export function theoryExamples(theory: string): string[] {
  return splitTheory(theory).flatMap((s) => (s.kind === 'example' ? [s.sql] : []));
}
