import { z } from 'zod';

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'ожидается kebab-case идентификатор');
const sqlText = z.string().trim().min(1);

const taskBase = {
  id: slug,
  title: z.string().min(1),
  prompt: z.string().min(1),
  xp: z.number().int().positive().default(10),
  hints: z.array(z.string().min(1)).min(1).max(3),
};

const sqlTaskBase = {
  ...taskBase,
  dataset: slug.optional(),
  setup: z.string().default(''),
  starter: z.string().default(''),
  solution: sqlText,
};

/** How two result sets are compared. Row order matters only when the task asks for ORDER BY. */
const compareOptions = z
  .object({
    ordered: z.boolean().default(false),
    columnNames: z.boolean().default(true),
  })
  .prefault({});

const resultTask = z.object({
  ...sqlTaskBase,
  type: z.literal('result'),
  check: compareOptions,
});

const stateTask = z.object({
  ...sqlTaskBase,
  type: z.literal('state'),
  /** Read-only queries whose output must match after the solution and after the learner's code. */
  checkSql: sqlText,
  check: compareOptions,
});

const schemaTask = z.object({
  ...sqlTaskBase,
  type: z.literal('schema'),
  ui: z.enum(['editor', 'erd']).default('editor'),
  check: z
    .object({
      tables: z.array(z.string().min(1)).optional(),
      types: z.enum(['exact', 'family', 'ignore']).default('family'),
      defaults: z.boolean().default(true),
      checks: z.boolean().default(true),
      indexes: z.boolean().default(true),
    })
    .prefault({}),
});

const planTask = z.object({
  ...sqlTaskBase,
  type: z.literal('plan'),
  /** ddl mode: the query to speed up; query mode: the original slow query the learner rewrites. */
  query: sqlText,
  check: z
    .object({
      mode: z.enum(['ddl', 'query']).default('ddl'),
      forbidSeqScan: z.array(z.string().min(1)).default([]),
      requireIndexOn: z.array(z.string().min(1)).default([]),
      maxCostRatio: z.number().positive().max(1).optional(),
    })
    .refine((c) => c.forbidSeqScan.length > 0 || c.requireIndexOn.length > 0 || c.maxCostRatio !== undefined, {
      message: 'нужно хотя бы одно условие: forbidSeqScan, requireIndexOn или maxCostRatio',
    }),
});

const choiceBase = {
  ...taskBase,
  options: z.array(z.string().min(1)).min(2).max(6),
  /** Indexes of correct options; this is the task's reference solution. */
  answer: z.array(z.number().int().nonnegative()).min(1),
  explanation: z.string().min(1),
};

const choiceTask = z.object({ ...choiceBase, type: z.literal('choice') });

const reviewTask = z.object({
  ...choiceBase,
  type: z.literal('review'),
  code: sqlText,
  codeLanguage: z.string().default('sql'),
  /** 1-based lines highlighted once the learner has answered. */
  lines: z.array(z.number().int().positive()).default([]),
});

// Git course: setup and solution are shell scripts for the Git sandbox (```sh setup / ```sh solution).
const gitTaskBase = {
  ...taskBase,
  shellSetup: z.string().default(''),
  shellSolution: z.string().trim().min(1),
};
/** Repository the check looks at; by default the directory where the setup script ends. */
const repoPath = z.string().regex(/^[~/]/, 'путь начинается с ~ или /').optional();
const pattern = z.object({ pattern: z.string().min(1), message: z.string().min(1) });

const graphTask = z.object({
  ...gitTaskBase,
  type: z.literal('graph'),
  check: z
    .object({
      repo: repoPath,
      /** Branches to compare; all branches of the reference result by default. */
      refs: z.array(z.string().min(1)).optional(),
      messages: z.enum(['exact', 'ignore']).default('exact'),
      head: z.boolean().default(true),
      tags: z.boolean().default(true),
      remotes: z.boolean().default(false),
    })
    .prefault({}),
});

const worktreeTask = z.object({
  ...gitTaskBase,
  type: z.literal('worktree'),
  check: z
    .object({
      repo: repoPath,
      /** Files whose content is compared; every file by default. */
      files: z.array(z.string().min(1)).optional(),
      index: z.boolean().default(true),
      untracked: z.boolean().default(true),
    })
    .prefault({}),
});

const commandsTask = z.object({
  ...gitTaskBase,
  type: z.literal('commands'),
  /** Regular expressions over the commands typed in the terminal (successful ones for `require`). */
  check: z.object({ require: z.array(pattern).min(1), forbid: z.array(pattern).default([]) }),
});

const hostingTask = z.object({
  ...gitTaskBase,
  type: z.literal('hosting'),
  check: z
    .object({
      project: z.string().regex(/^[\w.-]+\/[\w.-]+$/).optional(),
      branches: z.boolean().default(true),
      pulls: z.boolean().default(true),
      issues: z.boolean().default(true),
      releases: z.boolean().default(true),
      protections: z.boolean().default(true),
    })
    .prefault({}),
});

const ciTask = z.object({
  ...gitTaskBase,
  type: z.literal('ci'),
  check: z
    .object({
      project: z.string().regex(/^[\w.-]+\/[\w.-]+$/).optional(),
      /** Branch whose latest runs are compared; the default branch of the project by default. */
      branch: z.string().min(1).optional(),
    })
    .prefault({}),
});

export const taskSchema = z
  .discriminatedUnion('type', [resultTask, stateTask, schemaTask, planTask, choiceTask, reviewTask, graphTask, worktreeTask, commandsTask, hostingTask, ciTask])
  .superRefine((task, ctx) => {
    if (task.type !== 'choice' && task.type !== 'review') return;
    if (task.answer.some((i) => i >= task.options.length)) {
      ctx.addIssue({ code: 'custom', path: ['answer'], message: 'индекс ответа вне списка вариантов' });
    }
    if (new Set(task.options).size !== task.options.length) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'варианты ответа повторяются' });
    }
  });

