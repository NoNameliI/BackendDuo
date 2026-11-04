import { flag, parseArgs } from '../args';
import { mergeTrees } from '../merge';
import type { Commit } from '../objects';
import { computeStatus, formatStatus } from '../status';
import type { Repo } from '../world';
import { checkoutTree } from './branches';
import { reportCommit } from './commit';
import { fatal, requireRepo, type Command, type Ctx } from './common';
import { applyMerge, canApply, hardReset } from './integrate';

const subjectOf = (c: Commit) => c.message.split('\n')[0];

/** Applies the change a commit made (or its inverse) on top of HEAD. */
function replay(repo: Repo, c: Commit, revert: boolean) {
  const parent = c.parents[0] ? repo.commits.get(c.parents[0])!.files : {};
  const short = repo.short(c.id);
  return revert
    ? mergeTrees(c.files, repo.headFiles(), parent, { ours: 'HEAD', theirs: `parent of ${short} (${subjectOf(c)})` })
    : mergeTrees(parent, repo.headFiles(), c.files, { ours: 'HEAD', theirs: `${short} (${subjectOf(c)})` });
}

function revertMessage(c: Commit): string {
  const subject = subjectOf(c);
  const reverted = /^Revert "(.*)"$/.exec(subject);
  const title = reverted ? `Reapply "${reverted[1]}"` : `Revert "${subject}"`;
  return `${title}\n\nThis reverts commit ${c.id}.\n`;
}

const sameTree = (repo: Repo, files: Record<string, string>) => {
  const head = repo.headFiles();
  const keys = Object.keys(files);
  return keys.length === Object.keys(head).length && keys.every((k) => head[k] === files[k]);
};

function conflictHints(ctx: Ctx, op: 'cherry-pick' | 'revert'): void {
  for (const line of [
    'After resolving the conflicts, mark them with',
    '"git add/rm <pathspec>", then run',
    `"git ${op} --continue".`,
    `You can instead skip this commit with "git ${op} --skip".`,
    `To abort and get back to the state before "git ${op}",`,
    `run "git ${op} --abort".`,
    'Disable this message with "git config set advice.mergeConflict false"',
  ]) ctx.err(`hint: ${line}`);
}

function pickOne(ctx: Ctx, repo: Repo, id: string, op: 'cherry-pick' | 'revert'): number {
  const c = repo.commits.get(id)!;
  if (c.parents.length > 1) {
    ctx.err(`error: commit ${id} is a merge but no -m option was given.`);
    return fatal(ctx, `${op} failed`);
  }
  const revert = op === 'revert';
  const merged = replay(repo, c, revert);
  if (!canApply(ctx, repo, merged.files)) return fatal(ctx, `${op} failed`);
  const message = revert ? revertMessage(c) : c.message;
  const author = revert ? undefined : c.author;
  applyMerge(repo, merged);
  for (const line of merged.messages) ctx.out(line);
  if (merged.conflicts.size) {
    repo.merging = { kind: op, theirs: id, message, author };
    ctx.err(`error: could not ${op === 'revert' ? 'revert' : 'apply'} ${repo.short(id)}... ${subjectOf(c)}`);
    conflictHints(ctx, op);
    return 1;
  }
  if (sameTree(repo, merged.index)) {
    repo.merging = { kind: op, theirs: id, message, author };
    ctx.out(`The previous ${op} is now empty, possibly due to conflict resolution.`);
    ctx.out('If you wish to commit it anyway, use:');
    ctx.out('');
    ctx.out('    git commit --allow-empty');
    ctx.out('');
    ctx.out(`Otherwise, please use 'git ${op} --skip'`);
    for (const line of formatStatus(repo)) ctx.out(line);
    return 1;
  }
  const created = repo.createCommit(merged.index, [repo.headId()!], message, author);
  repo.advanceHead(created.id, `${op}: ${subjectOf(created)}`);
  reportCommit(ctx, repo, created.id, false, true);
  return 0;
}

