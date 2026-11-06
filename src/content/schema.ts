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
      /** Upstream branches (`git push -u`, `branch -u`) must match too. */
      upstreams: z.boolean().default(false),
      /** Working-tree files that must match the reference (present with the same content, or absent). */
      files: z.array(z.string().min(1)).default([]),
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
      /** The stash list (descriptions in order) must match too. */
      stash: z.boolean().default(false),
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
      /** Titles of pull/merge requests, issues and releases must match exactly (when the prompt names them). */
      titles: z.boolean().default(false),
      /** Tags of the local repository (e.g. fetched after a release) must match too. */
      localTags: z.boolean().default(false),
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
      /** Files at the branch tip that must equal the reference (YAML and JSON are compared by meaning). */
      files: z.array(z.string().min(1)).default([]),
    })
    .prefault({}),
});

// API course: requests are written as text (see src/engine/api/http.ts) in ```http starter / solution blocks.
const apiTaskBase = {
  ...taskBase,
  /** Virtual server of the task (manifest `servers`); requests with a relative URL go there. */
  server: slug.optional(),
  httpStarter: z.string().default('GET /'),
  httpSolution: z.string().trim().min(1),
};

const requestTask = z.object({
  ...apiTaskBase,
  type: z.literal('request'),
  check: z
    .object({
      /** exact: the same query parameters; ignore: only method and path matter. */
      query: z.enum(['exact', 'ignore']).default('exact'),
      /** Headers that must be present with the reference values (names are case-insensitive). */
      headers: z.array(z.string().min(1)).default([]),
      /** json: the same JSON value; text: the same text; ignore: any body. */
      body: z.enum(['json', 'text', 'ignore']).default('json'),
    })
    .prefault({}),
});

const responseTask = z.object({
  ...apiTaskBase,
  type: z.literal('response'),
  /** Requests that run on a fresh server before the learner's one (separated by a line `###`). */
  httpSetup: z.string().default(''),
  check: z
    .object({
      status: z.boolean().default(true),
      /** Response headers that must match the reference. */
      headers: z.array(z.string().min(1)).default([]),
      body: z.enum(['json', 'ignore']).default('json'),
      /** Collections of the server whose data must match after the request. */
      state: z.array(z.string().min(1)).default([]),
    })
    .prefault({}),
});

const corsConfig = z.object({
  allowOrigins: z.array(z.string()).default([]),
  allowMethods: z.array(z.string()).default(['GET']),
  allowHeaders: z.array(z.string()).default([]),
  allowCredentials: z.boolean().default(false),
  exposeHeaders: z.array(z.string()).default([]),
  maxAge: z.number().int().nonnegative().optional(),
});

const corsTask = z.object({
  ...apiTaskBase,
  type: z.literal('cors'),
  /** No reference request here: the reference is the settings below. */
  httpSolution: z.string().default('GET /'),
  /** The learner edits the server's CORS settings; ```json starter / solution hold them. */
  jsonStarter: z.string().default('{}'),
  jsonSolution: z.string().trim().min(1),
  /** What the frontend page does: fetch(request) from origin. */
  fetch: z.object({ origin: z.string().regex(/^https?:\/\/[^/]+$/), request: z.string().min(1), credentials: z.boolean().default(false) }),
  check: z
    .object({
      /** allowed: the page must read the answer; blocked: the browser must stop it. */
      expect: z.enum(['allowed', 'blocked']).default('allowed'),
      /** Other pages that must stay blocked (not too permissive). */
      mustBlock: z.array(z.object({ origin: z.string(), request: z.string().optional(), credentials: z.boolean().default(false) })).default([]),
    })
    .prefault({}),
});

const graphqlTask = z.object({
  ...apiTaskBase,
  type: z.literal('graphql'),
  httpSolution: z.string().default('POST /graphql'),
  graphqlStarter: z.string().default('{\n  \n}'),
  graphqlSolution: z.string().trim().min(1),
  /** Variables of the query, as JSON values. */
  variables: z.record(z.string(), z.unknown()).default({}),
  check: z
    .object({
      /** The learner's query may select only the fields the reference selects (no over-fetching). */
      exactFields: z.boolean().default(false),
      /** Collections that must match the reference after a mutation. */
      state: z.array(z.string().min(1)).default([]),
    })
    .prefault({}),
});

const protoTask = z.object({
  ...apiTaskBase,
  type: z.literal('proto'),
  httpSolution: z.string().default('POST /'),
  protoStarter: z.string().default('syntax = "proto3";\n'),
  protoSolution: z.string().trim().min(1),
  check: z
    .object({
      /** Field numbers must match the reference (they are the wire format). */
      fieldNumbers: z.boolean().default(true),
    })
    .prefault({}),
});

