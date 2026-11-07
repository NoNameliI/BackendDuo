import type { AnswerSpec } from './answer';

export type Level = 'base' | 'core' | 'hard';
export const LEVELS: readonly Level[] = ['base', 'core', 'hard'];
export type GeneratorId = `g${string}`;
/** Integers beyond 2^53 travel as decimal strings. */
export type FieldValue = string | number | boolean | readonly FieldValue[] | { readonly [k: string]: FieldValue };
export type Fields = { readonly [k: string]: FieldValue };
export type Vocab = Readonly<Record<string, readonly string[]>>;

/** Thrown by generate/solve for a degenerate or ambiguous draw: the caller draws again. */
export class Reject extends Error {}

export interface Rng {
  readonly seed: number;
  /** [0, 1) */
  next(): number;
  /** Inclusive bounds, unbiased. */
  int(lo: number, hi: number): number;
  pick<T>(xs: readonly T[]): T;
  shuffle<T>(xs: readonly T[]): T[];
  chance(p: number): boolean;
  fork(label: string): Rng;
}

export type Cell = string | number;
export interface DataTable {
  /** t1, t2, … */
  key: string;
  /** Column keys c1, c2, …; captions come from task.labels. */
  columns: string[];
  rows: Cell[][];
  /** false: a spreadsheet grid without a caption row (default true). */
  header?: boolean;
}
export type DataFile = { kind: 'table'; tables: DataTable[] } | { kind: 'text'; text: string };

export interface Solved {
  /** Canonical answer. */
  answer: string;
  /** Explanation fields only. */
  steps: Fields;
}

export interface Generator<P> {
  readonly id: GeneratorId;
  readonly answer: AnswerSpec;
  readonly shapes: readonly string[];
  /** Key → minimum list size the pack must give. */
  readonly vocab?: Readonly<Record<string, number>>;
  generate(rng: Rng, level: Level, shape: string, vocab: Vocab): P;
  /** Fast and analytical; throws Reject if the answer is not unique or the input is degenerate. */
  solve(params: P): Solved;
  /** Statement fields; never the answer. */
  fields(params: P): Fields;
  files?(params: P): DataFile[];
}

/** gNN.brute.ts: every canonical answer that satisfies the statement, sorted and deduped. */
export type Brute<P> = (params: P) => string[];

export interface Instance {
  /** `${n}:${taskId}:${level}:${seedHex}` */
  key: string;
  n: number;
  taskId: string;
  generator: GeneratorId;
  shape: string;
  level: Level;
  seed: number;
  fields: Fields;
  steps: Fields;
  answer: string;
  spec: AnswerSpec;
  files: DataFile[];
  tries: number;
}