/** cherry-pick and revert: one commit at a time, with --continue / --skip / --abort. */
function sequencer(op: 'cherry-pick' | 'revert'): Command {
  return (ctx, argv) => {
    const p = parseArgs(argv, {
      flags: { '--continue': 'continue', '--abort': 'abort', '--skip': 'skip', '--no-edit': 'noEdit', '--edit': 'edit', '-e': 'edit', '-x': 'x' },
    });
    if (p.error) return fatal(ctx, p.error);
    const repo = requireRepo(ctx);
    if (!repo) return 128;
    const pending = repo.merging?.kind === op ? repo.merging : null;

    if (flag(p, 'abort') || flag(p, 'skip')) {
      if (!pending) return fatal(ctx, `no ${op} in progress`);
      hardReset(repo, repo.headFiles());
      repo.merging = null;
      return 0;
    }
    if (flag(p, 'continue')) {
      if (!pending) return fatal(ctx, `no ${op} in progress`);
      if (repo.conflicts.size) {
        ctx.err('error: Committing is not possible because you have unmerged files.');
        ctx.err("hint: Fix them up in the work tree, and then use 'git add/rm <file>'");
        ctx.err('hint: as appropriate to mark resolution and make a commit.');
        return fatal(ctx, 'Exiting because of an unresolved conflict.');
      }
      const files = Object.fromEntries(repo.index);
      const created = repo.createCommit(files, [repo.headId()!], pending.message, pending.author);
      repo.merging = null;
      repo.advanceHead(created.id, `commit (${op}): ${subjectOf(created)}`);
      reportCommit(ctx, repo, created.id, false, true);
      return 0;
    }
    if (repo.merging) {
      ctx.err(`error: ${op} is not possible because you have unmerged files.`);
      return fatal(ctx, `${op} failed`);
    }
    if (!p.args.length) return fatal(ctx, `empty commit set passed`);
    for (const rev of p.args) {
      const id = repo.resolve(rev);
      if (!id) return fatal(ctx, `bad revision '${rev}'`);
      const code = pickOne(ctx, repo, id, op);
      if (code !== 0) return code;
    }
    return 0;
  };
}

export const cherryPick = sequencer('cherry-pick');
export const revert = sequencer('revert');

/** Commits of HEAD not reachable from `upstream`, oldest first, without merge commits. */
function commitsToReplay(repo: Repo, head: string, upstream: string): string[] {
  const exclude = repo.ancestors(upstream);
  const out: string[] = [];
  for (let id: string | undefined = head; id && !exclude.has(id); id = repo.commits.get(id)!.parents[0]) {
    if (repo.commits.get(id)!.parents.length <= 1) out.unshift(id);
  }
  return out;
}

function finishRebase(ctx: Ctx, repo: Repo): number {
  const state = repo.rebase!;
  const head = repo.headId()!;
  if (state.branch) {
    repo.branches.set(state.branch, head);
    repo.head = { kind: 'branch', name: state.branch };
    repo.reflog.unshift({ id: head, message: `rebase (finish): returning to refs/heads/${state.branch}` });
  }
  repo.rebase = null;
  ctx.err(`Successfully rebased and updated ${state.branch ? `refs/heads/${state.branch}` : 'detached HEAD'}.`);
  return 0;
}

/** Applies the remaining commits of the rebase; stops at the first conflict. */
function continueRebase(ctx: Ctx, repo: Repo): number {
  const state = repo.rebase!;
  while (state.todo.length) {
    const id = state.todo.shift()!;
    state.done.push(id);
    const c = repo.commits.get(id)!;
    const merged = replay(repo, c, false);
    applyMerge(repo, merged);
    if (merged.conflicts.size) {
      for (const line of merged.messages) ctx.out(line);
      repo.merging = { kind: 'rebase', theirs: id, message: c.message, author: c.author };
      ctx.err(`error: could not apply ${repo.short(id)}... ${subjectOf(c)}`);
      for (const line of [
        'Resolve all conflicts manually, mark them as resolved with',
        '"git add/rm <conflicted_files>", then run "git rebase --continue".',
        'You can instead skip this commit: run "git rebase --skip".',
        'To abort and get back to the state before "git rebase", run "git rebase --abort".',
        'Disable this message with "git config set advice.mergeConflict false"',
      ]) ctx.err(`hint: ${line}`);
      ctx.err(`Could not apply ${repo.short(id)}... # ${subjectOf(c)}`);
      return 1;
    }
    if (sameTree(repo, merged.index)) continue;
    const created = repo.createCommit(merged.index, [repo.headId()!], c.message, c.author);
    repo.advanceHead(created.id, `rebase (pick): ${subjectOf(c)}`);
  }
  return finishRebase(ctx, repo);
}

