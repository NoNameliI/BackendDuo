import { flag, parseArgs, value } from '../args';
import { fatal, matchesPathspec, repoPath, requireRepo, shownPath, type Command, type Ctx } from './common';
import type { Repo } from '../world';

/** Repository-relative pathspecs of the arguments; reports and returns null for paths outside the repository. */
function pathspecs(ctx: Ctx, repo: Repo, args: string[]): string[] | null {
  const out: string[] = [];
  for (const arg of args) {
    const path = repoPath(ctx, repo, arg);
    if (path === null) {
      fatal(ctx, `${arg}: '${arg}' is outside repository at '${repo.root}'`);
      return null;
    }
    out.push(path);
  }
  return out;
}

export const add: Command = (ctx, argv) => {
  const p = parseArgs(argv, {
    flags: { '-A': 'all', '--all': 'all', '-u': 'update', '--update': 'update', '-f': 'force', '--force': 'force', '-v': 'verbose' },
  });
  if (p.error) return fatal(ctx, p.error);
  const repo = requireRepo(ctx);
  if (!repo) return 128;
  const specArgs = [...p.args, ...(p.paths ?? [])];
  const all = flag(p, 'all') || (flag(p, 'update') && specArgs.length === 0);
  if (specArgs.length === 0 && !all) {
    ctx.err('Nothing specified, nothing added.');
    ctx.err("hint: Maybe you wanted to say 'git add .'?");
    ctx.err('hint: Disable this message with "git config set advice.addEmptyPathspec false"');
    return 0;
  }
  const specs = all && specArgs.length === 0 ? [''] : pathspecs(ctx, repo, specArgs);
  if (!specs) return 128;

  const worktree = repo.worktree();
  const updates = new Map<string, string | null>();
  const ignored: string[] = [];
  for (const spec of specs) {
    let matched = false;
    for (const path of Object.keys(worktree)) {
      if (!matchesPathspec(spec, path)) continue;
      const tracked = repo.index.has(path) || repo.conflicts.has(path);
      if (!tracked && flag(p, 'update')) continue;
      if (!tracked && repo.isIgnored(path) && !flag(p, 'force')) {
        if (spec === path) ignored.push(spec);
        else matched = true;
        continue;
      }
      matched = true;
      updates.set(path, worktree[path]);
    }
    for (const path of [...repo.index.keys(), ...repo.conflicts.keys()]) {
      if (matchesPathspec(spec, path) && !(path in worktree)) {
        matched = true;
        updates.set(path, null);
      }
    }
    if (!matched && !ignored.includes(spec)) return fatal(ctx, `pathspec '${specArgs[specs.indexOf(spec)] ?? spec}' did not match any files`);
  }
  for (const [path, content] of updates) {
    repo.conflicts.delete(path);
    if (content === null) repo.index.delete(path);
    else repo.index.set(path, content);
  }
  if (ignored.length) {
    ctx.err('The following paths are ignored by one of your .gitignore files:');
    for (const path of ignored) ctx.err(shownPath(ctx, repo, path));
    ctx.err('hint: Use -f if you really want to add them.');
    ctx.err('hint: Disable this message with "git config set advice.addIgnoredFile false"');
    return 1;
  }
  return 0;
};

export const rm: Command = (ctx, argv) => {
  const p = parseArgs(argv, {
    flags: { '--cached': 'cached', '-f': 'force', '--force': 'force', '-r': 'recursive', '-q': 'quiet', '--quiet': 'quiet' },
  });
  if (p.error) return fatal(ctx, p.error);
  const repo = requireRepo(ctx);
  if (!repo) return 128;
  const args = [...p.args, ...(p.paths ?? [])];
  if (args.length === 0) {
    ctx.err('usage: git rm [-f | --force] [-n] [-r] [--cached] [--ignore-unmatch] [--quiet] [--pathspec-from-file=<file>] [--] [<pathspec>...]');
    return 129;
  }
  const specs = pathspecs(ctx, repo, args);
  if (!specs) return 128;
  const head = repo.headFiles();
  const worktree = repo.worktree();
  const targets: string[] = [];
  for (const [i, spec] of specs.entries()) {
    const found = [...repo.index.keys()].filter((path) => matchesPathspec(spec, path));
    if (found.length === 0) return fatal(ctx, `pathspec '${args[i]}' did not match any files`);
    if (!flag(p, 'recursive') && !found.includes(spec) && spec !== '') return fatal(ctx, `not removing '${args[i]}' recursively without -r`);
    targets.push(...found);
  }
  if (!flag(p, 'force')) {
    for (const path of targets) {
      const staged = repo.index.get(path);
      const local = worktree[path];
      const inHead = head[path];
      const stagedChange = staged !== inHead;
      const localChange = local !== undefined && local !== staged;
      if (stagedChange && localChange && local !== inHead) {
        ctx.err('error: the following file has staged content different from both the\nfile and the HEAD:');
        ctx.err(`    ${shownPath(ctx, repo, path)}`);
        ctx.err('(use -f to force removal)');
        return 1;
      }
      if (flag(p, 'cached')) continue;
      if (localChange) {
        ctx.err('error: the following file has local modifications:');
        ctx.err(`    ${shownPath(ctx, repo, path)}`);
        ctx.err('(use --cached to keep the file, or -f to force removal)');
        return 1;
      }
      if (stagedChange) {
        ctx.err('error: the following file has changes staged in the index:');
        ctx.err(`    ${shownPath(ctx, repo, path)}`);
        ctx.err('(use --cached to keep the file, or -f to force removal)');
        return 1;
      }
    }
  }
  for (const path of [...new Set(targets)].sort()) {
    repo.index.delete(path);
    if (!flag(p, 'cached')) repo.deleteWorktree(path);
    if (!flag(p, 'quiet')) ctx.out(`rm '${path}'`);
  }
  return 0;
};

