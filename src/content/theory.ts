/**
 * Theory may contain runnable examples: fenced blocks with the info string `sql example` (SQL courses),
 * `sh example` (Git course) or `http example` (API course, sent to the lesson's virtual server). They run in
 * order on the lesson's example sandbox (setup or server of its first task).
 */
export type ExampleLang = 'sql' | 'sh' | 'http';
export type TheorySegment = { kind: 'markdown'; text: string } | { kind: 'example'; lang: ExampleLang; code: string };

const EXAMPLE = /^```(sql|sh|http)[ \t]+example[ \t]*\n([\s\S]*?)^```[ \t]*$\n?/gm;

export function splitTheory(theory: string): TheorySegment[] {
  const segments: TheorySegment[] = [];
  let last = 0;
  for (const match of theory.matchAll(EXAMPLE)) {
    const text = theory.slice(last, match.index).trim();
    if (text) segments.push({ kind: 'markdown', text });
    segments.push({ kind: 'example', lang: match[1] as ExampleLang, code: match[2].trim() });
    last = match.index + match[0].length;
  }
  const tail = theory.slice(last).trim();
  if (tail) segments.push({ kind: 'markdown', text: tail });
  return segments;
}

export function theoryExamples(theory: string): string[] {
  return splitTheory(theory).flatMap((s) => (s.kind === 'example' ? [s.code] : []));
}
