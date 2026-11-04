import { compareFiles, type FileChange } from './patch';
import { conflictKind, relativePath, type Repo } from './world';

export interface Status {
  /** HEAD → index. */
  staged: FileChange[];
  /** Index → working tree, tracked files only. */
  unstaged: { kind: 'modified' | 'deleted'; path: string }[];
  /** Untracked entries; a directory without tracked files is shown once as "dir/". */
  untracked: string[];
  /** Paths with unresolved merge conflicts. */
  conflicts: string[];
}

export function computeStatus(repo: Repo): Status {
  const index = Object.fromEntries(repo.index);
  const worktree = repo.worktree();
  const conflicts = [...repo.conflicts.keys()].sort();
  const staged = compareFiles(repo.headFiles(), index).filter((c) => !conflicts.includes(c.path));

  const unstaged: Status['unstaged'] = [];
  for (const [path, content] of repo.index) {
    if (conflicts.includes(path)) continue;
    if (!(path in worktree)) unstaged.push({ kind: 'deleted', path });
    else if (worktree[path] !== content) unstaged.push({ kind: 'modified', path });
  }
  unstaged.sort((a, b) => (a.path < b.path ? -1 : 1));

  const tracked = [...repo.index.keys()];
  const untracked = new Set<string>();
  for (const path of Object.keys(worktree).sort()) {
    if (repo.index.has(path) || conflicts.includes(path) || repo.isIgnored(path)) continue;
    const parts = path.split('/');
    let shown = path;
    for (let k = 1; k < parts.length; k++) {
      const dir = parts.slice(0, k).join('/');
      if (!tracked.some((t) => t.startsWith(`${dir}/`))) {
        shown = `${dir}/`;
        break;
      }
    }
    untracked.add(shown);
  }
  return { staged, unstaged, untracked: [...untracked], conflicts };
}

export function isClean(s: Status): boolean {
  return s.staged.length === 0 && s.unstaged.length === 0 && s.conflicts.length === 0;
}

const LABELS: Record<string, string> = {
  added: 'new file:',
  modified: 'modified:',
  deleted: 'deleted:',
  renamed: 'renamed:',
};
const label = (kind: string) => LABELS[kind].padEnd(12);

