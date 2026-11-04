import { flag, parseArgs } from '../args';
import { drawGraph } from '../graph';
import { formatDate, type Commit, type Files } from '../objects';
import { compareFiles, formatPatch, formatStat } from '../patch';
import type { Repo } from '../world';
import { fatal, matchesPathspec, repoPath, requireRepo, type Command, type Ctx } from './common';

/** Ref names pointing at a commit, in git's order: "HEAD -> main", then the other refs. */
export function decorations(repo: Repo, id: string): string[] {
  const refs: string[] = [];
  for (const name of [...repo.branches.keys()].sort()) if (repo.branches.get(name) === id) refs.push(name);
  for (const name of [...repo.remoteBranches.keys()].sort()) if (repo.remoteBranches.get(name) === id) refs.push(name);
  for (const name of [...repo.tags.keys()].sort()) if (repo.tags.get(name)!.target === id) refs.push(`tag: ${name}`);
  refs.reverse();
  if (repo.head.kind === 'detached') {
    if (repo.head.id === id) refs.unshift('HEAD');
  } else if (repo.branches.get(repo.head.name) === id) {
    refs.splice(refs.indexOf(repo.head.name), 1);
    refs.unshift(`HEAD -> ${repo.head.name}`);
  }
  return refs;
}

const decorate = (repo: Repo, id: string) => {
  const refs = decorations(repo, id);
  return refs.length ? ` (${refs.join(', ')})` : '';
};

/** Commits reachable from the starting points in git's default order (newest committer date first). */
function walkByDate(repo: Repo, starts: string[], limit = Infinity): Commit[] {
  const queue: Commit[] = [];
  const seen = new Set<string>();
  const insert = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const commit = repo.commits.get(id)!;
    const at = queue.findIndex((c) => c.committer.time < commit.committer.time);
    if (at === -1) queue.push(commit);
    else queue.splice(at, 0, commit);
  };
  starts.forEach(insert);
  const out: Commit[] = [];
  while (queue.length && out.length < limit) {
    const commit = queue.shift()!;
    out.push(commit);
    commit.parents.forEach(insert);
  }
  return out;
}

/** git's --topo-order: no parent before all its children; a merged branch is shown right after the merge. */
function topoOrder(commits: Commit[]): Commit[] {
  const ids = new Set(commits.map((c) => c.id));
  const indegree = new Map(commits.map((c) => [c.id, 1]));
  for (const c of commits) for (const p of c.parents) if (ids.has(p)) indegree.set(p, indegree.get(p)! + 1);
  const byId = new Map(commits.map((c) => [c.id, c]));
  const stack = commits.filter((c) => indegree.get(c.id) === 1).reverse();
  const out: Commit[] = [];
  while (stack.length) {
    const commit = stack.pop()!;
    out.push(commit);
    for (const p of commit.parents) {
      if (!ids.has(p)) continue;
      indegree.set(p, indegree.get(p)! - 1);
      if (indegree.get(p) === 1) stack.push(byId.get(p)!);
    }
  }
  return out;
}

function logEntry(repo: Repo, c: Commit, oneline: boolean): string[] {
  const subject = c.message.split('\n')[0];
  if (oneline) return [`${repo.short(c.id)}${decorate(repo, c.id)} ${subject}`];
  return [
    `commit ${c.id}${decorate(repo, c.id)}`,
    ...(c.parents.length > 1 ? [`Merge: ${c.parents.map((p) => repo.short(p)).join(' ')}`] : []),
    `Author: ${c.author.name} <${c.author.email}>`,
    `Date:   ${formatDate(c.author)}`,
    '',
    ...c.message.replace(/\n$/, '').split('\n').map((l) => `    ${l}`),
  ];
}

