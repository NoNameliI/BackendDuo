import { cleanMessage, commitId, treeId, type Commit, type Files, type Signature } from './objects';
import { parseIgnore, isIgnored } from './ignore';

export const HOME = '/home/student';
/** 2026-01-09 10:00:00 +0300; every git command advances the clock by a minute. */
export const EPOCH = 1767942000;
const TZ = '+0300';

export type Head = { kind: 'branch'; name: string } | { kind: 'detached'; id: string };

export interface ReflogEntry {
  id: string;
  message: string;
}

export interface Tag {
  /** Commit the tag points at. */
  target: string;
  /** Present for annotated tags. */
  annotation?: { id: string; tagger: Signature; message: string };
}

/** Paths are POSIX-like; the sandbox never touches the real file system. */
export function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
}

export function resolvePath(cwd: string, path: string): string {
  if (path === '~' || path.startsWith('~/')) return normalizePath(HOME + path.slice(1));
  return normalizePath(path.startsWith('/') ? path : `${cwd}/${path}`);
}

export function relativePath(from: string, to: string): string {
  const a = from.split('/').filter(Boolean);
  const b = to.split('/').filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/') || '.';
}

export function displayPath(path: string): string {
  return path === HOME ? '~' : path.startsWith(`${HOME}/`) ? `~${path.slice(HOME.length)}` : path;
}

export class World {
  readonly files = new Map<string, string>();
  readonly dirs = new Set<string>(['/', '/home', HOME]);
  readonly repos = new Map<string, Repo>();
  readonly globalConfig = new Map<string, string>();
  cwd = HOME;
  private commandCount = 0;

  constructor(identity = { name: 'Студент', email: 'student@example.com' }) {
    this.globalConfig.set('user.name', identity.name);
    this.globalConfig.set('user.email', identity.email);
  }

  /** Called before each git command, so a command's commits share one timestamp, as in real git. */
  tick(): void {
    this.commandCount++;
  }

  now(): Signature['time'] {
    return EPOCH + 60 * this.commandCount;
  }

  readonly tz = TZ;

  mkdirp(path: string): void {
    let at = '';
    for (const part of path.split('/').filter(Boolean)) {
      at += `/${part}`;
      this.dirs.add(at);
    }
  }

  writeFile(path: string, content: string): void {
    this.mkdirp(path.slice(0, path.lastIndexOf('/')) || '/');
    this.files.set(path, content);
  }

  isDir(path: string): boolean {
    return this.dirs.has(path);
  }

  /** Removes a file and prunes directories left empty (git does not track directories). */
  removeFile(path: string, pruneUpTo?: string): void {
    this.files.delete(path);
    if (!pruneUpTo) return;
    let dir = path.slice(0, path.lastIndexOf('/'));
    while (dir && dir !== pruneUpTo && dir.startsWith(`${pruneUpTo}/`) && this.isEmptyDir(dir)) {
      this.dirs.delete(dir);
      dir = dir.slice(0, dir.lastIndexOf('/'));
    }
  }

  isEmptyDir(path: string): boolean {
    const prefix = `${path}/`;
    for (const f of this.files.keys()) if (f.startsWith(prefix)) return false;
    for (const d of this.dirs) if (d.startsWith(prefix)) return false;
    return true;
  }

  repoAt(path: string): Repo | undefined {
    for (let p = path; ; p = p.slice(0, p.lastIndexOf('/')) || '/') {
      const repo = this.repos.get(p);
      if (repo) return repo;
      if (p === '/') return undefined;
    }
  }
}

export class Repo {
  readonly commits = new Map<string, Commit>();
  readonly branches = new Map<string, string>();
  readonly tags = new Map<string, Tag>();
  readonly remotes = new Map<string, string>();
  /** "origin/main" → commit id. */
  readonly remoteBranches = new Map<string, string>();
  /** Local branch → its upstream ("origin/main"). */
  readonly upstreams = new Map<string, { remote: string; branch: string }>();
  readonly config = new Map<string, string>();
  readonly reflog: ReflogEntry[] = [];
  /** Previous branch for `git switch -`. */
  previousBranch: string | null = null;
  head: Head = { kind: 'branch', name: 'main' };
  index = new Map<string, string>();
  /** Unresolved paths of an operation stopped by conflicts, with both sides' versions. */
  readonly conflicts = new Map<string, { ours: string | null; theirs: string | null }>();
  /** Set while a merge (or rebase, cherry-pick, revert) waits for conflicts to be resolved. */
  merging: { kind: 'merge' | 'rebase' | 'cherry-pick' | 'revert'; theirs: string; message: string } | null = null;

  constructor(
    readonly world: World,
    readonly root: string,
    readonly bare = false,
  ) {}

  headId(): string | undefined {
    return this.head.kind === 'branch' ? this.branches.get(this.head.name) : this.head.id;
  }

  headCommit(): Commit | undefined {
    const id = this.headId();
    return id ? this.commits.get(id) : undefined;
  }

  currentBranch(): string | null {
    return this.head.kind === 'branch' ? this.head.name : null;
  }

  headFiles(): Files {
    return this.headCommit()?.files ?? {};
  }

  getConfig(key: string): string | undefined {
    const k = key.toLowerCase();
    return this.config.get(k) ?? this.world.globalConfig.get(k);
  }

