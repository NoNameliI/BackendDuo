import { flag, parseArgs } from '../args';
import { computeStatus } from '../status';
import type { Repo } from '../world';
import { fatal, matchesPathspec, repoPath, requireRepo, shownPath, type Command, type Ctx } from './common';
import { hardReset, oneline } from './integrate';

function unstagedAfterReset(ctx: Ctx, repo: Repo): void {
  const s = computeStatus(repo);
  if (!s.unstaged.length) return;
  ctx.out('Unstaged changes after reset:');
  for (const u of s.unstaged) ctx.out(`${u.kind === 'deleted' ? 'D' : 'M'}\t${shownPath(ctx, repo, u.path)}`);
}

export const reset: Command = (ctx, argv) => {
  const p = parseArgs(argv, {
    flags: { '--soft': 'soft', '--mixed': 'mixed', '--hard': 'hard', '-q': 'quiet', '--quiet': 'quiet', '--merge': 'hard', '--keep': 'hard' },
  });
  if (p.error) return fatal(ctx, p.error);
  const repo = requireRepo(ctx);
  if (!repo) return 128;

  // "git reset <rev>", "git reset <paths>", "git reset <rev> -- <paths>"
  const args = [...p.args];
  const rev = args.length && repo.resolve(args[0]) ? args.shift()! : 'HEAD';
  const pathArgs = [...args, ...(p.paths ?? [])];
  const target = repo.resolve(rev);
  if (!target) {
    if (!repo.headId() && rev === 'HEAD') {
      // Unborn branch: "git reset" unstages everything.
      for (const path of [...repo.index.keys()]) if (!pathArgs.length || pathArgs.some((a) => matchesPathspec(repoPath(ctx, repo, a) ?? a, path))) repo.index.delete(path);
      return 0;
    }
    ctx.err(`fatal: ambiguous argument '${rev}': unknown revision or path not in the working tree.`);
    return 128;
  }
  const files = repo.commits.get(target)!.files;

  if (pathArgs.length) {
    if (flag(p, 'soft') || flag(p, 'hard')) return fatal(ctx, `Cannot do ${flag(p, 'soft') ? 'soft' : 'hard'} reset with paths.`);
    const specs = pathArgs.map((a) => repoPath(ctx, repo, a) ?? a);
    for (const path of new Set([...repo.index.keys(), ...Object.keys(files)])) {
      if (!specs.some((s) => matchesPathspec(s, path))) continue;
      if (files[path] === undefined) repo.index.delete(path);
      else repo.index.set(path, files[path]);
      repo.conflicts.delete(path);
    }
    if (!flag(p, 'quiet')) unstagedAfterReset(ctx, repo);
    return 0;
  }

  const old = repo.headId();
  repo.origHead = old;
  repo.advanceHead(target, `reset: moving to ${rev}`);
  if (flag(p, 'soft')) return 0;
  if (flag(p, 'hard')) {
    hardReset(repo, files);
    repo.merging = null;
    if (!flag(p, 'quiet')) ctx.out(`HEAD is now at ${oneline(repo, target)}`);
    return 0;
  }
  repo.index.clear();
  for (const [path, content] of Object.entries(files)) repo.index.set(path, content);
  repo.conflicts.clear();
  repo.merging = null;
  if (!flag(p, 'quiet')) unstagedAfterReset(ctx, repo);
  return 0;
};
