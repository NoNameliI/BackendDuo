// The page side of the audit: plans the cases, renders each one with the real number view and judges the DOM.
import type { Course } from '@/content/loadCourse';
import type { DrillTask } from '@/content/schema';
import { makeInstance } from '@/engine/drill/instance';
import { LEVELS, type Instance, type Level } from '@/engine/drill/types';
import { lessonOfNumber, taskFor, useDrill, type DrillLessonTask } from '@/features/drill/drillStore';
import { renderInstance } from '@/features/drill/instanceView';
import type { AuditApi, AuditCase, Defect } from './api';
import { collect } from './collect';
import { evaluate } from './rules';
import { frames, registerSuite, settle, type AuditSuite, type PlanOptions } from './suites';

const drillTasks = (course: Course, n: number): DrillLessonTask[] =>
  (lessonOfNumber(course, n)?.tasks ?? []).filter((t): t is DrillLessonTask => t.type === 'drill');

const levelsOf = (course: Course, n: number): Level[] => LEVELS.filter((l) => drillTasks(course, n).some((t) => t.levels.includes(l)));

const longestToken = (texts: string[]): number => Math.max(0, ...texts.flatMap((t) => t.split(/\s+/).map((w) => w.length)));

/** Four crude "how heavy is this variant" measures; the heaviest seed of each becomes a `bad` case. */
function weights(task: DrillTask, inst: Instance): number[] {
  const r = renderInstance(task, inst);
  const cells: string[] = [];
  let volume = 0;
  for (const f of inst.files) {
    if (f.kind === 'text') {
      volume += f.text.length;
      cells.push(...f.text.split('\n'));
      continue;
    }
    for (const t of f.tables) {
      volume += t.rows.length * t.columns.length;
      for (const row of t.rows) cells.push(...row.map(String));
    }
  }
  const f = inst.fields;
  const nm = typeof f.n === 'number' && typeof f.m === 'number' ? f.n + f.m : 0;
  return [r.statement.length + r.explanation.length, volume, longestToken([r.statement, r.explanation, ...r.hints, ...cells]), nm];
}

export function planCases(course: Course, o: PlanOptions): AuditCase[] {
  const out: AuditCase[] = [];
  for (const { n } of course.drill!.numbers) {
    if (o.only && !o.only.includes(n)) continue;
    const levels = levelsOf(course, n);
    for (const level of levels) {
      for (let seed = 1; seed <= o.seeds; seed++) out.push({ n, level, seed, tag: 'seed', view: 'task', suite: 'drill' });
      const best: { w: number; seed: number }[] = [];
      for (let seed = o.seeds + 1; seed <= o.seeds + o.scan; seed++) {
        const task = taskFor(course, n, level, seed);
        if (!task) break;
        let w: number[];
        try {
          w = weights(task, makeInstance(task, n, level, seed));
        } catch {
          continue; // a failing seed would show up as a render error when it is drawn
        }
        w.forEach((v, i) => {
          if (!best[i] || v > best[i].w) best[i] = { w: v, seed };
        });
      }
      const seeds = [...new Set(best.filter((b) => b.w > 0).map((b) => b.seed))].slice(0, o.bad);
      for (const seed of seeds) out.push({ n, level, seed, tag: 'bad', view: 'task', suite: 'drill' });
    }
    out.push({ n, level: levels.includes('core') ? 'core' : (levels[0] ?? 'core'), seed: 1, tag: 'seed', view: 'theory', suite: 'drill' });
  }
  return out;
}

async function open(course: Course, c: AuditCase): Promise<string | null> {
  useDrill.getState().openNumber(c.n, { level: c.level, seed: c.seed, reveal: true });
  if (c.view === 'theory') useDrill.getState().setTab('theory');
  else {
    const p = useDrill.getState().practice;
    const task = p?.instance ? taskFor(course, c.n, c.level, c.seed) : null;
    // Every hint open, so the whole page is on screen.
    if (p && task) useDrill.setState({ practice: { ...p, hints: task.hints.length } });
  }
  await settle();
  for (const el of document.querySelectorAll('#drill-panel > div')) el.scrollTop = 0;
  return useDrill.getState().practice?.error ?? null;
}

/** The drill suite: the real number view of a private course. */
export function createDrillSuite(course: Course): AuditSuite {
  return registerSuite({
    id: 'drill',
    plan: (o) => planCases(course, o),
    render: (c) => open(course, c),
    scroller: () => document.querySelector('#drill-panel > div'),
  });
}

/** Page API for one suite: render each case, collect the DOM, judge it. `numbers` are the screens to show in the report. */
export function createAuditApi(suite: AuditSuite, info: { id: string; numbers: () => number[] }): AuditApi {
  const api: AuditApi = {
    ready: false,
    course: { id: info.id, suite: suite.id, numbers: info.numbers() },
    plan: (o) => suite.plan(o),
    async run(cases) {
      const defects: Defect[] = [];
      for (const c of cases) {
        const error = await suite.render(c);
        const at: Pick<Defect, 'c' | 'severity'> = { c, severity: 'critical' };
        if (error !== null) {
          defects.push({ ...at, rule: 'render-error', where: 'main', detail: 'instance failed to build', box: [0, 0, 0, 0] });
          continue;
        }
        try {
          for (const h of evaluate(collect())) defects.push({ ...h, c });
        } catch (e) {
          defects.push({ ...at, rule: 'render-error', where: 'audit', detail: `collect failed: ${e instanceof Error ? e.name : 'error'}`, box: [0, 0, 0, 0] });
        }
      }
      return defects;
    },
    async show(c, box) {
      await suite.render(c);
      document.querySelectorAll('[data-audit-overlay]').forEach((e) => e.remove());
      if (!box) return;
      const scroller = suite.scroller?.() ?? document.scrollingElement;
      const [x, y, w, h] = box;
      let shift = 0;
      if (scroller && y + h > window.innerHeight - 40) {
        scroller.scrollTop = Math.max(0, y - 140);
        shift = scroller.scrollTop;
        await frames(1);
      }
      const o = document.createElement('div');
      o.setAttribute('data-audit-overlay', '');
      o.style.cssText = `position:fixed;left:${x - 2}px;top:${y - shift - 2}px;width:${w + 4}px;height:${h + 4}px;outline:2px solid #ff2d2d;pointer-events:none;z-index:99999`;
      document.body.appendChild(o);
    },
  };
  void settle().then(() => void (api.ready = true));
  return api;
}