export const lessonRefSchema = z.object({
  id: slug,
  file: z.string().regex(/\.md$/),
  /** Lesson ids that must be completed first. Defaults to the previous lesson of the world. */
  requires: z.array(slug).optional(),
});

export const worldSchema = z.object({
  id: slug,
  title: z.string().min(1),
  summary: z.string().min(1),
  /** World ids that must be completed first. Defaults to the previous world. */
  requires: z.array(slug).optional(),
  lessons: z.array(lessonRefSchema),
});

const taskType = z.enum(['result', 'state', 'schema', 'plan', 'choice', 'review', 'graph', 'worktree', 'commands', 'hosting', 'ci']);

export const badgeRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tasksSolved'), count: z.number().int().positive() }),
  z.object({ kind: z.literal('tasksOfType'), type: taskType, count: z.number().int().positive() }),
  z.object({ kind: z.literal('worldCompleted'), world: slug }),
  z.object({ kind: z.literal('streak'), days: z.number().int().min(2) }),
  z.object({ kind: z.literal('firstTry'), count: z.number().int().positive() }),
]);

export const badgeSchema = z.object({
  id: slug,
  title: z.string().min(1),
  description: z.string().min(1),
  /** Up to four characters drawn on the badge. */
  glyph: z.string().min(1).max(4),
  rule: badgeRuleSchema,
});

export const levelsSchema = z
  .array(z.object({ xp: z.number().int().nonnegative(), title: z.string().min(1) }))
  .min(2)
  .refine((levels) => levels[0].xp === 0, { message: 'первый уровень начинается с 0 XP' })
  .refine((levels) => levels.every((l, i) => i === 0 || l.xp > levels[i - 1].xp), {
    message: 'пороги уровней должны возрастать',
  });

export const manifestSchema = z.object({
  id: slug,
  title: z.string().min(1),
  engine: z.enum(['postgres', 'git']),
  datasets: z.record(slug, z.string().regex(/\.sql$/)).default({}),
  errors: z.string().regex(/\.json$/),
  /** One or two sentences for the course card in the hub. */
  description: z.string().min(1),
  worlds: z.array(worldSchema).min(1),
  levels: levelsSchema,
  badges: z.array(badgeSchema).default([]),
  placement: z.string().regex(/\.json$/).optional(),
  onboarding: z.string().regex(/\.json$/).optional(),
  /** Failed checks after which the reference solution may be shown; by default after the first attempt. */
  solutionAfterAttempts: z.number().int().positive().optional(),
});

/** Cross-course settings: which courses the hub shows (in order) and the shared level ladder. */
export const platformSchema = z.object({
  courses: z.array(slug).min(1),
  levels: levelsSchema,
});

export const placementSchema = z
  .object({
    /** Lesson-format Markdown file with the questions. */
    questions: z.string().regex(/\.md$/),
    /** Correct answers needed to pass a block. */
    passThreshold: z.number().int().positive(),
    blocks: z
      .array(z.object({ id: slug, title: z.string().min(1), questions: z.array(slug).min(1), unlocks: z.array(slug) }))
      .min(1),
  })
  .refine((p) => p.blocks.every((b) => b.questions.length >= p.passThreshold), {
    message: 'в каждом блоке должно быть не меньше вопросов, чем passThreshold',
  });

const cell = z.union([z.string(), z.number(), z.null()]);
const titled = { title: z.string().min(1), text: z.string().min(1) };
const stepBase = { id: slug, ...titled, explanation: z.string().min(1) };

export const onboardingSchema = z.object({
  welcome: z.object({
    title: z.string().min(1),
    subtitle: z.string().min(1),
    beginner: z.object(titled),
    experienced: z.object(titled),
  }),
  intro: z.object({ title: z.string().min(1), paragraphs: z.array(z.string().min(1)).min(1) }),
  tables: z.record(z.string(), z.object({ columns: z.array(z.string().min(1)).min(1), rows: z.array(z.array(cell)).min(1) })),
  steps: z
    .array(
      z.discriminatedUnion('kind', [
        z.object({ ...stepBase, kind: z.literal('pickRow'), table: z.string(), answer: z.number().int().nonnegative() }),
        z.object({ ...stepBase, kind: z.literal('pickColumn'), table: z.string(), answer: z.string().min(1) }),
        z.object({
          ...stepBase,
          kind: z.literal('link'),
          orders: z.array(z.object({ id: z.number().int(), story: z.string().min(1), customer: z.number().int() })).min(1),
        }),
      ]),
    )
    .min(1),
  /** The first typed query; a result task. */
  firstQuery: z.record(z.string(), z.unknown()),
  outro: z.object(titled),
});

/** SQLSTATE (or its two-character class) → hint shown under PostgreSQL's own message. */
export const errorHintsSchema = z.record(z.string().regex(/^[0-9A-Z]{2}([0-9A-Z]{3})?$/), z.string().min(1));

/** Git course: a pattern over terminal error lines → explanation shown under git's own message. */
export const terminalHintsSchema = z.array(z.object({ pattern: z.string().min(1), hint: z.string().min(1) }));

export type TaskInput = z.input<typeof taskSchema>;
export type ParsedTask = z.output<typeof taskSchema>;
export type Badge = z.output<typeof badgeSchema>;
export type Level = z.output<typeof manifestSchema>['levels'][number];
export type OnboardingData = z.output<typeof onboardingSchema>;
export type OnboardingStep = OnboardingData['steps'][number];
