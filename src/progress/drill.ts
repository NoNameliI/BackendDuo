import { taskXp } from './gamification';
import type { DrillLevel, DrillProgress, NumberStat } from './model';

/** Per-solve reward rules; `xp` is the base reward of the solved level (or a table by level). */
export interface DrillRules {
  xp: number | Record<DrillLevel, number>;
  /** Rewarded solves per number per day. */
  dailyXp: number;
}

export interface DrillOutcome {
  n: number;
  taskId: string;
  level: DrillLevel;
  correct: boolean;
  hintsUsed: number;
  solutionShown: boolean;
  ms: number;
  firstTry: boolean;
}

const RECENT_MAX = 10;
const WEAK_ACCURACY = 0.7;
const EMPTY_DRILL: DrillProgress = { xp: 0, numbers: {}, sets: [] };
const EMPTY_STAT: NumberStat = { seen: 0, correct: 0, firstTry: 0, ms: 0, recent: '', levels: {} };

export const baseXp = (rules: DrillRules, level: DrillLevel): number => (typeof rules.xp === 'number' ? rules.xp : rules.xp[level]);

/** Accuracy over the recent window (0 when nothing was answered yet). */
export function numberAccuracy(stat: NumberStat | undefined): number {
  const recent = stat?.recent ?? '';
  return recent.length === 0 ? 0 : [...recent].filter((c) => c === '+').length / recent.length;
}

/** Applies one answer to the drill progress; `xp` is what this answer earned (daily cap per number applies). */
export function recordOutcome(dp: DrillProgress | undefined, o: DrillOutcome, rules: DrillRules, today: string): { dp: DrillProgress; xp: number } {
  const current = dp ?? EMPTY_DRILL;
  const key = String(o.n);
  const stat = current.numbers[key] ?? EMPTY_STAT;
  const [c, t] = stat.levels[o.level] ?? [0, 0];
  const good = o.correct && !o.solutionShown;
  const day = current.day?.date === today ? current.day : { date: today, solves: {} };
  const solvesToday = day.solves[key] ?? 0;
  const xp = o.correct && solvesToday < rules.dailyXp ? taskXp(baseXp(rules, o.level), o.hintsUsed, o.solutionShown) : 0;
  const next: NumberStat = {
    seen: stat.seen + 1,
    correct: stat.correct + (o.correct ? 1 : 0),
    firstTry: stat.firstTry + (o.correct && o.firstTry ? 1 : 0),
    ms: stat.ms + (o.correct ? Math.max(0, Math.round(o.ms)) : 0),
    recent: (stat.recent + (good ? '+' : '-')).slice(-RECENT_MAX),
    levels: { ...stat.levels, [o.level]: [c + (o.correct ? 1 : 0), t + 1] },
    lastAt: today,
  };
  return {
    dp: {
      ...current,
      xp: current.xp + xp,
      numbers: { ...current.numbers, [key]: next },
      day: { date: today, solves: { ...day.solves, [key]: solvesToday + (o.correct ? 1 : 0) } },
    },
    xp,
  };
}

/**
 * Numbers of `ns` to practise again: at least two recent answers and either low accuracy or the last two
 * not both right. Lowest accuracy first.
 */
export function weakNumbers(dp: DrillProgress | undefined, ns: number[]): number[] {
  return ns
    .map((n) => ({ n, stat: dp?.numbers[String(n)] }))
    .filter(({ stat }) => stat !== undefined && stat.recent.length >= 2 && (numberAccuracy(stat) < WEAK_ACCURACY || !stat.recent.endsWith('++')))
    .sort((a, b) => numberAccuracy(a.stat) - numberAccuracy(b.stat))
    .map(({ n }) => n);
}
