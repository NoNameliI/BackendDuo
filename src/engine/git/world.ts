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

/** One side of a conflict is null when that side deleted the file; base is null for add/add. */
export interface Conflict {
  base: string | null;
  ours: string | null;
  theirs: string | null;
}

export function conflictKind(c: Conflict): 'both modified' | 'both added' | 'deleted by us' | 'deleted by them' {
  if (c.ours === null) return 'deleted by us';
  if (c.theirs === null) return 'deleted by them';
  return c.base === null ? 'both added' : 'both modified';
}

/** A merge, cherry-pick or revert stopped by conflicts (MERGE_HEAD / CHERRY_PICK_HEAD / REVERT_HEAD). */
export interface Pending {
  kind: 'merge' | 'cherry-pick' | 'revert' | 'rebase';
  /** Merged or picked commit. */
  theirs: string;
  message: string;
  /** Author kept from the picked commit. */
  author?: Signature;
}

export interface RebaseState {
  /** Branch being rebased (null when HEAD was detached) and where it pointed before. */
  branch: string | null;
  origHead: string;
  onto: string;
  /** Commits still to apply, oldest first; `done` holds the ones already applied or stopped at. */
  todo: string[];
  done: string[];
}

/** A branch update a push asks a remote for; `id` is undefined for a deletion. */
export interface RefUpdate {
  branch: string;
  old: string | undefined;
  id: string | undefined;
  force: boolean;
}

/** Server-side hooks of a hosted repository (protected branches, CI, "create a pull request" hints). */
export interface ReceiveHook {
  check(update: RefUpdate): { reason: string; messages: string[] } | null;
  /** Runs after accepted updates; returns lines printed with the "remote: " prefix. */
  after(updates: RefUpdate[]): string[];
}

export interface StashEntry {
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
    // Divergent pulls merge, so beginners never meet git's "specify how to reconcile" stop.
    this.globalConfig.set('pull.rebase', 'false');
  }

  /** Task setup and reference solutions may use service commands (`hosting`, `as`); the learner may not. */
  privileged = false;

  /** Web addresses of sandbox hosting (https://…) mapped to repository paths in this world. */
  readonly hosts = new Map<string, string>();

  /** The repository a remote URL points at: a sandbox path (with or without ".git") or a hosting address. */
  findRemote(url: string, from: string): Repo | undefined {
    const target = this.hosts.get(url) ?? this.hosts.get(url.replace(/\.git$/, '')) ?? url;
    if (/^[a-z]+:\/\//.test(target) || /^[\w.-]+@[\w.-]+:/.test(target)) return undefined;
    const path = resolvePath(from, target);
    return this.repos.get(path) ?? this.repos.get(`${path}.git`);
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
  /** Remote → its default branch, shown as "origin/HEAD". */
  readonly remoteHeads = new Map<string, string>();
  /** Local branch → its upstream ("origin/main"). */
  readonly upstreams = new Map<string, { remote: string; branch: string }>();
  readonly config = new Map<string, string>();
  readonly reflog: ReflogEntry[] = [];
  /** Previous branch for `git switch -`. */
  previousBranch: string | null = null;
  head: Head = { kind: 'branch', name: 'main' };
  index = new Map<string, string>();
  /** Unresolved paths of an operation stopped by conflicts. */
  readonly conflicts = new Map<string, Conflict>();
  /** Set while a merge, cherry-pick, revert or rebase step waits for conflicts to be resolved. */
  merging: Pending | null = null;
  rebase: RebaseState | null = null;
  origHead: string | undefined;
  /** Set on repositories that live on the sandbox's hosting. */
  receive: ReceiveHook | undefined;
  /** Newest first, like refs/stash's reflog. */
  readonly stash: StashEntry[] = [];

  constructor(
    readonly world: World,
    readonly root: string,
    readonly bare = false,
  ) {}

  /** Updates a remote-tracking branch (undefined deletes it), keeping "<remote>/HEAD" in step. */
  setRemoteBranch(remote: string, branch: string, id: string | undefined): void {
    const keys = [`${remote}/${branch}`, ...(this.remoteHeads.get(remote) === branch ? [`${remote}/HEAD`] : [])];
    for (const key of keys) {
      if (id === undefined) this.remoteBranches.delete(key);
      else this.remoteBranches.set(key, id);
    }
  }

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
  createCommit(files: Files, parents: string[], message: string, author?: Signature, raw = false, by?: Signature): Commit {
    const committer = by ?? this.signature();
    const body = { tree: treeId(files), parents, author: author ?? committer, committer, message: raw ? message : cleanMessage(message) };
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
    const at = /^(.*)@\{(\d+|u|upstream|-1)\}$/.exec(name);
    if (at) return this.resolveAt(at[1], at[2]);
    if (name === 'HEAD' || name === '@') return this.headId();
    if (name === 'ORIG_HEAD') return this.origHead;
    if (name === 'MERGE_HEAD') return this.merging?.kind === 'merge' ? this.merging.theirs : undefined;
    if (name === 'stash') return this.stash[0]?.id;
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

  private resolveAt(base: string, spec: string): string | undefined {
    if (spec === '-1') return this.previousBranch ? this.branches.get(this.previousBranch) : undefined;
    if (spec === 'u' || spec === 'upstream') {
      const branch = base === '' || base === 'HEAD' ? this.currentBranch() : base;
      const up = branch ? this.upstreams.get(branch) : undefined;
      return up ? this.remoteBranches.get(`${up.remote}/${up.branch}`) : undefined;
    }
    const n = Number(spec);
    if (base === 'stash') return this.stash[n]?.id;
    if (base === '' || base === 'HEAD') return this.reflog[n]?.id;
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
    if (!ours) return [];
    if (!theirs) return [`Your branch is based on '${name}', but the upstream is gone.`, '  (use "git branch --unset-upstream" to fixup)'];
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