export const rebase: Command = (ctx, argv) => {
  const p = parseArgs(argv, {
    flags: { '--continue': 'continue', '--abort': 'abort', '--skip': 'skip', '-i': 'interactive', '--interactive': 'interactive' },
  });
  if (p.error) return fatal(ctx, p.error);
  const repo = requireRepo(ctx);
  if (!repo) return 128;
  const state = repo.rebase;

  if (flag(p, 'interactive')) {
    ctx.err('error: интерактивный rebase (-i) открывает редактор, а его в учебной песочнице нет.');
    ctx.err('hint: чтобы объединить коммиты, используйте git reset --soft <коммит> и новый git commit.');
    return 1;
  }
  if (flag(p, 'abort')) {
    if (!state) return fatal(ctx, 'No rebase in progress?');
    hardReset(repo, repo.commits.get(state.origHead)!.files);
    repo.merging = null;
    repo.rebase = null;
    if (state.branch) {
      repo.branches.set(state.branch, state.origHead);
      repo.head = { kind: 'branch', name: state.branch };
    } else repo.head = { kind: 'detached', id: state.origHead };
    repo.reflog.unshift({ id: state.origHead, message: `rebase (abort): returning to ${state.branch ? `refs/heads/${state.branch}` : state.origHead}` });
    return 0;
  }
  if (flag(p, 'skip')) {
    if (!state) return fatal(ctx, 'No rebase in progress?');
    hardReset(repo, repo.headFiles());
    repo.merging = null;
    return continueRebase(ctx, repo);
  }
  if (flag(p, 'continue')) {
    if (!state) return fatal(ctx, 'No rebase in progress?');
    if (repo.conflicts.size) {
      ctx.err('error: you must edit all merge conflicts and then');
      ctx.err('mark them as resolved using git add');
      return 1;
    }
    const pending = repo.merging;
    if (pending?.kind === 'rebase' && computeStatus(repo).staged.length) {
      const created = repo.createCommit(Object.fromEntries(repo.index), [repo.headId()!], pending.message, pending.author);
      repo.advanceHead(created.id, `rebase (continue): ${subjectOf(created)}`);
      reportCommit(ctx, repo, created.id, false);
    }
    repo.merging = null;
    return continueRebase(ctx, repo);
  }
  if (state) {
    ctx.err('fatal: It seems that there is already a rebase-merge directory, and');
    ctx.err('I wonder if you are in the middle of another rebase.  If that is the');
    ctx.err('case, please try');
    ctx.err('\tgit rebase (--continue | --abort | --skip)');
    return 128;
  }

  const upstreamArg = p.args[0] ?? (() => {
    const b = repo.currentBranch();
    const up = b ? repo.upstreams.get(b) : undefined;
    return up ? `${up.remote}/${up.branch}` : undefined;
  })();
  if (!upstreamArg) {
    ctx.err('There is no tracking information for the current branch.');
    ctx.err('Please specify which branch you want to rebase against.');
    return 1;
  }
  const upstream = repo.resolve(upstreamArg);
  if (!upstream) return fatal(ctx, `invalid upstream '${upstreamArg}'`);
  const s = computeStatus(repo);
  if (s.unstaged.length || s.staged.length) {
    ctx.err(`error: cannot rebase: ${s.unstaged.length ? 'You have unstaged changes.' : 'Your index contains uncommitted changes.'}`);
    ctx.err('error: Please commit or stash them.');
    return 1;
  }
  const head = repo.headId()!;
  const branch = repo.currentBranch();
  if (repo.isAncestor(upstream, head)) {
    ctx.out(`Current branch ${branch ?? 'HEAD'} is up to date.`);
    return 0;
  }
  const todo = commitsToReplay(repo, head, upstream);
  if (!checkoutTree(ctx, repo, repo.commits.get(upstream)!.files)) return 1;
  repo.origHead = head;
  repo.rebase = { branch, origHead: head, onto: upstream, todo, done: [] };
  repo.head = { kind: 'detached', id: upstream };
  repo.reflog.unshift({ id: upstream, message: `rebase (start): checkout ${upstreamArg}` });
  return continueRebase(ctx, repo);
};
