import type { TreeMerge } from '../merge';
import type { Files } from '../objects';
import { compareFiles, formatStat } from '../patch';
import type { Repo } from '../world';
import { shownPath, type Ctx } from './common';

/** Best common ancestor of two commits (the newest one that is not an ancestor of another candidate). */
export function mergeBase(repo: Repo, a: string, b: string): string | undefined {
  const fromB = repo.ancestors(b);
  const common = [...repo.ancestors(a)].filter((id) => fromB.has(id));
  const best = common.filter((c) => !common.some((other) => other !== c && repo.isAncestor(c, other)));
  return best.sort((x, y) => repo.commits.get(y)!.committer.time - repo.commits.get(x)!.committer.time)[0];
}

/**
 * Refuses to write `result` over uncommitted work, with git's messages. `files` is the new working tree,
 * compared with HEAD to find the paths an operation touches.
 */
export function canApply(ctx: Ctx, repo: Repo, files: Files, verb = 'merge'): boolean {
  const head = repo.headFiles();
  const worktree = repo.worktree();
  const blocked: string[] = [];
  const untracked: string[] = [];
  for (const path of new Set([...Object.keys(head), ...Object.keys(files)])) {
    if (head[path] === files[path]) continue;
    const staged = repo.index.get(path);
    if (staged !== head[path] || worktree[path] !== staged) {
      if (staged === undefined && head[path] === undefined) {
        if (worktree[path] !== undefined && worktree[path] !== files[path]) untracked.push(path);
      } else blocked.push(path);
    }
  }
  if (blocked.length) {
    ctx.err(`error: Your local changes to the following files would be overwritten by ${verb}:`);
    for (const path of blocked.sort()) ctx.err(`\t${shownPath(ctx, repo, path)}`);
    ctx.err(`Please commit your changes or stash them before you ${verb}.`);
    ctx.err('Aborting');
    return false;
  }
  if (untracked.length) {
    ctx.err(`error: The following untracked working tree files would be overwritten by ${verb}:`);
    for (const path of untracked.sort()) ctx.err(`\t${shownPath(ctx, repo, path)}`);
    ctx.err(`Please move or remove them before you ${verb}.`);
    ctx.err('Aborting');
    return false;
  }
  return true;
}

/** Writes a merge result: working tree, index and the conflicts left for the user. */
export function applyMerge(repo: Repo, merge: TreeMerge): void {
  const head = repo.headFiles();
  for (const path of new Set([...Object.keys(head), ...Object.keys(merge.files)])) {
    const content = merge.files[path];
    if (content === undefined) repo.deleteWorktree(path);
    else if (head[path] !== content || repo.worktree()[path] !== content) repo.writeWorktree(path, content);
    const staged = merge.index[path] ?? (merge.conflicts.has(path) ? merge.conflicts.get(path)!.ours ?? undefined : undefined);
    if (staged === undefined) repo.index.delete(path);
    else repo.index.set(path, staged);
  }
  repo.conflicts.clear();
  for (const [path, conflict] of merge.conflicts) repo.conflicts.set(path, conflict);
}

/** Index and working tree become `files`; untracked files are left alone. Clears conflicts. */
export function hardReset(repo: Repo, files: Files): void {
  const worktree = repo.worktree();
  for (const path of new Set([...repo.index.keys(), ...repo.conflicts.keys(), ...Object.keys(repo.headFiles()), ...Object.keys(files)])) {
    const content = files[path];
    if (content === undefined) {
      repo.index.delete(path);
      if (path in worktree) repo.deleteWorktree(path);
    } else {
      repo.index.set(path, content);
      if (worktree[path] !== content) repo.writeWorktree(path, content);
    }
  }
  repo.conflicts.clear();
}

/** The diffstat with create/delete lines that merge, pull and fast-forwards print. */
export function printStat(ctx: Ctx, before: Files, after: Files): void {
  const changes = compareFiles(before, after);
  if (changes.length) for (const line of formatStat(changes, true)) ctx.out(line);
}

/** "abc1234 Subject" */
export const oneline = (repo: Repo, id: string) => `${repo.short(id)} ${repo.commits.get(id)!.message.split('\n')[0]}`;