  signature(): Signature {
    return {
      name: this.getConfig('user.name') ?? '',
      email: this.getConfig('user.email') ?? '',
      time: this.world.now(),
      tz: this.world.tz,
    };
  }

  /** Working tree as repository-relative paths (the .git directory is not part of it). */
  worktree(): Record<string, string> {
    const prefix = `${this.root}/`;
    const out: Record<string, string> = {};
    for (const [path, content] of this.world.files) {
      if (path.startsWith(prefix) && !path.startsWith(`${prefix}.git/`)) out[path.slice(prefix.length)] = content;
    }
    return out;
  }

  writeWorktree(rel: string, content: string): void {
    this.world.writeFile(`${this.root}/${rel}`, content);
  }

  deleteWorktree(rel: string): void {
    this.world.removeFile(`${this.root}/${rel}`, this.root);
  }

  isIgnored(rel: string): boolean {
    const text = this.world.files.get(`${this.root}/.gitignore`);
    return text !== undefined && isIgnored(parseIgnore(text), rel);
  }

  /** Stores a commit object and returns it; the id is computed exactly like git's. */
  createCommit(files: Files, parents: string[], message: string, author?: Signature): Commit {
    const committer = this.signature();
    const body = { tree: treeId(files), parents, author: author ?? committer, committer, message: cleanMessage(message) };
    const commit: Commit = { id: commitId(body), files: { ...files }, ...body };
    this.commits.set(commit.id, commit);
    return commit;
  }

  /** Moves HEAD (or the branch it points to) and records the reflog entry. */
  advanceHead(id: string, message: string): void {
    if (this.head.kind === 'branch') this.branches.set(this.head.name, id);
    else this.head = { kind: 'detached', id };
    this.reflog.unshift({ id, message });
  }

  /** Resolves revisions: HEAD, branches, tags, remote branches, ids (≥ 4 hex chars), with ~n and ^n suffixes. */
  resolve(rev: string): string | undefined {
    const match = /^(.*?)((?:[~^]\d*)*)$/.exec(rev);
    if (!match || !match[1]) return undefined;
    let id = this.resolveName(match[1]);
    for (const [, op, n] of match[2].matchAll(/([~^])(\d*)/g)) {
      if (!id) return undefined;
      const count = n === '' ? 1 : Number(n);
      if (op === '~') {
        for (let i = 0; i < count && id; i++) id = this.commits.get(id)?.parents[0];
      } else {
        id = count === 0 ? id : this.commits.get(id)?.parents[count - 1];
      }
    }
    return id;
  }

  private resolveName(name: string): string | undefined {
    if (name === 'HEAD' || name === '@') return this.headId();
    if (this.branches.has(name)) return this.branches.get(name);
    if (this.tags.has(name)) return this.tags.get(name)!.target;
    if (this.remoteBranches.has(name)) return this.remoteBranches.get(name);
    for (const prefix of ['refs/heads/', 'refs/tags/', 'refs/remotes/']) {
      if (name.startsWith(prefix)) return this.resolveName(name.slice(prefix.length));
    }
    if (this.remotes.has(name)) return this.remoteBranches.get(`${name}/HEAD`) ?? this.remoteBranches.get(`${name}/main`);
    if (/^[0-9a-f]{4,40}$/.test(name)) {
      const found = [...this.commits.keys()].filter((id) => id.startsWith(name));
      if (found.length === 1) return found[0];
    }
    return undefined;
  }

  /** All commits reachable from `from` (inclusive). */
  ancestors(from: string): Set<string> {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(this.commits.get(id)?.parents ?? []));
    }
    return seen;
  }

  isAncestor(ancestor: string, of: string): boolean {
    return this.ancestors(of).has(ancestor);
  }

  short(id: string): string {
    return id.slice(0, 7);
  }

  /** Commits only in `a` and only in `b`. */
  aheadBehind(a: string, b: string): [number, number] {
    const fromA = this.ancestors(a);
    const fromB = this.ancestors(b);
    return [[...fromA].filter((id) => !fromB.has(id)).length, [...fromB].filter((id) => !fromA.has(id)).length];
  }

  /** "Your branch is ahead of 'origin/main' by 1 commit." and friends. */
  trackingLines(): string[] {
    const branch = this.currentBranch();
    const upstream = branch ? this.upstreams.get(branch) : undefined;
    if (!branch || !upstream) return [];
    const name = `${upstream.remote}/${upstream.branch}`;
    const theirs = this.remoteBranches.get(name);
    const ours = this.branches.get(branch);
    if (!theirs) return [`Your branch is based on '${name}', but the upstream is gone.`, '  (use "git branch --unset-upstream" to fixup)'];
    if (!ours) return [];
    const [ahead, behind] = this.aheadBehind(ours, theirs);
    const commits = (n: number) => `${n} commit${n === 1 ? '' : 's'}`;
    if (!ahead && !behind) return [`Your branch is up to date with '${name}'.`];
    if (ahead && !behind) return [`Your branch is ahead of '${name}' by ${commits(ahead)}.`, '  (use "git push" to publish your local commits)'];
    if (!ahead) {
      return [`Your branch is behind '${name}' by ${commits(behind)}, and can be fast-forwarded.`, '  (use "git pull" to update your local branch)'];
    }
    return [
      `Your branch and '${name}' have diverged,`,
      `and have ${ahead} and ${behind} different commits each, respectively.`,
      '  (use "git pull" if you want to integrate the remote branch with yours)',
    ];
  }
}
