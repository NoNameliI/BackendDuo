import { z } from 'zod';

/** Bump together with a migration step in `migrate` whenever the stored shape changes. */
export const PROGRESS_VERSION = 2;

const taskProgressSchema = z.object({
  solved: z.boolean(),
  attempts: z.number().int().nonnegative(),
  hintsUsed: z.number().int().nonnegative(),
  solutionShown: z.boolean(),
  /** XP awarded when the task was first solved. */
  xp: z.number().int().nonnegative().default(0),
  /** Solved on the first attempt without hints or the solution. */
  firstTry: z.boolean().default(false),
  solvedAt: z.string().optional(),
  draft: z.string().optional(),
});

const onboardingSchema = z.object({ path: z.enum(['beginner', 'experienced']), completedAt: z.string() });

/** Declared here on purpose: the drill content schema aligns with it separately. */
export const drillLevelSchema = z.enum(['base', 'core', 'hard']);

const int0 = z.number().int().nonnegative();
/** [correct, total] */
const tally = z.tuple([int0, int0]);
const numberStat = z.object({
  seen: int0,
  correct: int0,
  firstTry: int0,
  ms: int0,
  /** Newest last; '-' = wrong or solution shown. */
  recent: z.string().regex(/^[+-]{0,10}$/).default(''),
  levels: z.object({ base: tally, core: tally, hard: tally }).partial().default({}),
  lastAt: z.string().optional(),
});
const setResult = z.object({
  at: z.string(),
  level: drillLevelSchema,
  score: int0,
  max: int0,
  seconds: int0,
  wrong: z.array(z.number().int()),
});
const drillProgress = z.object({
  xp: int0.default(0),
  numbers: z.record(z.string(), numberStat).default({}),
  /** The last 20 full sets. */
  sets: z.array(setResult).default([]),
  /** Correct solves per number on one day (daily XP cap). */
  day: z.object({ date: z.string(), solves: z.record(z.string(), int0) }).optional(),
});

const courseProgressSchema = z.object({
  tasks: z.record(z.string(), taskProgressSchema).default({}),
  /** Lessons credited by the placement test. */
  passedLessons: z.array(z.string()).default([]),
  onboarding: onboardingSchema.optional(),
  drill: drillProgress.optional(),
});

const shared = {
  /** Local day (YYYY-MM-DD) → tasks solved that day, across all courses. */
  activity: z.record(z.string(), z.number().int().nonnegative()).default({}),
  /** `courseId:badgeId` → ISO time it was earned. */
  badges: z.record(z.string(), z.string()).default({}),
};

const progressDocSchema = z.object({
  schemaVersion: z.literal(PROGRESS_VERSION),
  courses: z.record(z.string(), courseProgressSchema).default({}),
  ...shared,
});

/** Version 1 knew a single course (PostgreSQL); onboarding and badge ids were global. */
const progressV1Schema = z.object({
  schemaVersion: z.literal(1),
  courses: z.record(z.string(), courseProgressSchema.omit({ onboarding: true, drill: true })).default({}),
  ...shared,
  onboarding: onboardingSchema.optional(),
});
const V1_COURSE = 'postgres';

export type DrillLevel = z.output<typeof drillLevelSchema>;
export type NumberStat = z.output<typeof numberStat>;
export type SetResult = z.output<typeof setResult>;
export type DrillProgress = z.output<typeof drillProgress>;
export type TaskProgress = z.output<typeof taskProgressSchema>;
export type CourseProgress = z.output<typeof courseProgressSchema>;
export type ProgressDoc = z.output<typeof progressDocSchema>;

export const EMPTY_TASK: TaskProgress = { solved: false, attempts: 0, hintsUsed: 0, solutionShown: false, xp: 0, firstTry: false };
export const EMPTY_COURSE: CourseProgress = { tasks: {}, passedLessons: [] };

export const emptyProgress = (): ProgressDoc => ({ schemaVersion: PROGRESS_VERSION, courses: {}, activity: {}, badges: {} });

export const badgeKey = (courseId: string, badgeId: string) => `${courseId}:${badgeId}`;

function fromV1(v1: z.output<typeof progressV1Schema>): ProgressDoc {
  const courses: ProgressDoc['courses'] = { ...v1.courses };
  if (v1.onboarding) courses[V1_COURSE] = { ...(courses[V1_COURSE] ?? EMPTY_COURSE), onboarding: v1.onboarding };
  return {
    schemaVersion: PROGRESS_VERSION,
    courses,
    activity: v1.activity,
    badges: Object.fromEntries(Object.entries(v1.badges).map(([id, at]) => [badgeKey(V1_COURSE, id), at])),
  };
}

export interface Migration {
  doc: ProgressDoc;
  /** The stored data could not be read and was replaced by an empty document. */
  discarded: boolean;
  /** Version the data was upgraded from, if it was not current. */
  migratedFrom?: number;
}

/** Brings stored data to the current version; unreadable data yields an empty document. */
export function migrate(raw: unknown): Migration {
  if (raw === undefined || raw === null) return { doc: emptyProgress(), discarded: false };
  const current = progressDocSchema.safeParse(raw);
  if (current.success) return { doc: current.data, discarded: false };
  const v1 = progressV1Schema.safeParse(raw);
  if (v1.success) return { doc: fromV1(v1.data), discarded: false, migratedFrom: 1 };
  return { doc: emptyProgress(), discarded: true };
}