export const log: Command = (ctx, argv) => {
  const limitArg = argv.find((a) => /^-\d+$/.test(a));
  const p = parseArgs(
    argv.filter((a) => a !== limitArg),
    {
      flags: { '--oneline': 'oneline', '--graph': 'graph', '--all': 'all', '-n': 'max', '--max-count': 'max', '--decorate': 'decorate' },
      values: ['max'],
    },
  );
  if (p.error) return fatal(ctx, p.error);
  const repo = requireRepo(ctx);
  if (!repo) return 128;
  const max = limitArg ? Number(limitArg.slice(1)) : Array.isArray(p.opts.max) ? Number(p.opts.max.at(-1)) : Infinity;

  const starts: string[] = [];
  if (flag(p, 'all')) {
    const head = repo.headId();
    if (head) starts.push(head);
    starts.push(...repo.branches.values(), ...repo.remoteBranches.values(), ...[...repo.tags.values()].map((t) => t.target));
  }
  for (const rev of p.args) {
    const id = repo.resolve(rev);
    if (!id) {
      ctx.err(`fatal: ambiguous argument '${rev}': unknown revision or path not in the working tree.`);
      ctx.err("Use '--' to separate paths from revisions, like this:");
      ctx.err("'git <command> [<revision>...] -- [<file>...]'");
      return 128;
    }
    starts.push(id);
  }
  if (starts.length === 0) {
    const head = repo.headId();
    if (!head) return fatal(ctx, `your current branch '${repo.currentBranch()}' does not have any commits yet`);
    starts.push(head);
  }

  const oneline = flag(p, 'oneline');
  let commits = walkByDate(repo, starts, flag(p, 'graph') ? Infinity : max);
  if (flag(p, 'graph')) {
    commits = topoOrder(commits).slice(0, max);
    const byId = new Map(commits.map((c) => [c.id, c]));
    const lines = drawGraph(
      commits.map((c) => c.id),
      (id) => byId.get(id)!.parents,
      (id) => logEntry(repo, byId.get(id)!, oneline),
      !oneline,
    );
    for (const line of lines) ctx.out(line);
    return 0;
  }
  commits.forEach((c, i) => {
    if (i > 0 && !oneline) ctx.out('');
    for (const line of logEntry(repo, c, oneline)) ctx.out(line);
  });
  return 0;
};

function printChanges(ctx: Ctx, before: Files, after: Files, specs: string[], stat = false): void {
  const changes = compareFiles(before, after).filter(
    (c) => !specs.length || specs.some((s) => matchesPathspec(s, c.path) || (c.from !== undefined && matchesPathspec(s, c.from))),
  );
  if (stat) {
    if (changes.length) for (const line of formatStat(changes)) ctx.out(line);
    return;
  }
  for (const change of changes) for (const line of formatPatch(change)) ctx.out(line);
}

export const show: Command = (ctx, argv) => {
  const repo = requireRepo(ctx);
  if (!repo) return 128;
  const rev = argv.find((a) => !a.startsWith('-')) ?? 'HEAD';
  const colon = rev.indexOf(':');
  if (colon !== -1) {
    const id = repo.resolve(rev.slice(0, colon) || 'HEAD');
    const path = rev.slice(colon + 1).replace(/^\.\//, '');
    const content = id ? repo.commits.get(id)!.files[path] : undefined;
    if (content === undefined) return fatal(ctx, `path '${path}' does not exist in '${rev.slice(0, colon) || 'HEAD'}'`);
    for (const line of content.replace(/\n$/, '').split('\n')) ctx.out(line);
    return 0;
  }
  const id = repo.resolve(rev);
  if (!id) {
    ctx.err(`fatal: ambiguous argument '${rev}': unknown revision or path not in the working tree.`);
    return 128;
  }
  const commit = repo.commits.get(id)!;
  for (const line of logEntry(repo, commit, false)) ctx.out(line);
  if (commit.parents.length > 1) return 0;
  const before = commit.parents[0] ? repo.commits.get(commit.parents[0])!.files : {};
  if (compareFiles(before, commit.files).length) ctx.out('');
  printChanges(ctx, before, commit.files, [], argv.includes('--stat'));
  return 0;
};

export const diff: Command = (ctx, argv) => {
  const p = parseArgs(argv, { flags: { '--staged': 'staged', '--cached': 'staged', '--name-only': 'nameOnly', '--stat': 'stat' } });
  if (p.error) return fatal(ctx, p.error);
  const repo = requireRepo(ctx);
  if (!repo) return 128;

  const revs: string[] = [];
  const pathArgs = [...(p.paths ?? [])];
  for (const arg of p.args) {
    if (arg.includes('..')) revs.push(...arg.split('..').map((r) => r || 'HEAD'));
    else if (repo.resolve(arg)) revs.push(arg);
    else pathArgs.push(arg);
  }
  const specs = pathArgs.map((a) => repoPath(ctx, repo, a) ?? a);
  const index = Object.fromEntries(repo.index);
  const tracked = (files: Files) => Object.fromEntries(Object.entries(files).filter(([path]) => repo.index.has(path)));
  const filesOf = (rev: string) => repo.commits.get(repo.resolve(rev)!)!.files;

  let before: Files;
  let after: Files;
  if (revs.length >= 2) [before, after] = [filesOf(revs[0]), filesOf(revs[1])];
  else if (revs.length === 1) [before, after] = flag(p, 'staged') ? [filesOf(revs[0]), index] : [filesOf(revs[0]), tracked(repo.worktree())];
  else if (flag(p, 'staged')) [before, after] = [repo.headFiles(), index];
  else [before, after] = [index, tracked(repo.worktree())];

  if (flag(p, 'nameOnly')) {
    for (const c of compareFiles(before, after)) if (!specs.length || specs.some((s) => matchesPathspec(s, c.path))) ctx.out(c.path);
    return 0;
  }
  printChanges(ctx, before, after, specs, flag(p, 'stat'));
  return 0;
};
