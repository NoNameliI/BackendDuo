import type { Level } from '@/engine/drill/types';

export type RuleId =
  | 'text-overlap'
  | 'text-over-line'
  | 'text-over-node'
  | 'text-over-element'
  | 'label-ownership'
  | 'label-on-crossing'
  | 'edge-through-node'
  | 'edges-overlap'
  | 'edges-concurrent'
  | 'node-overlap'
  | 'overflow-container'
  | 'overflow-window'
  | 'clipped-text'
  | 'bad-wrap'
  | 'scroll-x-page'
  | 'scroll-x-element'
  | 'font-small'
  | 'contrast'
  | 'empty-data'
  | 'render-error';

export interface AuditCase {
  /** Suite that plans and renders the case ('drill', 'broker', ...). */
  suite: string;
  /** Plain-text name of a case that has no level/seed meaning (lab fixtures); never course text. */
  label?: string;
  /** Drill: number of the task list; other suites: ordinal of the screen. */
  n: number;
  level: Level;
  seed: number;
  tag: 'seed' | 'bad';
  view: 'task' | 'theory';
}

export interface Defect {
  rule: RuleId;
  severity: 'critical' | 'minor';
  c: AuditCase;
  /** Short CSS path. */
  where: string;
  /** Numbers only, never course text. */
  detail: string;
  /** x, y, width, height in client pixels. */
  box: [number, number, number, number];
}

export interface AuditApi {
  ready: boolean;
  /** Null: nothing to audit (no private course for the drill suite). */
  course: { id: string; suite: string; numbers: number[] } | null;
  plan(o: { seeds: number; scan: number; bad: number; only?: number[] }): AuditCase[];
  run(cases: AuditCase[]): Promise<Defect[]>;
  /** Re-renders the case with a 2 px red outline over `box` (marked data-audit-overlay). */
  show(c: AuditCase, box?: Defect['box']): Promise<void>;
}

declare global {
  interface Window {
    __audit?: AuditApi;
  }
}