export const mv: Command = (ctx, argv) => {
  const p = parseArgs(argv, { flags: { '-f': 'force', '--force': 'force' } });
  if (p.error) return fatal(ctx, p.error);
  const repo = requireRepo(ctx);
  if (!repo) return 128;
  if (p.args.length !== 2) {
    ctx.err('usage: git mv [-v] [-f] [-n] [-k] <source> <destination>');
    return 129;
  }
  const [srcArg, dstArg] = p.args;
  const src = repoPath(ctx, repo, srcArg);
  let dst = repoPath(ctx, repo, dstArg);
  if (src === null || dst === null) return fatal(ctx, `'${srcArg}' is outside repository`);
  const worktree = repo.worktree();
  const isDir = (path: string) => ctx.world.isDir(`${repo.root}/${path}`);
  const where = `source=${srcArg}, destination=${dstArg}`;
  if (!(src in worktree) && !isDir(src)) return fatal(ctx, `bad source, ${where}`);
  if (isDir(dst)) dst = `${dst ? `${dst}/` : ''}${src.split('/').pop()}`;
  const moved = [...repo.index.keys()].filter((path) => path === src || path.startsWith(`${src}/`));
  if (moved.length === 0) return fatal(ctx, `not under version control, ${where}`);
  if (dst in worktree && !flag(p, 'force')) return fatal(ctx, `destination exists, ${where}`);
  for (const path of moved) {
    const target = dst + path.slice(src.length);
    const content = repo.index.get(path)!;
    repo.index.delete(path);
    repo.index.set(target, content);
    const local = worktree[path];
    repo.deleteWorktree(path);
    if (local !== undefined) repo.writeWorktree(target, local);
  }
  return 0;
};

export const restore: Command = (ctx, argv) => {
  const p = parseArgs(argv, {
    flags: { '--staged': 'staged', '-S': 'staged', '--worktree': 'worktree', '-W': 'worktree', '--source': 'source', '-s': 'source' },
    values: ['source'],
  });
  if (p.error) return fatal(ctx, p.error);
  const repo = requireRepo(ctx);
  if (!repo) return 128;
  const args = [...p.args, ...(p.paths ?? [])];
  if (args.length === 0) return fatal(ctx, 'you must specify path(s) to restore');
  const specs = pathspecs(ctx, repo, args);
  if (!specs) return 128;

  const staged = flag(p, 'staged');
  const worktree = flag(p, 'worktree') || !staged;
  const sourceRev = value(p, 'source');
  let source: Record<string, string>;
  if (sourceRev) {
    const id = repo.resolve(sourceRev);
    if (!id) return fatal(ctx, `could not resolve ${sourceRev}`);
    source = { ...repo.commits.get(id)!.files };
  } else source = staged ? { ...repo.headFiles() } : Object.fromEntries(repo.index);

  const files = repo.worktree();
  for (const [i, spec] of specs.entries()) {
    const known = [...new Set([...Object.keys(source), ...(staged ? repo.index.keys() : []), ...(sourceRev ? Object.keys(files).filter((f) => repo.index.has(f)) : [])])];
    const paths = known.filter((path) => matchesPathspec(spec, path));
    if (paths.length === 0) {
      ctx.err(`error: pathspec '${args[i]}' did not match any file(s) known to git`);
      return 1;
    }
    for (const path of paths) {
      const content = source[path];
      if (staged) {
        if (content === undefined) repo.index.delete(path);
        else repo.index.set(path, content);
      }
      if (worktree) {
        if (content === undefined) repo.deleteWorktree(path);
        else repo.writeWorktree(path, content);
      }
    }
  }
  return 0;
};