/** FastAPI tasks: the learner writes main.py; hidden requests (```http tests) go to it and to the reference app. */
const fastapiTask = z.object({
  ...apiTaskBase,
  type: z.literal('fastapi'),
  /** The composer's starting request (sent to the learner's own app). */
  httpSolution: z.string().default('GET /'),
  pythonStarter: z.string().default(''),
  pythonSolution: z.string().trim().min(1),
  /** Test requests separated by lines `###`; the answers of the reference app are the expected ones. */
  httpTests: z.string().trim().min(1),
  check: z
    .object({
      body: z.enum(['json', 'ignore']).default('json'),
      /** Response headers that must match the reference. */
      headers: z.array(z.string().min(1)).default([]),
      /** Rules on the code itself: `pattern` (a regular expression) must be found, or with `forbid` must not. */
      code: z.array(z.object({ pattern: z.string().min(1), message: z.string().min(1), forbid: z.boolean().default(false) })).default([]),
    })
    .prefault({}),
});

export const levelEnum = z.enum(['base', 'core', 'hard']);

/**
 * Drill tasks: a statement template (the prompt) over a generator's fields; ```md explain is the step-by-step
 * template, ```python starter the scratch code template. Hints are templates too, exactly three.
 */
const drillTask = z.object({
  ...taskBase,
  hints: z.array(z.string().min(1)).length(3),
  type: z.literal('drill'),
  generator: z.string().regex(/^g\d{2}$/),
  shape: slug.default('main'),
  levels: z.array(levelEnum).min(1).default(['base', 'core', 'hard']),
  explain: z.string().trim().min(1),
  pythonStarter: z.string().default(''),
  /** Word lists for table data (e.g. names in tables). */
  vocab: z.record(z.string(), z.array(z.string().min(1))).default({}),
  /** Table and column captions keyed `t1`, `t1.c2`. */
  labels: z.record(z.string(), z.string()).default({}),
});

export const corsConfigSchema = corsConfig;

export const taskSchema = z
  .discriminatedUnion('type', [resultTask, stateTask, schemaTask, planTask, choiceTask, reviewTask, graphTask, worktreeTask, commandsTask, hostingTask, ciTask, requestTask, responseTask, corsTask, graphqlTask, protoTask, fastapiTask, drillTask])
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

const taskType = z.enum(['result', 'state', 'schema', 'plan', 'choice', 'review', 'graph', 'worktree', 'commands', 'hosting', 'ci', 'request', 'response', 'cors', 'graphql', 'proto', 'fastapi', 'drill']);

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
  engine: z.enum(['postgres', 'git', 'api', 'drill']),
  datasets: z.record(slug, z.string().regex(/\.sql$/)).default({}),
  errors: z.string().regex(/\.json$/),
  /** One or two sentences for the course card in the hub. */
  description: z.string().min(1),
  worlds: z.array(worldSchema).min(1),
  levels: levelsSchema,
  badges: z.array(badgeSchema).default([]),
  placement: z.string().regex(/\.json$/).optional(),
  onboarding: z.string().regex(/\.json$/).optional(),
  /** API course: virtual servers (JSON files, see src/engine/api/server.ts) by name. */
  servers: z.record(slug, z.string().regex(/\.json$/)).default({}),
  /** Failed checks after which the reference solution may be shown; by default after the first attempt. */
  solutionAfterAttempts: z.number().int().positive().optional(),
  /** Drill course: the file with the DrillConfig. */
  drill: z.string().regex(/\.json$/).optional(),
});

const nonEmpty = z.string().min(1);
const perLevel = <T extends z.ZodType>(item: T) => z.object({ base: item, core: item, hard: item });

/** Drill course settings (drill.json). */
export const drillConfigSchema = z.object({
  numbers: z.array(z.object({ n: z.number().int().min(1).max(21), lesson: slug, minutes: z.number().positive() })).min(1),
  /** XP per solved instance before the hint penalty. */
  xp: perLevel(z.number().int().nonnegative()),
  /** XP-earning solves per number per local day. */
  dailyXp: z.number().int().positive().default(5),
  set: z.object({ minutes: z.number().int().positive(), level: levelEnum.default('core') }),
  labels: z.object({
    levels: perLevel(nonEmpty),
    modes: z.object({ pick: nonEmpty, full: nonEmpty, weak: nonEmpty }),
    /** Tile prefix. */
    number: nonEmpty,
    score: nonEmpty,
    /** Placeholder for two numbers. */
    pair: nonEmpty,
  }),
});

