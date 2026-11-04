import { flag, parseArgs, value } from '../args';
import type { Files } from '../objects';
import { computeStatus } from '../status';
import type { Repo } from '../world';
import { fatal, matchesPathspec, quiet, repoPath, requireRepo, shownPath, type Command, type Ctx } from './common';

function invalidName(ctx: Ctx, name: string): number {
  ctx.err(`fatal: '${name}' is not a valid branch name`);
  ctx.err("hint: See 'git help check-ref-format'");
  ctx.err('hint: Disable this message with "git config set advice.refSyntax false"');
  return 128;
}

export function isValidBranchName(name: string): boolean {
  return (
    name.length > 0 &&
    !/[\s~^:?*[\\]|\.\.|@\{|\/\/|^[-/.]|[/.]$|\.lock$/.test(name) &&
    name !== 'HEAD' &&
    !name.split('/').some((part) => part.startsWith('.'))
  );
}

/**
 * Moves index and working tree from HEAD's snapshot to `target`, keeping local changes to files the
 * two snapshots agree on (git's two-tree checkout). Returns false and reports when changes would be lost.
 */
export function checkoutTree(ctx: Ctx, repo: Repo, target: Files, verb = 'checkout'): boolean {
  const head = repo.headFiles();
  const index = Object.fromEntries(repo.index);
  const worktree = repo.worktree();
  const blocked: string[] = [];
  const untracked: string[] = [];
  for (const path of new Set([...Object.keys(head), ...Object.keys(target), ...Object.keys(index)])) {
    const h = head[path];
    const t = target[path];
    if (h === t) continue;
    const i = index[path];
    const w = worktree[path];
    const local = i !== h || w !== i;
    if (local && !(i === t && w === t)) blocked.push(path);
  }
  for (const path of Object.keys(target)) {
    if (!(path in head) && !(path in index) && path in worktree && worktree[path] !== target[path]) untracked.push(path);
  }
  const what = verb === 'merge' ? 'merge' : 'checkout';
  if (blocked.length) {
    ctx.err(`error: Your local changes to the following files would be overwritten by ${what}:`);
    for (const path of blocked.sort()) ctx.err(`\t${shownPath(ctx, repo, path)}`);
    ctx.err(`Please commit your changes or stash them before you ${verb === 'checkout' ? 'switch branches' : verb}.`);
    ctx.err('Aborting');
    return false;
  }
  if (untracked.length) {
    ctx.err(`error: The following untracked working tree files would be overwritten by ${what}:`);
    for (const path of untracked.sort()) ctx.err(`\t${shownPath(ctx, repo, path)}`);
    ctx.err(`Please move or remove them before you ${verb === 'checkout' ? 'switch branches' : verb}.`);
    ctx.err('Aborting');
    return false;
  }
  for (const path of new Set([...Object.keys(head), ...Object.keys(target)])) {
    const t = target[path];
    if (head[path] === t) continue;
    if (t === undefined) {
      repo.index.delete(path);
      repo.deleteWorktree(path);
    } else {
      repo.index.set(path, t);
      repo.writeWorktree(path, t);
    }
  }
  return true;
}

/** "M\tfile" lines git prints for local changes carried over to the new branch. */
function showLocalChanges(ctx: Ctx, repo: Repo): void {
  const s = computeStatus(repo);
  const letters = new Map<string, string>();
  for (const c of s.staged) letters.set(c.path, c.kind === 'added' ? 'A' : c.kind === 'deleted' ? 'D' : 'M');
  for (const u of s.unstaged) letters.set(u.path, u.kind === 'deleted' ? 'D' : 'M');
  for (const [path, letter] of [...letters].sort()) ctx.out(`${letter}\t${shownPath(ctx, repo, path)}`);
}

function leaveDetached(ctx: Ctx, repo: Repo, target: string): void {
  if (repo.head.kind !== 'detached') return;
  const old = repo.head.id;
  if (old === target) return;
  const reachable = new Set<string>();
  for (const tip of [...repo.branches.values(), ...repo.remoteBranches.values(), ...[...repo.tags.values()].map((t) => t.target)]) {
    for (const id of repo.ancestors(tip)) reachable.add(id);
  }
  const lost = [...repo.ancestors(old)].filter((id) => !reachable.has(id));
  const subject = (id: string) => repo.commits.get(id)!.message.split('\n')[0];
  if (lost.length === 0) {
    ctx.err(`Previous HEAD position was ${repo.short(old)} ${subject(old)}`);
    return;
  }
  const n = lost.length;
  ctx.err(`Warning: you are leaving ${n} commit${n === 1 ? '' : 's'} behind, not connected to`);
  ctx.err('any of your branches:');
  ctx.err('');
  for (const id of lost.slice(0, 4)) ctx.err(`  ${repo.short(id)} ${subject(id)}`);
  ctx.err('');
  ctx.err('If you want to keep it by creating a new branch, this may be a good time');
  ctx.err('to do so with:');
  ctx.err('');
  ctx.err(` git branch <new-branch-name> ${repo.short(old)}`);
  ctx.err('');
}

/** Switches HEAD to a branch (optionally creating it); shared by `switch` and `checkout`. */
export function switchBranch(ctx: Ctx, repo: Repo, name: string, create?: { start?: string }): number {
  const current = repo.currentBranch();
  if (create) {
    if (!isValidBranchName(name)) return invalidName(ctx, name);
    if (repo.branches.has(name)) return fatal(ctx, `a branch named '${name}' already exists`);
  }
  let target = create ? repo.resolve(create.start ?? 'HEAD') : repo.branches.get(name);
  if (create && create.start && !target) return fatal(ctx, `'${create.start}' is not a commit and a branch '${name}' cannot be created from it`);
  if (!create && target === undefined) {
    const remote = repo.remoteBranches.get(`origin/${name}`);
    if (!remote) return fatal(ctx, `invalid reference: ${name}`);
    repo.branches.set(name, remote);
    repo.upstreams.set(name, { remote: 'origin', branch: name });
    ctx.out(`branch '${name}' set up to track 'origin/${name}'.`);
    return switchBranch(ctx, repo, name);
  }
  if (!create && current === name) {
    ctx.err(`Already on '${name}'`);
    for (const line of repo.trackingLines()) ctx.out(line);
    return 0;
  }
  if (target && !checkoutTree(ctx, repo, repo.commits.get(target)!.files)) return 1;
  leaveDetached(ctx, repo, target ?? '');
  if (create && target) repo.branches.set(name, target);
  repo.previousBranch = current ?? repo.previousBranch;
  const from = current ?? (repo.headId() ? repo.short(repo.headId()!) : 'HEAD');
  repo.head = { kind: 'branch', name };
  if (target) repo.reflog.unshift({ id: target, message: `checkout: moving from ${from} to ${name}` });
  showLocalChanges(ctx, repo);
  ctx.err(create ? `Switched to a new branch '${name}'` : `Switched to branch '${name}'`);
  for (const line of repo.trackingLines()) ctx.out(line);
  return 0;
}

function detach(ctx: Ctx, repo: Repo, rev: string, advice: boolean): number {
  const id = repo.resolve(rev)!;
  const from = repo.currentBranch() ?? repo.short(repo.headId() ?? '');
  if (!checkoutTree(ctx, repo, repo.commits.get(id)!.files)) return 1;
  leaveDetached(ctx, repo, id);
  if (repo.currentBranch()) repo.previousBranch = repo.currentBranch();
  repo.head = { kind: 'detached', id };
  repo.reflog.unshift({ id, message: `checkout: moving from ${from} to ${rev}` });
  if (advice) {
    for (const line of [
      `Note: switching to '${rev}'.`,
      '',
      "You are in 'detached HEAD' state. You can look around, make experimental",
      'changes and commit them, and you can discard any commits you make in this',
      'state without impacting any branches by switching back to a branch.',
      '',
      'If you want to create a new branch to retain commits you create, you may',
      'do so (now or later) by using -c with the switch command. Example:',
      '',
      '  git switch -c <new-branch-name>',
      '',
      'Or undo this operation with:',
      '',
      '  git switch -',
      '',
      'Turn off this advice by setting config variable advice.detachedHead to false',
      '',
    ])
      ctx.err(line);
  }
  showLocalChanges(ctx, repo);
  ctx.err(`HEAD is now at ${repo.short(id)} ${repo.commits.get(id)!.message.split('\n')[0]}`);
  return 0;
}

export const switchCommand: Command = (outer, argv) => {
  const p = parseArgs(argv, {
    flags: { '-c': 'create', '--create': 'create', '-C': 'forceCreate', '--detach': 'detach', '-d': 'detach', '-q': 'quiet', '--quiet': 'quiet' },
    values: ['create', 'forceCreate'],
  });
  if (p.error) return fatal(outer, p.error);
  const ctx = flag(p, 'quiet') ? quiet(outer) : outer;
  const repo = requireRepo(ctx);
  if (!repo) return 128;
  const created = value(p, 'create') ?? value(p, 'forceCreate');
  if (created) {
    if (value(p, 'forceCreate')) repo.branches.delete(created);
    return switchBranch(ctx, repo, created, { start: p.args[0] });
  }
  let target = p.args[0];
  if (!target) return fatal(ctx, 'missing branch or commit argument');
  if (target === '-') {
    if (!repo.previousBranch) return fatal(ctx, 'invalid reference: @{-1}');
    target = repo.previousBranch;
  }
  if (flag(p, 'detach')) {
    if (!repo.resolve(target)) return fatal(ctx, `invalid reference: ${target}`);
    return detach(ctx, repo, target, false);
  }
  if (!repo.branches.has(target) && repo.resolve(target) && !repo.remoteBranches.has(`origin/${target}`)) {
    ctx.err(`fatal: a branch is expected, got ${repo.tags.has(target) ? 'tag' : repo.remoteBranches.has(target) ? 'remote branch' : 'commit'} '${target}'`);
    ctx.err('hint: If you want to detach HEAD at the commit, try again with the --detach option.');
    return 128;
  }
  return switchBranch(ctx, repo, target);
};

export const checkout: Command = (outer, argv) => {
  const p = parseArgs(argv, {
    flags: { '-b': 'create', '-B': 'forceCreate', '--detach': 'detach', '-q': 'quiet', '--quiet': 'quiet' },
    values: ['create', 'forceCreate'],
  });
  if (p.error) return fatal(outer, p.error);
  const ctx = flag(p, 'quiet') ? quiet(outer) : outer;
  const repo = requireRepo(ctx);
  if (!repo) return 128;
  const created = value(p, 'create') ?? value(p, 'forceCreate');
  if (created) {
    if (value(p, 'forceCreate')) repo.branches.delete(created);
    return switchBranch(ctx, repo, created, { start: p.args[0] });
  }

  const [first, ...rest] = p.args;
  const restoreFrom = (source: Files, specs: string[], args: string[]): number => {
    for (const [i, spec] of specs.entries()) {
      const paths = Object.keys(source).filter((path) => matchesPathspec(spec, path));
      if (paths.length === 0) {
        ctx.err(`error: pathspec '${args[i]}' did not match any file(s) known to git`);
        return 1;
      }
      for (const path of paths) {
        repo.index.set(path, source[path]);
        repo.writeWorktree(path, source[path]);
      }
    }
    return 0;
  };
  const toSpecs = (args: string[]) => args.map((a) => repoPath(ctx, repo, a) ?? a);

  if (p.paths) {
    if (first) {
      const id = repo.resolve(first);
      if (!id) return fatal(ctx, `invalid reference: ${first}`);
      return restoreFrom(repo.commits.get(id)!.files, toSpecs(p.paths), p.paths);
    }
    return restoreFrom(Object.fromEntries(repo.index), toSpecs(p.paths), p.paths);
  }
  if (!first) return fatal(ctx, 'you must specify path(s) to restore');
  let target = first;
  if (target === '-') {
    if (!repo.previousBranch) return fatal(ctx, 'invalid reference: @{-1}');
    target = repo.previousBranch;
  }
  if (repo.branches.has(target) || (!repo.resolve(target) && repo.remoteBranches.has(`origin/${target}`))) {
    return switchBranch(ctx, repo, target);
  }
  if (repo.resolve(target) && rest.length === 0) return detach(ctx, repo, target, true);
  const specs = toSpecs([first, ...rest]);
  const index = Object.fromEntries(repo.index);
  if (specs.every((s) => Object.keys(index).some((path) => matchesPathspec(s, path)))) return restoreFrom(index, specs, [first, ...rest]);
  ctx.err(`error: pathspec '${first}' did not match any file(s) known to git`);
  return 1;
};

export const branch: Command = (ctx, argv) => {
  const p = parseArgs(argv, {
    flags: {
      '-d': 'delete',
      '--delete': 'delete',
      '-D': 'forceDelete',
      '-m': 'move',
      '--move': 'move',
      '-M': 'move',
      '-v': 'verbose',
      '-vv': 'verbose',
      '-a': 'all',
      '--all': 'all',
      '-r': 'remotes',
      '--remotes': 'remotes',
      '--list': 'list',
      '-u': 'upstream',
      '--set-upstream-to': 'upstream',
      '--unset-upstream': 'unsetUpstream',
      '-f': 'force',
      '--force': 'force',
    },
    values: ['upstream'],
  });
  if (p.error) return fatal(ctx, p.error);
  const repo = requireRepo(ctx);
  if (!repo) return 128;
  const head = repo.headId();

  if (flag(p, 'delete') || flag(p, 'forceDelete')) {
    if (p.args.length === 0) return fatal(ctx, 'branch name required');
    let code = 0;
    for (const name of p.args) {
      const tip = repo.branches.get(name);
      if (tip === undefined) {
        ctx.err(`error: branch '${name}' not found`);
        code = 1;
        continue;
      }
      if (repo.currentBranch() === name) {
        ctx.err(`error: cannot delete branch '${name}' used by worktree at '${repo.root}'`);
        code = 1;
        continue;
      }
      const upstream = repo.upstreams.get(name);
      const mergedInto = upstream ? repo.remoteBranches.get(`${upstream.remote}/${upstream.branch}`) : head;
      if (!flag(p, 'forceDelete') && mergedInto && !repo.isAncestor(tip, mergedInto)) {
        ctx.err(`error: the branch '${name}' is not fully merged`);
        ctx.err(`hint: If you are sure you want to delete it, run 'git branch -D ${name}'`);
        ctx.err('hint: Disable this message with "git config set advice.forceDeleteBranch false"');
        code = 1;
        continue;
      }
      repo.branches.delete(name);
      repo.upstreams.delete(name);
      ctx.out(`Deleted branch ${name} (was ${repo.short(tip)}).`);
    }
    return code;
  }

  if (flag(p, 'move')) {
    const [a, b] = p.args;
    const [oldName, newName] = b === undefined ? [repo.currentBranch() ?? '', a] : [a, b];
    if (!newName) return fatal(ctx, 'branch name required');
    if (!repo.branches.has(oldName) && !(oldName === repo.currentBranch() && !head)) return fatal(ctx, `no branch named '${oldName}'`);
    if (!isValidBranchName(newName)) return invalidName(ctx, newName);
    if (repo.branches.has(newName) && !flag(p, 'force')) return fatal(ctx, `a branch named '${newName}' already exists`);
    const tip = repo.branches.get(oldName);
    repo.branches.delete(oldName);
    if (tip) repo.branches.set(newName, tip);
    const upstream = repo.upstreams.get(oldName);
    if (upstream) {
      repo.upstreams.delete(oldName);
      repo.upstreams.set(newName, upstream);
    }
    if (repo.currentBranch() === oldName) repo.head = { kind: 'branch', name: newName };
    return 0;
  }

  const upstreamArg = value(p, 'upstream');
  if (upstreamArg !== undefined) {
    const name = p.args[0] ?? repo.currentBranch();
    const slash = upstreamArg.indexOf('/');
    if (!name || !repo.remoteBranches.has(upstreamArg) || slash === -1) {
      return fatal(ctx, `the requested upstream branch '${upstreamArg}' does not exist`);
    }
    repo.upstreams.set(name, { remote: upstreamArg.slice(0, slash), branch: upstreamArg.slice(slash + 1) });
    ctx.out(`branch '${name}' set up to track '${upstreamArg}'.`);
    return 0;
  }
  if (flag(p, 'unsetUpstream')) {
    const name = p.args[0] ?? repo.currentBranch();
    if (name) repo.upstreams.delete(name);
    return 0;
  }

  if (p.args.length > 0 && !flag(p, 'list')) {
    const [name, start] = p.args;
    if (!isValidBranchName(name)) return invalidName(ctx, name);
    if (repo.branches.has(name) && !flag(p, 'force')) return fatal(ctx, `a branch named '${name}' already exists`);
    const id = repo.resolve(start ?? 'HEAD');
    if (!id) return fatal(ctx, `not a valid object name: '${start ?? repo.currentBranch()}'`);
    repo.branches.set(name, id);
    if (start && repo.remoteBranches.has(start)) {
      const slash = start.indexOf('/');
      repo.upstreams.set(name, { remote: start.slice(0, slash), branch: start.slice(slash + 1) });
      ctx.out(`branch '${name}' set up to track '${start}'.`);
    }
    return 0;
  }

  const verbose = flag(p, 'verbose');
  const rows: { name: string; current: boolean; id?: string }[] = [];
  if (!flag(p, 'remotes')) {
    if (repo.head.kind === 'detached') rows.push({ name: `(HEAD detached at ${repo.short(repo.head.id)})`, current: true, id: repo.head.id });
    for (const name of [...repo.branches.keys()].sort()) rows.push({ name, current: repo.currentBranch() === name, id: repo.branches.get(name) });
  }
  if (flag(p, 'all') || flag(p, 'remotes')) {
    for (const name of [...repo.remoteBranches.keys()].sort()) {
      rows.push({ name: flag(p, 'all') ? `remotes/${name}` : name, current: false, id: repo.remoteBranches.get(name) });
    }
  }
  const width = Math.max(0, ...rows.map((r) => r.name.length));
  for (const row of rows) {
    const mark = row.current ? '* ' : '  ';
    if (!verbose || !row.id) ctx.out(`${mark}${row.name}`);
    else ctx.out(`${mark}${row.name.padEnd(width)} ${repo.short(row.id)} ${repo.commits.get(row.id)!.message.split('\n')[0]}`);
  }
  return 0;
};
