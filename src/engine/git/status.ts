import { compareFiles, type FileChange } from './patch';
import { relativePath, type Repo } from './world';

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
  const out = [repo.currentBranch() ? `On branch ${repo.currentBranch()}` : `HEAD detached at ${repo.short(repo.headId()!)}`];
  const tracking = repo.trackingLines();
  if (tracking.length) out.push(...tracking, '');
  if (unborn) out.push(...(tracking.length ? [] : ['']), mode === 'commit' ? 'Initial commit' : 'No commits yet', '');

  if (repo.merging) {
    out.push(
      ...(s.conflicts.length
        ? ['You have unmerged paths.', '  (fix conflicts and run "git commit")', '  (use "git merge --abort" to abort the merge)']
        : ['All conflicts fixed but you are still merging.', '  (use "git commit" to conclude merge)']),
      '',
    );
  }
  if (s.staged.length) {
    out.push('Changes to be committed:');
    out.push(unborn ? '  (use "git rm --cached <file>..." to unstage)' : '  (use "git restore --staged <file>..." to unstage)');
    for (const c of s.staged) out.push(`	${label(c.kind)}${c.kind === 'renamed' ? `${show(c.from!)} -> ${show(c.path)}` : show(c.path)}`);
    out.push('');
  }
  if (s.conflicts.length) {
    out.push('Unmerged paths:', '  (use "git add <file>..." to mark resolution)');
    for (const path of s.conflicts) out.push(`	both modified:   ${show(path)}`);
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
