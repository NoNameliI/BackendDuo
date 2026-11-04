import { flag, parseArgs, value } from '../args';
import { mergeTrees } from '../merge';
import type { Repo } from '../world';
import { checkoutTree } from './branches';
import { commit } from './commit';
import { fatal, quiet, requireRepo, type Command, type Ctx } from './common';
import { applyMerge, canApply, hardReset, mergeBase, printStat } from './integrate';

/** git's default merge message ("into <branch>" is left out for main and master). */
export function mergeMessage(repo: Repo, target: string): string {
  const current = repo.currentBranch();
  const into = current && current !== 'main' && current !== 'master' ? ` into ${current}` : '';
  if (repo.branches.has(target)) return `Merge branch '${target}'${into}`;
  if (repo.remoteBranches.has(target)) return `Merge remote-tracking branch '${target}'${into}`;
  if (repo.tags.has(target)) return `Merge tag '${target}'${into}`;
  return `Merge commit '${target}'${into}`;
}

export function refuseWhileMerging(ctx: Ctx, repo: Repo, what = 'Merging'): boolean {
  if (repo.conflicts.size) {
    ctx.err(`error: ${what} is not possible because you have unmerged files.`);
    ctx.err("hint: Fix them up in the work tree, and then use 'git add/rm <file>'");
    ctx.err('hint: as appropriate to mark resolution and make a commit.');
    ctx.err('fatal: Exiting because of an unresolved conflict.');
    return true;
  }
  if (repo.merging?.kind === 'merge') {
    ctx.err('fatal: You have not concluded your merge (MERGE_HEAD exists).');
    ctx.err('Please, commit your changes before you merge.');
    return true;
  }
  return false;
}

export interface MergeOptions {
  noFf?: boolean;
  ffOnly?: boolean;
  message?: string;
  /** Name shown in the reflog, e.g. "feature" or "origin/main". */
  label: string;
  reflogPrefix?: string;
}

/** Merges commit `theirs` into HEAD; shared by `merge` and `pull`. */
export function mergeInto(ctx: Ctx, repo: Repo, theirs: string, opts: MergeOptions): number {
  const head = repo.headId();
  const prefix = opts.reflogPrefix ?? `merge ${opts.label}`;
  if (!head) {
    const files = repo.commits.get(theirs)!.files;
    if (!checkoutTree(ctx, repo, files, 'merge')) return 1;
    repo.advanceHead(theirs, `${prefix}: Fast-forward`);
    return 0;
  }
  if (repo.isAncestor(theirs, head)) {
    ctx.out('Already up to date.');
    return 0;
  }
  const before = repo.headFiles();
  if (repo.isAncestor(head, theirs) && !opts.noFf) {
    ctx.out(`Updating ${repo.short(head)}..${repo.short(theirs)}`);
    const files = repo.commits.get(theirs)!.files;
    if (!checkoutTree(ctx, repo, files, 'merge')) return 1;
    ctx.out('Fast-forward');
    repo.origHead = head;
    repo.advanceHead(theirs, `${prefix}: Fast-forward`);
    printStat(ctx, before, files);
    return 0;
  }
  if (opts.ffOnly) {
    for (const line of [
      "Diverging branches can't be fast-forwarded, you need to either:",
      '',
      '\tgit merge --no-ff',
      '',
      'or:',
      '',
      '\tgit rebase',
      '',
      'Disable this message with "git config set advice.diverging false"',
    ]) ctx.err(line ? `hint: ${line}` : 'hint:');
    return fatal(ctx, 'Not possible to fast-forward, aborting.');
  }

  const base = mergeBase(repo, head, theirs);
  const merged = mergeTrees(base ? repo.commits.get(base)!.files : {}, before, repo.commits.get(theirs)!.files, {
    ours: 'HEAD',
    theirs: opts.label,
  });
  if (!canApply(ctx, repo, merged.files)) return 2;
  const message = opts.message ?? mergeMessage(repo, opts.label);
  applyMerge(repo, merged);
  for (const line of merged.messages) ctx.out(line);
  repo.origHead = head;
  if (merged.conflicts.size) {
    // Like MERGE_MSG: the conflicted paths stay in the message as comment lines.
    const conflicted = [...merged.conflicts.keys()].map((path) => `#\t${path}`).join('\n');
    repo.merging = { kind: 'merge', theirs, message: `${message}\n\n# Conflicts:\n${conflicted}\n` };
    ctx.out('Automatic merge failed; fix conflicts and then commit the result.');
    return 1;
  }
  const created = repo.createCommit(merged.index, [head, theirs], message);
  repo.advanceHead(created.id, `${prefix}: Merge made by the 'ort' strategy.`);
  ctx.out("Merge made by the 'ort' strategy.");
  printStat(ctx, before, created.files);
  return 0;
}

export const merge: Command = (outer, argv) => {
  const p = parseArgs(argv, {
    flags: {
      '--abort': 'abort',
      '--continue': 'continue',
      '--no-ff': 'noFf',
      '--ff-only': 'ffOnly',
      '--ff': 'ff',
      '-m': 'message',
      '--message': 'message',
      '--no-edit': 'noEdit',
      '--edit': 'edit',
      '-q': 'quiet',
      '--quiet': 'quiet',
    },
    values: ['message'],
  });
  if (p.error) return fatal(outer, p.error);
  const ctx = flag(p, 'quiet') ? quiet(outer) : outer;
  const repo = requireRepo(ctx);
  if (!repo) return 128;

  if (flag(p, 'abort')) {
    if (repo.merging?.kind !== 'merge') return fatal(ctx, 'There is no merge to abort (MERGE_HEAD missing).');
    hardReset(repo, repo.headFiles());
    repo.merging = null;
    return 0;
  }
  if (flag(p, 'continue')) {
    if (repo.merging?.kind !== 'merge') return fatal(ctx, 'There is no merge in progress (MERGE_HEAD missing).');
    return commit(ctx, ['--no-edit']);
  }
  if (refuseWhileMerging(ctx, repo)) return 128;

  let target = p.args[0];
  if (!target) {
    const branch = repo.currentBranch();
    const up = branch ? repo.upstreams.get(branch) : undefined;
    if (!up) return fatal(ctx, 'No remote for the current branch.');
    target = `${up.remote}/${up.branch}`;
  }
  if (p.args.length > 1) {
    ctx.err('error: в учебной песочнице можно сливать только одну ветку за раз.');
    return 1;
  }
  const theirs = repo.resolve(target);
  if (!theirs) {
    ctx.err(`merge: ${target} - not something we can merge`);
    return 1;
  }
  return mergeInto(ctx, repo, theirs, { noFf: flag(p, 'noFf'), ffOnly: flag(p, 'ffOnly'), message: value(p, 'message'), label: target });
};
