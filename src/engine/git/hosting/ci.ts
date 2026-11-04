import { parse, YAMLParseError } from 'yaml';
import type { Files } from '../objects';
import { runLine } from '../shell';
import { World } from '../world';
import type { Hosting, Project } from './model';

/**
 * CI interpreter for the sandbox hosting. Workflows (GitHub Actions) and pipelines (GitLab CI) are read
 * from the pushed commit and their shell steps run in a fresh sandbox world, never on the real machine.
 */
export type Status = 'success' | 'failure' | 'skipped' | 'manual';

export interface Step {
  name: string;
  status: Status;
  log: string[];
}

export interface Job {
  name: string;
  stage?: string;
  status: Status;
  steps: Step[];
}

export interface Run {
  id: number;
  workflow: string;
  file: string;
  event: 'push' | 'pull_request';
  branch: string;
  sha: string;
  pr?: number;
  title: string;
  status: 'success' | 'failure';
  jobs: Job[];
}

export interface CiEvent {
  kind: 'push' | 'pull_request';
  branch: string;
  sha: string;
  /** Target branch of a pull request. */
  base?: string;
  pr?: number;
}

type Env = Record<string, string>;
const asList = (v: unknown): string[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v.map(String) : [String(v)]);

/** Branch filters: "*" stops at "/", "**" crosses it. */
export function branchMatches(pattern: string, branch: string): boolean {
  const re = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*');
  return new RegExp(`^${re}$`).test(branch);
}

