// A suite is one family of audited screens: it plans cases and puts one of them on the page. The generic driver
// (driver.ts) collects the DOM after render and judges it with the shared rules.
import type { AuditCase } from './api';

export interface PlanOptions {
  seeds: number;
  scan: number;
  bad: number;
  only?: number[];
}

export interface AuditSuite {
  id: string;
  /** Cases to render, in a stable order. */
  plan(o: PlanOptions): AuditCase[];
  /** Puts the case on screen and waits until it is settled. Resolves to a message when the case cannot be built. */
  render(c: AuditCase): Promise<string | null>;
  /** The element that scrolls the case (default: the page); used to bring a defect into view for screenshots. */
  scroller?(): Element | null;
}

const registry = new Map<string, AuditSuite>();

export function registerSuite(s: AuditSuite): AuditSuite {
  registry.set(s.id, s);
  return s;
}

export const suiteOf = (id: string): AuditSuite | undefined => registry.get(id);
export const suiteIds = (): string[] => [...registry.keys()];

export const frames = (n: number) =>
  new Promise<void>((done) => {
    const step = (left: number) => (left <= 0 ? done() : requestAnimationFrame(() => step(left - 1)));
    step(n);
  });

/** Fonts loaded and two frames painted. */
export async function settle(): Promise<void> {
  await document.fonts.ready;
  await frames(2);
}
