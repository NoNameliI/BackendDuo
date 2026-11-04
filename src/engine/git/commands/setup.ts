import { flag, parseArgs } from '../args';
import { Repo, resolvePath } from '../world';
import { fatal, requireRepo, type Command } from './common';

export const init: Command = (ctx, argv) => {
  const p = parseArgs(argv, { flags: { '--bare': 'bare', '-q': 'quiet', '--quiet': 'quiet', '-b': 'branch', '--initial-branch': 'branch' }, values: ['branch'] });
  if (p.error) return fatal(ctx, p.error);
  const root = resolvePath(ctx.world.cwd, p.args[0] ?? '.');
  ctx.world.mkdirp(root);
  const existing = ctx.world.repos.get(root);
  const gitDir = flag(p, 'bare') ? root : `${root}/.git`;
  if (existing) {
    if (!flag(p, 'quiet')) ctx.out(`Reinitialized existing Git repository in ${gitDir}/`);
    return 0;
  }
  const repo = new Repo(ctx.world, root, flag(p, 'bare'));
  const branch = p.opts.branch;
  if (Array.isArray(branch)) repo.head = { kind: 'branch', name: branch[branch.length - 1] };
  ctx.world.repos.set(root, repo);
  if (!repo.bare) ctx.world.mkdirp(`${root}/.git`);
  if (!flag(p, 'quiet')) ctx.out(`Initialized empty Git repository in ${gitDir}/`);
  return 0;
};

export const config: Command = (ctx, argv) => {
  const p = parseArgs(argv, {
    flags: { '--global': 'global', '--local': 'local', '--list': 'list', '-l': 'list', '--unset': 'unset', '--get': 'get' },
  });
  if (p.error) return fatal(ctx, p.error);
  const global = flag(p, 'global');
  const repo = global ? null : ctx.world.repoAt(ctx.world.cwd);
  if (!global && !repo && !flag(p, 'list') && p.args.length > 1) {
    ctx.err('fatal: not in a git directory');
    return 128;
  }
  const store = repo ? repo.config : ctx.world.globalConfig;

  if (flag(p, 'list')) {
    const entries = global ? [...ctx.world.globalConfig] : [...ctx.world.globalConfig, ...(repo ? [...repo.config] : [])];
    for (const [k, v] of entries) ctx.out(`${k}=${v}`);
    return 0;
  }
  const [rawKey, ...rest] = p.args;
  if (!rawKey) {
    ctx.err('usage: git config [<options>]');
    return 129;
  }
  if (!/^[a-z][a-z0-9-]*(\.[^.\s]+)*\.[a-z][a-z0-9-]*$/i.test(rawKey)) {
    ctx.err(`error: key does not contain a section: ${rawKey}`);
    return 1;
  }
  const key = rawKey.replace(/^([^.]+)/, (s) => s.toLowerCase()).replace(/\.([^.]+)$/, (_, s: string) => `.${s.toLowerCase()}`);
  if (flag(p, 'unset')) {
    return store.delete(key) ? 0 : 5;
  }
  if (rest.length === 0) {
    const value = global ? ctx.world.globalConfig.get(key) : (repo?.getConfig(key) ?? ctx.world.globalConfig.get(key));
    if (value === undefined) return 1;
    ctx.out(value);
    return 0;
  }
  store.set(key, rest.join(' '));
  return 0;
};

/** Guard used by commands that need a repository with at least one commit. */
export function needsCommits(ctx: Parameters<Command>[0]): ReturnType<typeof requireRepo> {
  const repo = requireRepo(ctx);
  if (repo && !repo.headId()) {
    fatal(ctx, `your current branch '${repo.currentBranch() ?? 'HEAD'}' does not have any commits yet`);
    return null;
  }
  return repo;
}
