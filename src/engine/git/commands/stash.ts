import { flag, parseArgs, value } from '../args';
import { mergeTrees } from '../merge';
import { compareFiles, formatStat } from '../patch';
import { computeStatus, formatStatus } from '../status';
import type { Repo } from '../world';
import { fatal, requireRepo, type Command, type Ctx } from './common';
import { applyMerge, canApply, hardReset, oneline } from './integrate';

function where(repo: Repo): string {
  return `${repo.currentBranch() ?? '(no branch)'}: ${oneline(repo, repo.headId()!)}`;
}

function push(ctx: Ctx, repo: Repo, untracked: boolean, message?: string): number {
  const head = repo.headCommit();
  if (!head) {
    ctx.err("You do not have the initial commit yet");
    return 1;
  }
  const s = computeStatus(repo);
  const extra = untracked ? Object.keys(repo.worktree()).filter((p) => !repo.index.has(p) && !repo.conflicts.has(p) && !repo.isIgnored(p)) : [];
  if (!s.staged.length && !s.unstaged.length && !extra.length) {
    ctx.out('No local changes to save');
    return 0;
  }
  const base = where(repo);
  const index = Object.fromEntries(repo.index);
  const indexCommit = repo.createCommit(index, [head.id], `index on ${base}`);
  const worktree = repo.worktree();
  const tracked: Record<string, string> = {};
  for (const path of repo.index.keys()) if (path in worktree) tracked[path] = worktree[path];
  const parents = [head.id, indexCommit.id];
  if (extra.length) {
    const files = Object.fromEntries(extra.map((p) => [p, worktree[p]]));
    parents.push(repo.createCommit(files, [], `untracked files on ${base}`).id);
  }
  const label = message ? `On ${repo.currentBranch() ?? '(no branch)'}: ${message}` : `WIP on ${base}`;
  // git writes the stash commit message without a final newline.
  const stash = repo.createCommit(tracked, parents, label, undefined, true);
  repo.stash.unshift({ id: stash.id, message: label });
  hardReset(repo, head.files);
  for (const path of extra) repo.deleteWorktree(path);
  ctx.out(`Saved working directory and index state ${label}`);
  return 0;
}

function entryIndex(ctx: Ctx, repo: Repo, arg: string | undefined): number | null {
  if (!repo.stash.length) {
    ctx.err('No stash entries found.');
    return null;
  }
  const n = arg === undefined ? 0 : /^(?:stash@\{)?(\d+)\}?$/.exec(arg)?.[1];
  const i = Number(n);
  if (n === undefined || !repo.stash[i]) {
    ctx.err(`error: ${arg} is not a valid reference`);
    return null;
  }
  return i;
}

function drop(ctx: Ctx, repo: Repo, i: number): void {
  const [entry] = repo.stash.splice(i, 1);
  ctx.out(`Dropped refs/stash@{${i}} (${entry.id})`);
}

function apply(ctx: Ctx, repo: Repo, i: number): number {
  const stash = repo.commits.get(repo.stash[i].id)!;
  const base = repo.commits.get(stash.parents[0])!.files;
  const indexFiles = repo.commits.get(stash.parents[1])!.files;
  const untracked = stash.parents[2] ? repo.commits.get(stash.parents[2])!.files : {};
  const worktree = repo.worktree();
  const clash = Object.keys(untracked).filter((p) => p in worktree);
  if (clash.length) {
    for (const p of clash) ctx.err(`${p} already exists, no checkout`);
    ctx.err('error: could not restore untracked files from stash');
    return 1;
  }
  const head = repo.headFiles();
  const merged = mergeTrees(base, head, stash.files, { ours: 'Updated upstream', theirs: 'Stashed changes' });
  if (!canApply(ctx, repo, merged.files)) return 1;
  applyMerge(repo, merged);
  // Like git: changes come back unstaged, except files that were new in the stashed index.
  for (const path of new Set([...Object.keys(merged.index), ...Object.keys(head)])) {
    if (merged.conflicts.has(path)) continue;
    if (path in head) repo.index.set(path, head[path]);
    else if (!(path in indexFiles)) repo.index.delete(path);
  }
  for (const [path, content] of Object.entries(untracked)) repo.writeWorktree(path, content);
  if (!compareFiles(head, merged.files).length && !merged.conflicts.size) ctx.out('Already up to date.');
  for (const line of merged.messages) ctx.out(line);
  for (const line of formatStatus(repo)) ctx.out(line);
  if (merged.conflicts.size) {
    ctx.out('The stash entry is kept in case you need it again.');
    return 1;
  }
  return 0;
}

export const stash: Command = (ctx, argv) => {
  const sub = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'push';
  const rest = sub === argv[0] ? argv.slice(1) : argv;
  const p = parseArgs(rest, {
    flags: { '-u': 'untracked', '--include-untracked': 'untracked', '-m': 'message', '--message': 'message', '-q': 'quiet' },
    values: ['message'],
  });
  if (p.error) return fatal(ctx, p.error);
  const repo = requireRepo(ctx);
  if (!repo) return 128;

  switch (sub) {
    case 'push':
    case 'save':
      return push(ctx, repo, flag(p, 'untracked'), value(p, 'message') ?? (sub === 'save' ? p.args.join(' ') || undefined : undefined));
    case 'list':
      repo.stash.forEach((e, i) => ctx.out(`stash@{${i}}: ${e.message}`));
      return 0;
    case 'show': {
      const i = entryIndex(ctx, repo, p.args[0]);
      if (i === null) return 1;
      const c = repo.commits.get(repo.stash[i].id)!;
      for (const line of formatStat(compareFiles(repo.commits.get(c.parents[0])!.files, c.files))) ctx.out(line);
      return 0;
    }
    case 'apply':
    case 'pop': {
      const i = entryIndex(ctx, repo, p.args[0]);
      if (i === null) return 1;
      const code = apply(ctx, repo, i);
      if (code === 0 && sub === 'pop') drop(ctx, repo, i);
      return code;
    }
    case 'drop': {
      const i = entryIndex(ctx, repo, p.args[0]);
      if (i === null) return 1;
      drop(ctx, repo, i);
      return 0;
    }
    case 'clear':
      repo.stash.length = 0;
      return 0;
    default:
      ctx.err(`error: unknown subcommand: \`${sub}'`);
      return 129;
  }
};
