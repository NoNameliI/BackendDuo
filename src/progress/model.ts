import { z } from 'zod';

/** Bump together with a migration step in `migrate` whenever the stored shape changes. */
export const PROGRESS_VERSION = 1;

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

const courseProgressSchema = z.object({
  tasks: z.record(z.string(), taskProgressSchema).default({}),
  /** Lessons credited by the placement test. */
  passedLessons: z.array(z.string()).default([]),
});

const progressDocSchema = z.object({
  schemaVersion: z.literal(PROGRESS_VERSION),
  courses: z.record(z.string(), courseProgressSchema).default({}),
  /** Local day (YYYY-MM-DD) → tasks solved that day. */
  activity: z.record(z.string(), z.number().int().nonnegative()).default({}),
  /** Badge id → ISO time it was earned. */
  badges: z.record(z.string(), z.string()).default({}),
  onboarding: z
    .object({ path: z.enum(['beginner', 'experienced']), completedAt: z.string() })
    .optional(),
});

export type TaskProgress = z.output<typeof taskProgressSchema>;
export type CourseProgress = z.output<typeof courseProgressSchema>;
export type ProgressDoc = z.output<typeof progressDocSchema>;

export const EMPTY_TASK: TaskProgress = { solved: false, attempts: 0, hintsUsed: 0, solutionShown: false, xp: 0, firstTry: false };
export const EMPTY_COURSE: CourseProgress = { tasks: {}, passedLessons: [] };

export const emptyProgress = (): ProgressDoc => ({ schemaVersion: PROGRESS_VERSION, courses: {}, activity: {}, badges: {} });

/** Brings stored data to the current version; unreadable data yields an empty document. */
export function migrate(raw: unknown): { doc: ProgressDoc; discarded: boolean } {
  if (raw === undefined || raw === null) return { doc: emptyProgress(), discarded: false };
  const parsed = progressDocSchema.safeParse(raw);
  return parsed.success ? { doc: parsed.data, discarded: false } : { doc: emptyProgress(), discarded: true };
}
