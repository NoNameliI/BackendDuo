/**
 * Theory may contain runnable examples: fenced blocks with the info string `sql example` (SQL courses),
 * `sh example` (Git course) or `http example`, `graphql example`, `proto example`, `python example` (API course:
 * the lesson's virtual server, its GraphQL schema; a .proto with lines to encode or call after `###`; a FastAPI
 * main.py with requests to it after `###`) and `broker example` (broker courses: console commands for the simulator, run on the lesson's example broker), `scenario example` (a whole scenario JSON, run by the mini lab with a player and the invariants' verdict) and `drill example` (drill course: JSON {task, level, seed} of a fixed
 * instance shown with its statement, explanation and answer). They run in order on
 * the lesson's example sandbox (setup or server of its first task).
 */
export type ExampleLang = 'sql' | 'sh' | 'http' | 'graphql' | 'proto' | 'python' | 'drill' | 'broker' | 'scenario';
export type TheorySegment = { kind: 'markdown'; text: string } | { kind: 'example'; lang: ExampleLang; code: string };

const EXAMPLE = /^```(sql|sh|http|graphql|proto|python|drill|broker|scenario)[ \t]+example[ \t]*\n([\s\S]*?)^```[ \t]*$\n?/gm;

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

export function theoryExampleBlocks(theory: string): { lang: ExampleLang; code: string }[] {
  return splitTheory(theory).flatMap((s) => (s.kind === 'example' ? [{ lang: s.lang, code: s.code }] : []));
}

/** A ```text block right after an example (optionally after one short lead line such as «Результат:»). */
const SHOWN_OUTPUT = /^(?:[^\n`]{0,80}\n\s*)?```text[ \t]*\n([\s\S]*?)^```[ \t]*$/m;

/** Examples with the output the lesson text shows for them (the block that directly follows), if any. */
export function theoryExamplesWithShownOutput(theory: string): { lang: ExampleLang; code: string; shown?: string }[] {
  const segs = splitTheory(theory);
  return segs.flatMap((s, i) => {
    if (s.kind !== 'example') return [];
    const next = segs[i + 1];
    const m = next?.kind === 'markdown' ? SHOWN_OUTPUT.exec(next.text) : null;
    return [m && m.index === 0 ? { lang: s.lang, code: s.code, shown: m[1] } : { lang: s.lang, code: s.code }];
  });
}

export function theoryExamples(theory: string): string[] {
  return splitTheory(theory).flatMap((s) => (s.kind === 'example' ? [s.code] : []));
}