/** Long-format status, as printed by `git status` and by `git commit` when there is nothing to commit. */
export function formatStatus(repo: Repo, mode: 'status' | 'commit' = 'status'): string[] {
  const s = computeStatus(repo);
  const show = (path: string) => {
    if (repo.world.cwd === repo.root) return path;
    const rel = relativePath(repo.world.cwd, `${repo.root}/${path}`);
    return path.endsWith('/') ? `${rel}/` : rel;
  };
  const unborn = !repo.headId();
  const out = repo.rebase ? rebaseLines(repo) : [repo.currentBranch() ? `On branch ${repo.currentBranch()}` : `HEAD detached at ${repo.short(repo.headId()!)}`];
  const tracking = repo.rebase ? [] : repo.trackingLines();
  if (tracking.length) out.push(...tracking, '');
  if (unborn) out.push(...(tracking.length ? [] : ['']), mode === 'commit' ? 'Initial commit' : 'No commits yet', '');

  const pending = repo.merging;
  const fixed = !s.conflicts.length;
  if (pending?.kind === 'merge') {
    out.push(
      ...(fixed
        ? ['All conflicts fixed but you are still merging.', '  (use "git commit" to conclude merge)']
        : ['You have unmerged paths.', '  (fix conflicts and run "git commit")', '  (use "git merge --abort" to abort the merge)']),
      '',
    );
  } else if (pending?.kind === 'cherry-pick' || pending?.kind === 'revert') {
    const op = pending.kind;
    out.push(
      `You are currently ${op === 'revert' ? 'reverting' : 'cherry-picking'} commit ${repo.short(pending.theirs)}.`,
      fixed ? `  (all conflicts fixed: run "git ${op} --continue")` : `  (fix conflicts and run "git ${op} --continue")`,
      `  (use "git ${op} --skip" to skip this patch)`,
      `  (use "git ${op} --abort" to cancel the ${op} operation)`,
      '',
    );
  } else if (repo.rebase) {
    out.push(
      ...(fixed
        ? ['  (all conflicts fixed: run "git rebase --continue")']
        : ['  (fix conflicts and then run "git rebase --continue")', '  (use "git rebase --skip" to skip this patch)', '  (use "git rebase --abort" to check out the original branch)']),
      '',
    );
  }
  // git leaves out the unstage hints while a merge or cherry-pick is being concluded.
  const plainCommit = pending?.kind !== 'merge' && pending?.kind !== 'cherry-pick';
  if (s.staged.length) {
    out.push('Changes to be committed:');
    if (plainCommit) out.push(unborn ? '  (use "git rm --cached <file>..." to unstage)' : '  (use "git restore --staged <file>..." to unstage)');
    for (const c of s.staged) out.push(`	${label(c.kind)}${c.kind === 'renamed' ? `${show(c.from!)} -> ${show(c.path)}` : show(c.path)}`);
    out.push('');
  }
  if (s.conflicts.length) {
    const kinds = s.conflicts.map((path) => conflictKind(repo.conflicts.get(path)!));
    out.push('Unmerged paths:');
    if (plainCommit) out.push('  (use "git restore --staged <file>..." to unstage)');
    out.push(kinds.some((k) => k.startsWith('deleted')) ? '  (use "git add/rm <file>..." as appropriate to mark resolution)' : '  (use "git add <file>..." to mark resolution)');
    s.conflicts.forEach((path, i) => out.push(`	${`${kinds[i]}:`.padEnd(17)}${show(path)}`));
    out.push('');
  }
  if (s.unstaged.length) {
    out.push('Changes not staged for commit:');
    out.push(`  (use "git add${s.unstaged.some((u) => u.kind === 'deleted') ? '/rm' : ''} <file>..." to update what will be committed)`);
    out.push('  (use "git restore <file>..." to discard changes in working directory)');
    for (const u of s.unstaged) out.push(`	${label(u.kind)}${show(u.path)}`);
    out.push('');
  }
  if (s.untracked.length) {
    out.push('Untracked files:', '  (use "git add <file>..." to include in what will be committed)');
    for (const u of s.untracked) out.push(`	${show(u)}`);
    out.push('');
  }

  if (s.staged.length && !s.conflicts.length) return out;
  if (s.unstaged.length || s.conflicts.length) out.push('no changes added to commit (use "git add" and/or "git commit -a")');
  else if (s.untracked.length) out.push('nothing added to commit but untracked files present (use "git add" to track)');
  else if (unborn) out.push('nothing to commit (create/copy files and use "git add" to track)');
  else out.push('nothing to commit, working tree clean');
  return out;
}

/** The head of `git status` while a rebase is stopped: what was done, what is left, onto what. */
function rebaseLines(repo: Repo): string[] {
  const state = repo.rebase!;
  const pick = (id: string) => `   pick ${repo.short(id)} # ${repo.commits.get(id)!.message.split('\n')[0]}`;
  const onto = repo.short(state.onto);
  const out = [`interactive rebase in progress; onto ${onto}`];
  const done = state.done.length;
  if (done) {
    out.push(done === 1 ? 'Last command done (1 command done):' : `Last commands done (${done} commands done):`);
    out.push(...state.done.slice(-2).map(pick));
    if (done > 2) out.push('  (see more in file .git/rebase-merge/done)');
  }
  const left = state.todo.length;
  if (left) {
    out.push(left === 1 ? 'Next command to do (1 remaining command):' : `Next commands to do (${left} remaining commands):`);
    out.push(...state.todo.slice(0, 2).map(pick));
    out.push('  (use "git rebase --edit-todo" to view and edit)');
  } else out.push('No commands remaining.');
  out.push(state.branch ? `You are currently rebasing branch '${state.branch}' on '${onto}'.` : `You are currently rebasing.`);
  return out;
}