/** Cross-course settings: which courses the hub shows (in order) and the shared level ladder. */
/** Badges for progress across all courses of the platform. */
export const platformBadgeSchema = badgeSchema.extend({
  rule: z.object({ kind: z.literal('everyCourse'), tasks: z.number().int().positive() }),
});

export const platformSchema = z.object({
  courses: z.array(slug).min(1),
  levels: levelsSchema,
  badges: z.array(platformBadgeSchema).default([]),
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

/** Onboarding of the Git course: concept cards, then a first real command in a small sandbox. */
export const gitOnboardingSchema = z.object({
  welcome: z.object({
    title: z.string().min(1),
    subtitle: z.string().min(1),
    beginner: z.object(titled),
    experienced: z.object(titled),
  }),
  intro: z.object({ title: z.string().min(1), paragraphs: z.array(z.string().min(1)).min(1) }),
  steps: z
    .array(
      z.object({
        id: slug,
        ...titled,
        options: z.array(z.string().min(1)).min(2).max(4),
        answer: z.number().int().nonnegative(),
        explanation: z.string().min(1),
      }),
    )
    .min(1),
  /** A Git task (graph or worktree) the beginner solves in the terminal. */
  firstTask: z.record(z.string(), z.unknown()),
  outro: z.object(titled),
});

/**
 * SQLSTATE (or its two-character class) → hint shown under PostgreSQL's own message; in the API course,
 * an HTTP status code → explanation shown with the response.
 */
export const errorHintsSchema = z.record(z.string().regex(/^([0-9A-Z]{2}([0-9A-Z]{3})?|[1-5]\d\d)$/), z.string().min(1));

/** Git course: a pattern over terminal error lines → explanation shown under git's own message. */
export const terminalHintsSchema = z.array(z.object({ pattern: z.string().min(1), hint: z.string().min(1) }));

const fieldSpec = z.object({
  type: z.enum(['string', 'integer', 'number', 'boolean', 'array', 'object']),
  required: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  minLength: z.number().int().optional(),
  maxLength: z.number().int().optional(),
  enum: z.array(z.union([z.string(), z.number()])).optional(),
});

/** A virtual server of the API course. */
export const serverDefSchema = z.object({
  baseUrl: z.string().regex(/^https?:\/\/[^/]+$/),
  collections: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))).default({}),
  routes: z
    .array(
      z.object({
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']),
        path: z.string().regex(/^\//),
        action: z.enum(['list', 'get', 'create', 'replace', 'update', 'delete', 'static']),
        collection: z.string().optional(),
        filters: z.array(z.string()).optional(),
        sort: z.boolean().optional(),
        paginate: z.boolean().optional(),
        body: z.record(z.string(), fieldSpec).optional(),
        query: z.record(z.string(), fieldSpec).optional(),
        unique: z.string().optional(),
        auth: z.boolean().optional(),
        parent: z.object({ collection: z.string().min(1), field: z.string().min(1) }).optional(),
        respond: z.object({ status: z.number().int(), body: z.unknown().optional(), headers: z.record(z.string(), z.string()).optional() }).optional(),
        delay: z.number().int().nonnegative().optional(),
      }),
    )
    .min(1),
  auth: z.object({ tokens: z.array(z.string()).optional(), apiKeys: z.array(z.string()).optional() }).optional(),
  cors: corsConfig.optional(),
  rateLimit: z.number().int().positive().optional(),
  /** A GraphQL schema over the same collections (file next to the server). */
  graphqlFile: z.string().regex(/\.graphql$/).optional(),
  /** A .proto file describing gRPC services over the same collections. */
  protoFile: z.string().regex(/\.proto$/).optional(),
});

export type TaskInput = z.input<typeof taskSchema>;
export type ParsedTask = z.output<typeof taskSchema>;
export type DrillTask = Extract<ParsedTask, { type: 'drill' }>;
export type DrillConfig = z.output<typeof drillConfigSchema>;
export type Badge =z.output<typeof badgeSchema>;
export type PlatformBadge = z.output<typeof platformBadgeSchema>;
export type Level = z.output<typeof manifestSchema>['levels'][number];
export type OnboardingData = z.output<typeof onboardingSchema>;
export type OnboardingStep = OnboardingData['steps'][number];
export type GitOnboardingData = z.output<typeof gitOnboardingSchema>;