/** `$VAR` and `${VAR}` outside single quotes, as a shell would expand them. */
export function expandVars(line: string, env: Env): string {
  return line
    .split(/('[^']*')/)
    .map((part) => (part.startsWith("'") ? part : part.replace(/\$\{(\w+)\}|\$(\w+)/g, (_, a: string, b: string) => env[a ?? b] ?? '')))
    .join('');
}

/** Runs a script line by line in the runner; stops at the first failing line like `bash -e`. */
function runScript(world: World, lines: string[], env: Env, log: string[], echo: boolean): number {
  for (const raw of lines) {
    const line = expandVars(raw, env).trim();
    if (!line || line.startsWith('#')) continue;
    if (echo) log.push(`$ ${line}`);
    const result = runLine(world, line);
    log.push(...result.lines.map((l) => l.text));
    if (result.exit !== 0) return result.exit;
  }
  return 0;
}

function runnerWorld(project: Project, files: Files | null): World {
  const world = new World({ name: 'runner', email: 'runner@example.com' });
  const dir = `/home/runner/work/${project.name}`;
  world.mkdirp(dir);
  world.cwd = dir;
  if (files) for (const [path, content] of Object.entries(files)) world.writeFile(`${dir}/${path}`, content);
  return world;
}

// ---------------------------------------------------------------- GitHub Actions

interface Contexts {
  github: Env;
  env: Env;
  runner: Env;
}

function lookup(ctx: Contexts, path: string): string {
  const [head, ...rest] = path.split('.');
  const scope = (ctx as unknown as Record<string, Env>)[head];
  return scope?.[rest.join('.')] ?? '';
}

/** A small subset of GitHub expressions: contexts, 'strings', ==, !=, &&, ||, !, status functions. */
export function evalExpression(expr: string, ctx: Contexts, jobFailed: boolean): boolean | string {
  const text = expr.trim().replace(/^\$\{\{([\s\S]*)\}\}$/, '$1').trim();
  const value = (term: string): string | boolean => {
    const t = term.trim();
    if (t === 'success()') return !jobFailed;
    if (t === 'failure()') return jobFailed;
    if (t === 'always()') return true;
    if (t === 'cancelled()') return false;
    if (t === 'true' || t === 'false') return t === 'true';
    if (t.startsWith('!')) return !truthy(value(t.slice(1)));
    const str = /^'(.*)'$/.exec(t);
    if (str) return str[1];
    return lookup(ctx, t);
  };
  const truthy = (v: string | boolean) => v !== false && v !== '';
  const compare = (part: string): string | boolean => {
    const m = /^(.*?)(==|!=)(.*)$/.exec(part);
    if (!m) return value(part);
    const equal = String(value(m[1])) === String(value(m[3]));
    return m[2] === '==' ? equal : !equal;
  };
  const ors = text.split('||').map((o) => o.split('&&').map(compare));
  if (ors.length === 1 && ors[0].length === 1) return ors[0][0];
  return ors.some((ands) => ands.every(truthy));
}

const passes = (v: boolean | string) => v !== false && v !== '';

function substitute(text: string, ctx: Contexts): string {
  return text.replace(/\$\{\{([\s\S]*?)\}\}/g, (_, e: string) => String(evalExpression(e, ctx, false)));
}

function githubTriggered(on: unknown, event: CiEvent): boolean {
  const name = event.kind;
  if (typeof on === 'string') return on === name;
  if (Array.isArray(on)) return on.map(String).includes(name);
  if (!on || typeof on !== 'object' || !(name in on)) return false;
  const filter = (on as Record<string, unknown>)[name] as Record<string, unknown> | null;
  const branch = name === 'pull_request' ? event.base ?? '' : event.branch;
  if (!filter) return true;
  const include = asList(filter.branches);
  const exclude = asList(filter['branches-ignore']);
  if (include.length && !include.some((p) => branchMatches(p, branch))) return false;
  if (exclude.some((p) => branchMatches(p, branch))) return false;
  return true;
}

function invalid(file: string, workflow: string, message: string, event: CiEvent, title: string): Run {
  return {
    id: 0,
    workflow,
    file,
    event: event.kind,
    branch: event.branch,
    sha: event.sha,
    pr: event.pr,
    title,
    status: 'failure',
    jobs: [{ name: 'Invalid workflow file', status: 'failure', steps: [{ name: 'Разбор файла', status: 'failure', log: [`Invalid workflow file: ${file}`, message] }] }],
  };
}

function runGithubWorkflow(hosting: Hosting, project: Project, file: string, source: string, files: Files, event: CiEvent, title: string): Run | null {
  let doc: Record<string, unknown>;
  try {
    doc = parse(source) as Record<string, unknown>;
  } catch (e) {
    const where = e instanceof YAMLParseError && e.linePos ? `#L${e.linePos[0].line}` : '';
    return invalid(`${file}${where}`, file, (e as Error).message.split('\n')[0], event, title);
  }
  if (!doc || typeof doc !== 'object') return invalid(file, file, 'The workflow is empty.', event, title);
  const workflow = typeof doc.name === 'string' ? doc.name : file;
  if (!('on' in doc)) return invalid(file, workflow, "Required property is missing: 'on'", event, title);
  if (!githubTriggered(doc.on, event)) return null;
  const jobs = doc.jobs as Record<string, Record<string, unknown>> | undefined;
  if (!jobs || typeof jobs !== 'object' || !Object.keys(jobs).length) return invalid(file, workflow, "Required property is missing: 'jobs'", event, title);

  const ref = event.kind === 'pull_request' ? `refs/pull/${event.pr}/merge` : `refs/heads/${event.branch}`;
  const github: Env = {
    ref,
    ref_name: event.kind === 'pull_request' ? `${event.pr}/merge` : event.branch,
    sha: event.sha,
    event_name: event.kind,
    actor: hosting.user,
    repository: `${project.owner}/${project.name}`,
    head_ref: event.kind === 'pull_request' ? event.branch : '',
    base_ref: event.base ?? '',
  };
  const baseEnv: Env = {
    CI: 'true',
    GITHUB_ACTIONS: 'true',
    GITHUB_REF: ref,
    GITHUB_SHA: event.sha,
    GITHUB_EVENT_NAME: event.kind,
    GITHUB_REPOSITORY: github.repository,
    GITHUB_ACTOR: github.actor,
    RUNNER_OS: 'Linux',
    ...Object.fromEntries(Object.entries((doc.env as Env) ?? {}).map(([k, v]) => [k, String(v)])),
  };

  const results = new Map<string, Job>();
  const pending = Object.keys(jobs);
  while (pending.length) {
    const ready = pending.find((id) => asList(jobs[id]?.needs).every((n) => results.has(n) || !(n in jobs)));
    if (!ready) break;
    pending.splice(pending.indexOf(ready), 1);
    const spec = jobs[ready] ?? {};
    const name = typeof spec.name === 'string' ? spec.name : ready;
    const job: Job = { name, status: 'success', steps: [] };
    results.set(ready, job);
    const env: Env = { ...baseEnv, ...Object.fromEntries(Object.entries((spec.env as Env) ?? {}).map(([k, v]) => [k, String(v)])) };
    const ctx: Contexts = { github, env, runner: { os: 'Linux' } };
    if (asList(spec.needs).some((n) => results.get(n)?.status !== 'success')) {
      job.status = 'skipped';
      continue;
    }
    if (spec.if !== undefined && !passes(evalExpression(String(spec.if), ctx, false))) {
      job.status = 'skipped';
      continue;
    }
    if (!spec['runs-on']) {
      job.status = 'failure';
      job.steps.push({ name: 'Подготовка', status: 'failure', log: [`Job '${ready}' has no 'runs-on' — неизвестно, на какой машине его запускать.`] });
      continue;
    }
    const world = runnerWorld(project, null);
    job.steps.push({ name: 'Set up job', status: 'success', log: [`Runner: ${String(spec['runs-on'])} (учебная песочница)`] });
    let failed = false;
    for (const [i, s] of ((spec.steps as Record<string, unknown>[]) ?? []).entries()) {
      const run = typeof s.run === 'string' ? s.run : undefined;
      const uses = typeof s.uses === 'string' ? s.uses : undefined;
      const stepName = typeof s.name === 'string' ? substitute(s.name, ctx) : run ? `Run ${run.split('\n')[0]}` : uses ?? `Step ${i + 1}`;
      const step: Step = { name: stepName, status: 'success', log: [] };
      job.steps.push(step);
      const condition = s.if === undefined ? !failed : evalExpression(String(s.if), ctx, failed);
      if (!passes(condition)) {
        step.status = 'skipped';
        continue;
      }
      const stepEnv: Env = { ...env, ...Object.fromEntries(Object.entries((s.env as Env) ?? {}).map(([k, v]) => [k, String(v)])) };
      if (uses) {
        const action = uses.split('@')[0];
        const options = (s.with as Record<string, unknown>) ?? {};
        if (action === 'actions/checkout') {
          for (const [path, content] of Object.entries(files)) world.writeFile(`${world.cwd}/${path}`, content);
          step.log.push(`Checking out ${event.sha.slice(0, 7)} into ${world.cwd}`);
        } else if (action === 'actions/setup-node' || action === 'actions/setup-python' || action === 'actions/setup-java') {
          const tool = action.slice('actions/setup-'.length);
          step.log.push(`${tool} ${String(options[`${tool}-version`] ?? 'latest')} готов (учебная песочница)`);
        } else {
          step.log.push(`Действие ${uses} в учебной песочнице не выполняется, шаг засчитан как пройденный.`);
        }
        continue;
      }
      if (!run) {
        step.status = 'failure';
        step.log.push("Step has neither 'run' nor 'uses'.");
        failed = true;
        continue;
      }
      const code = runScript(world, substitute(run, { ...ctx, env: stepEnv }).split('\n'), stepEnv, step.log, false);
      if (code !== 0) {
        step.status = 'failure';
        step.log.push(`Error: Process completed with exit code ${code}.`);
        failed = true;
      }
    }
    job.status = failed ? 'failure' : 'success';
  }
  for (const id of pending) results.set(id, { name: id, status: 'skipped', steps: [] });
  const list = [...results.values()];
  return {
    id: 0,
    workflow,
    file,
    event: event.kind,
    branch: event.branch,
    sha: event.sha,
    pr: event.pr,
    title,
    status: list.some((j) => j.status === 'failure') ? 'failure' : 'success',
    jobs: list,
  };
}

// ---------------------------------------------------------------- GitLab CI

const RESERVED = new Set(['image', 'services', 'stages', 'variables', 'default', 'workflow', 'include', 'before_script', 'after_script', 'cache']);

/** `$CI_COMMIT_BRANCH == "main"` style conditions joined with && and ||. */
function gitlabCondition(expr: string, env: Env): boolean {
  return expr.split('||').some((ors) =>
    ors.split('&&').every((part) => {
      const m = /^\s*(\$\w+)\s*(==|!=)\s*(?:"([^"]*)"|'([^']*)'|(\$\w+))\s*$/.exec(part);
      if (!m) {
        const v = /^\s*\$(\w+)\s*$/.exec(part);
        return v ? Boolean(env[v[1]]) : false;
      }
      const left = env[m[1].slice(1)] ?? '';
      const right = m[5] ? env[m[5].slice(1)] ?? '' : (m[3] ?? m[4] ?? '');
      return m[2] === '==' ? left === right : left !== right;
    }),
  );
}

