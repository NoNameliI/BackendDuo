import { flag, parseArgs, valuesOf } from '../args';
import { cleanMessage, formatDate } from '../objects';
import { compareFiles, formatSummary } from '../patch';
import { formatStatus } from '../status';
import type { Repo } from '../world';
import { fatal, requireRepo, type Command, type Ctx } from './common';

/**
 * Prints "[main 1a2b3c4] subject" and the change summary. git shows the author date when the author was
 * taken from another commit (amend, cherry-pick, revert), not for commits it records on its own.
 */
export function reportCommit(ctx: Ctx, repo: Repo, id: string, root: boolean, showDate = false): void {
  const commit = repo.commits.get(id)!;
  const where = repo.currentBranch() ?? 'detached HEAD';
  ctx.out(`[${where}${root ? ' (root-commit)' : ''} ${repo.short(id)}] ${commit.message.split('\n')[0]}`);
  if (showDate) ctx.out(` Date: ${formatDate(commit.author)}`);
  const parent = commit.parents[0] ? repo.commits.get(commit.parents[0])!.files : {};
  if (commit.parents.length > 1) return;
  for (const line of formatSummary(compareFiles(parent, commit.files))) ctx.out(line);
}

export const commit: Command = (ctx, argv) => {
  const p = parseArgs(argv, {
    flags: {
      '-m': 'message',
      '--message': 'message',
      '-a': 'all',
      '--all': 'all',
      '--amend': 'amend',
      '--no-edit': 'noEdit',
      '--allow-empty': 'allowEmpty',
      '-q': 'quiet',
      '--quiet': 'quiet',
    },
    values: ['message'],
  });
  if (p.error) return fatal(ctx, p.error);
  const repo = requireRepo(ctx);
  if (!repo) return 128;

  if (repo.conflicts.size > 0) {
    ctx.err('error: Committing is not possible because you have unmerged files.');
    ctx.err("hint: Fix them up in the work tree, and then use 'git add/rm <file>'");
    ctx.err('hint: as appropriate to mark resolution and make a commit.');
    fatal(ctx, 'Exiting because of an unresolved conflict.');
    for (const path of [...repo.conflicts.keys()].sort()) ctx.out(`U\t${path}`);
    return 128;
  }
  const amend = flag(p, 'amend');
  const head = repo.headCommit();
  if (amend && !head) return fatal(ctx, 'You have nothing to amend.');

  if (flag(p, 'all')) {
    const worktree = repo.worktree();
    for (const path of [...repo.index.keys()]) {
      if (!(path in worktree)) repo.index.delete(path);
      else repo.index.set(path, worktree[path]);
    }
  }

  const messages = valuesOf(p, 'message');
  let message = messages.join('\n\n');
  if (!messages.length) {
    if (amend && flag(p, 'noEdit')) message = head!.message;
    else if (repo.merging) message = repo.merging.message;
    else {
      ctx.err('error: в учебной песочнице нет текстового редактора для сообщения коммита.');
      ctx.err('hint: укажите сообщение прямо в команде: git commit -m "Что изменилось"');
      return 1;
    }
  }
  if (!cleanMessage(message)) {
    ctx.err('Aborting commit due to empty commit message.');
    return 1;
  }

  const files = Object.fromEntries(repo.index);
  const base = amend ? head!.parents[0] : head?.id;
  const baseFiles = base ? repo.commits.get(base)!.files : {};
  const changed = compareFiles(amend ? baseFiles : repo.headFiles(), files).length > 0;
  if (!changed && !amend && !repo.merging && !flag(p, 'allowEmpty')) {
    for (const line of formatStatus(repo, 'commit')) ctx.out(line);
    return 1;
  }

  const pending = repo.merging;
  const merging = pending?.kind === 'merge';
  const parents = amend ? head!.parents : [...(head ? [head.id] : []), ...(merging ? [pending.theirs] : [])];
  const author = amend ? head!.author : pending?.author;
  const created = repo.createCommit(files, parents, message, author);
  const subject = created.message.split('\n')[0];
  const kind = amend ? ' (amend)' : merging ? ' (merge)' : pending?.kind === 'cherry-pick' ? ' (cherry-pick)' : head ? '' : ' (initial)';
  repo.advanceHead(created.id, `commit${kind}: ${subject}`);
  repo.merging = null;
  if (!flag(p, 'quiet')) reportCommit(ctx, repo, created.id, created.parents.length === 0 && !amend, amend);
  return 0;
};
