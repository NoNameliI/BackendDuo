import { relativePath, resolvePath, type Repo, type World } from '../world';

export interface Ctx {
  world: World;
  out: (text: string) => void;
  err: (text: string) => void;
}

/** Exit code of a git command: 0 success, 1 "nothing to do"/errors, 128 fatal. */
export type Command = (ctx: Ctx, argv: string[]) => number;

export function fatal(ctx: Ctx, message: string): number {
  ctx.err(`fatal: ${message}`);
  return 128;
}

export function requireRepo(ctx: Ctx): Repo | null {
  const repo = ctx.world.repoAt(ctx.world.cwd);
  if (!repo) ctx.err('fatal: not a git repository (or any of the parent directories): .git');
  return repo ?? null;
}

/** Repository-relative path of a command-line path ("" for the repository root), or null when outside. */
export function repoPath(ctx: Ctx, repo: Repo, arg: string): string | null {
  const abs = resolvePath(ctx.world.cwd, arg);
  if (abs === repo.root) return '';
  if (!abs.startsWith(`${repo.root}/`)) return null;
  return abs.slice(repo.root.length + 1);
}

/** How a repository-relative path is printed for the current directory. */
export function shownPath(ctx: Ctx, repo: Repo, path: string): string {
  return ctx.world.cwd === repo.root ? path : relativePath(ctx.world.cwd, `${repo.root}/${path}`);
}

const GLOB = /[*?[]/;

function globRegex(spec: string): RegExp {
  const body = spec
    .split('')
    .map((c) => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.+^${}()|\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${body}$`);
}

/** Pathspec match: "" (root) or "." match everything, a directory matches its contents, globs are allowed. */
export function matchesPathspec(spec: string, path: string): boolean {
  if (spec === '' || spec === '.') return true;
  if (GLOB.test(spec)) return globRegex(spec).test(path);
  return path === spec || path.startsWith(`${spec}/`);
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** `-q`: drops progress messages but keeps an error and everything printed after it. */
export function quiet(ctx: Ctx): Ctx {
  let failed = false;
  const pass = (write: (text: string) => void) => (text: string) => {
    if (/^(fatal|error):/.test(text)) failed = true;
    if (failed) write(text);
  };
  return { ...ctx, out: pass(ctx.out), err: pass(ctx.err) };
}