function gitlabJobApplies(spec: Record<string, unknown>, env: Env, event: CiEvent): 'run' | 'manual' | 'skip' {
  if (Array.isArray(spec.rules)) {
    for (const rule of spec.rules as Record<string, unknown>[]) {
      if (rule.if === undefined || gitlabCondition(String(rule.if), env)) {
        if (rule.when === 'never') return 'skip';
        return rule.when === 'manual' ? 'manual' : 'run';
      }
    }
    return 'skip';
  }
  if (event.kind === 'pull_request') return asList(spec.only).includes('merge_requests') ? 'run' : 'skip';
  const only = asList(spec.only);
  const except = asList(spec.except);
  if (only.length && !only.some((o) => o === 'branches' || branchMatches(o, event.branch))) return 'skip';
  if (except.some((o) => branchMatches(o, event.branch))) return 'skip';
  return spec.when === 'manual' ? 'manual' : 'run';
}

function runGitlabPipeline(hosting: Hosting, project: Project, source: string, files: Files, event: CiEvent, title: string): Run | null {
  const file = '.gitlab-ci.yml';
  let doc: Record<string, unknown>;
  try {
    doc = parse(source) as Record<string, unknown>;
  } catch (e) {
    const where = e instanceof YAMLParseError && e.linePos ? ` (строка ${e.linePos[0].line})` : '';
    return invalid(file, 'pipeline', `This GitLab CI configuration is invalid: ${(e as Error).message.split('\n')[0]}${where}`, event, title);
  }
  if (!doc || typeof doc !== 'object') return invalid(file, 'pipeline', 'This GitLab CI configuration is invalid: empty file', event, title);
  const stages = ['.pre', ...(asList(doc.stages).length ? asList(doc.stages) : ['build', 'test', 'deploy']), '.post'];
  const env: Env = {
    CI: 'true',
    GITLAB_CI: 'true',
    CI_PIPELINE_SOURCE: event.kind === 'push' ? 'push' : 'merge_request_event',
    CI_COMMIT_SHA: event.sha,
    CI_COMMIT_SHORT_SHA: event.sha.slice(0, 8),
    CI_COMMIT_REF_NAME: event.branch,
    CI_DEFAULT_BRANCH: hosting.defaultBranch(project),
    CI_PROJECT_NAME: project.name,
    CI_PROJECT_PATH: `${project.owner}/${project.name}`,
    ...(event.kind === 'push'
      ? { CI_COMMIT_BRANCH: event.branch }
      : { CI_MERGE_REQUEST_IID: String(event.pr), CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: event.branch, CI_MERGE_REQUEST_TARGET_BRANCH_NAME: event.base ?? '' }),
    ...Object.fromEntries(Object.entries((doc.variables as Env) ?? {}).map(([k, v]) => [k, String(v)])),
  };
  const defaults = (doc.default as Record<string, unknown>) ?? {};
  const jobs = Object.entries(doc).filter(([k, v]) => !RESERVED.has(k) && !k.startsWith('.') && v && typeof v === 'object') as [string, Record<string, unknown>][];
  for (const [name, spec] of jobs) {
    if (!spec.script) return invalid(file, 'pipeline', `This GitLab CI configuration is invalid: jobs:${name} config should implement the script:, run:, or trigger: keyword`, event, title);
    const stage = String(spec.stage ?? 'test');
    if (!stages.includes(stage)) return invalid(file, 'pipeline', `This GitLab CI configuration is invalid: ${name} job: chosen stage ${stage} does not exist; available stages are ${stages.join(', ')}`, event, title);
  }
  const selected = jobs.map(([name, spec]) => ({ name, spec, mode: gitlabJobApplies(spec, env, event) })).filter((j) => j.mode !== 'skip');
  if (!selected.length) return null;

  const results: Job[] = [];
  let blocked = false;
  for (const stage of stages) {
    let stageFailed = false;
    for (const { name, spec, mode } of selected.filter((j) => String(j.spec.stage ?? 'test') === stage)) {
      const job: Job = { name, stage, status: 'success', steps: [] };
      results.push(job);
      if (blocked) {
        job.status = 'skipped';
        continue;
      }
      if (mode === 'manual') {
        job.status = 'manual';
        continue;
      }
      const log: string[] = [];
      if (spec.image ?? doc.image ?? defaults.image) log.push(`Using docker image ${String(spec.image ?? doc.image ?? defaults.image)} (учебная песочница: образ не загружается)`);
      log.push(`Checking out ${event.sha.slice(0, 8)} as ${event.branch}...`);
      const world = runnerWorld(project, files);
      const jobEnv = { ...env, CI_JOB_NAME: name, CI_JOB_STAGE: stage, ...Object.fromEntries(Object.entries((spec.variables as Env) ?? {}).map(([k, v]) => [k, String(v)])) };
      const before = asList(spec.before_script ?? defaults.before_script ?? doc.before_script);
      const code = runScript(world, [...before, ...asList(spec.script)], jobEnv, log, true);
      const after = asList(spec.after_script ?? defaults.after_script ?? doc.after_script);
      if (after.length) runScript(world, after, jobEnv, log, true);
      if (code !== 0) {
        log.push(`ERROR: Job failed: exit code ${code}`);
        job.status = 'failure';
        if (!spec.allow_failure) stageFailed = true;
      } else log.push('Job succeeded');
      job.steps.push({ name, status: job.status, log });
    }
    if (stageFailed) blocked = true;
  }
  return {
    id: 0,
    workflow: 'pipeline',
    file,
    event: event.kind,
    branch: event.branch,
    sha: event.sha,
    pr: event.pr,
    title,
    status: results.some((j) => j.status === 'failure' && !selected.find((s) => s.name === j.name)?.spec.allow_failure) ? 'failure' : 'success',
    jobs: results,
  };
}

/** Starts every workflow (GitHub) or the pipeline (GitLab) that reacts to the event. */
export function runPipelines(hosting: Hosting, project: Project, event: CiEvent): Run[] {
  const commit = project.repo.commits.get(event.sha);
  if (!commit) return [];
  const files = commit.files;
  const title = event.kind === 'pull_request' ? project.pulls.find((p) => p.number === event.pr)?.title ?? '' : commit.message.split('\n')[0];
  const runs: Run[] = [];
  if (hosting.flavor === 'github') {
    for (const path of Object.keys(files).sort()) {
      if (!/^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) continue;
      const run = runGithubWorkflow(hosting, project, path, files[path], files, event, title);
      if (run) runs.push(run);
    }
  } else if (files['.gitlab-ci.yml'] !== undefined) {
    const run = runGitlabPipeline(hosting, project, files['.gitlab-ci.yml'], files, event, title);
    if (run) runs.push(run);
  }
  runs.forEach((r, i) => (r.id = project.runs.length + i + 1));
  return runs;
}
