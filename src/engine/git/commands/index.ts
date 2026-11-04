import { flag, parseArgs } from '../args';
import { computeStatus, formatStatus } from '../status';
import { conflictKind } from '../world';
import { branch, checkout, switchCommand } from './branches';
import { commit } from './commit';
import { fatal, requireRepo, shownPath, type Command, type Ctx } from './common';
import { add, mv, restore, rm } from './files';
import { diff, log, reflog, show } from './history';
import { merge } from './merge';
import { clone, fetch, pull, push, remote } from './remote';
import { reset } from './reset';
import { cherryPick, rebase, revert } from './sequencer';
import { stash } from './stash';
import { tag } from './tags';
import { config, init } from './setup';

const status: Command = (ctx, argv) => {
  const p = parseArgs(argv, { flags: { '-s': 'short', '--short': 'short', '-b': 'branch', '--branch': 'branch', '-sb': 'shortBranch' } });
  if (p.error) return fatal(ctx, p.error);
  const repo = requireRepo(ctx);
  if (!repo) return 128;
  if (!flag(p, 'short')) {
    for (const line of formatStatus(repo)) ctx.out(line);
    return 0;
  }
  if (flag(p, 'branch')) {
    const name = repo.currentBranch();
    const upstream = name ? repo.upstreams.get(name) : undefined;
    let line = name ? `## ${repo.headId() ? name : `No commits yet on ${name}`}` : '## HEAD (no branch)';
    if (name && upstream) {
      const remote = `${upstream.remote}/${upstream.branch}`;
      const theirs = repo.remoteBranches.get(remote);
      const ours = repo.branches.get(name);
      line += `...${remote}`;
      if (theirs && ours) {
        const [ahead, behind] = repo.aheadBehind(ours, theirs);
        const parts = [ahead ? `ahead ${ahead}` : '', behind ? `behind ${behind}` : ''].filter(Boolean);
        if (parts.length) line += ` [${parts.join(', ')}]`;
      } else if (!theirs) line += ' [gone]';
    }
    ctx.out(line);
  }
  const s = computeStatus(repo);
  const codes = new Map<string, [string, string, string?]>();
  for (const c of s.staged) {
    codes.set(c.path, [c.kind === 'added' ? 'A' : c.kind === 'deleted' ? 'D' : c.kind === 'renamed' ? 'R' : 'M', ' ', c.from]);
  }
  for (const u of s.unstaged) {
    const prev = codes.get(u.path) ?? [' ', ' '];
    codes.set(u.path, [prev[0], u.kind === 'deleted' ? 'D' : 'M', prev[2]]);
  }
  const UNMERGED = { 'both modified': 'UU', 'both added': 'AA', 'deleted by us': 'DU', 'deleted by them': 'UD' } as const;
  for (const path of s.conflicts) {
    const code = UNMERGED[conflictKind(repo.conflicts.get(path)!)];
    codes.set(path, [code[0], code[1]]);
  }
  for (const [path, [x, y, from]] of [...codes].sort()) {
    ctx.out(`${x}${y} ${from ? `${shownPath(ctx, repo, from)} -> ` : ''}${shownPath(ctx, repo, path)}`);
  }
  for (const u of s.untracked) ctx.out(`?? ${shownPath(ctx, repo, u.replace(/\/$/, ''))}${u.endsWith('/') ? '/' : ''}`);
  return 0;
};

const COMMANDS: Record<string, Command> = {
  init,
  config,
  status,
  add,
  rm,
  mv,
  restore,
  commit,
  log,
  show,
  diff,
  branch,
  switch: switchCommand,
  checkout,
  merge,
  rebase,
  reset,
  revert,
  'cherry-pick': cherryPick,
  stash,
  tag,
  reflog,
  clone,
  remote,
  fetch,
  pull,
  push,
};

/** Registered by later modules (history rewriting, remotes) to keep this table the single entry point. */
export function registerCommands(more: Record<string, Command>): void {
  Object.assign(COMMANDS, more);
}

/** Real git commands this sandbox does not simulate. */
const UNSUPPORTED = new Set([
  'am', 'apply', 'archive', 'bisect', 'blame', 'bundle', 'cat-file', 'citool', 'clean', 'describe', 'difftool',
  'filter-branch', 'format-patch', 'fsck', 'gc', 'grep', 'gui', 'hash-object', 'instaweb', 'ls-files', 'ls-remote',
  'ls-tree', 'maintenance', 'mergetool', 'notes', 'range-diff', 'replace', 'request-pull', 'rerere', 'rev-list',
  'rev-parse', 'send-email', 'shortlog', 'sparse-checkout', 'submodule', 'svn', 'symbolic-ref', 'update-ref', 'worktree',
]);

export const SANDBOX_NOTE = 'В учебной песочнице это не поддерживается — список отличий от настоящего Git есть в разделе «Отличия песочницы».';

/** One git invocation: one tick of the sandbox clock, so all commits it makes share a timestamp. */
export function runGit(ctx: Ctx, argv: string[]): number {
  ctx.world.tick();
  return dispatch(ctx, argv);
}

function dispatch(ctx: Ctx, argv: string[]): number {
  const [name, ...rest] = argv;
  if (!name || name === 'help' || name === '--help' || name === '-h') {
    ctx.out('usage: git <command> [<args>]');
    ctx.out('');
    ctx.out(`Команды песочницы: ${Object.keys(COMMANDS).sort().join(', ')}.`);
    return name ? 0 : 1;
  }
  if (name === '--version' || name === 'version') {
    ctx.out('git version 2.53.0 (учебная песочница)');
    return 0;
  }
  const command = COMMANDS[name];
  if (command) return command(ctx, rest);

  const repo = ctx.world.repoAt(ctx.world.cwd);
  const alias = repo?.getConfig(`alias.${name}`) ?? ctx.world.globalConfig.get(`alias.${name.toLowerCase()}`);
  if (alias !== undefined) {
    if (alias.startsWith('!')) {
      ctx.err(`error: алиасы с командами оболочки (${name} = ${alias}) не поддерживаются.`);
      ctx.err(SANDBOX_NOTE);
      return 1;
    }
    return dispatch(ctx, [...splitAlias(alias), ...rest]);
  }
  if (UNSUPPORTED.has(name)) {
    ctx.err(`git ${name}: ${SANDBOX_NOTE}`);
    return 1;
  }
  ctx.err(`git: '${name}' is not a git command. See 'git --help'.`);
  return 1;
}

function splitAlias(alias: string): string[] {
  return alias.match(/"[^"]*"|'[^']*'|\S+/g)?.map((w) => w.replace(/^["']|["']$/g, '')) ?? [];
}
