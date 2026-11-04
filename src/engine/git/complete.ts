import { computeStatus } from './status';
import { displayPath, relativePath, resolvePath, type World } from './world';

export const SHELL_COMMANDS = ['cat', 'cd', 'clear', 'echo', 'git', 'ls', 'mkdir', 'mv', 'pwd', 'rm', 'touch'];

export const GIT_COMMANDS = [
  'add', 'branch', 'checkout', 'cherry-pick', 'clone', 'commit', 'config', 'diff', 'fetch', 'init', 'log', 'merge',
  'mv', 'pull', 'push', 'rebase', 'reflog', 'remote', 'reset', 'restore', 'revert', 'rm', 'show', 'stash', 'status',
  'switch', 'tag',
];

const REF_COMMANDS = new Set(['switch', 'checkout', 'merge', 'rebase', 'branch', 'reset', 'log', 'show', 'diff', 'cherry-pick', 'revert', 'tag', 'push', 'pull', 'fetch']);

const STATE_NAMES = { merge: 'MERGING', rebase: 'REBASE', 'cherry-pick': 'CHERRY-PICKING', revert: 'REVERTING' } as const;

/** Shell prompt in the style of git's own bash prompt: `~/site (main) $`. */
export function prompt(world: World): string {
  const repo = world.repoAt(world.cwd);
  if (!repo || repo.bare) return `${displayPath(world.cwd)} $`;
  const rebase = repo.rebase;
  const state = rebase
    ? `|REBASE ${rebase.done.length}/${rebase.done.length + rebase.todo.length}`
    : repo.merging
      ? `|${STATE_NAMES[repo.merging.kind]}`
      : '';
  const where = repo.currentBranch() ?? (rebase?.branch ? `${rebase.branch}` : `${repo.short(repo.headId()!)}...`);
  return `${displayPath(world.cwd)} (${where}${state}) $`;
}

function pathCandidates(world: World, partial: string): string[] {
  const slash = partial.lastIndexOf('/');
  const dirPart = slash === -1 ? '' : partial.slice(0, slash + 1);
  const dir = resolvePath(world.cwd, dirPart || '.');
  const prefix = dir === '/' ? '/' : `${dir}/`;
  const names = new Map<string, boolean>();
  for (const path of world.files.keys()) if (path.startsWith(prefix)) {
    const rest = path.slice(prefix.length);
    const name = rest.split('/')[0];
    if (!names.has(name)) names.set(name, rest.includes('/'));
  }
  for (const path of world.dirs) if (path.startsWith(prefix) && path.length > prefix.length) names.set(path.slice(prefix.length).split('/')[0], true);
  return [...names].filter(([name]) => !name.startsWith('.git') || name === '.gitignore').map(([name, isDir]) => `${dirPart}${name}${isDir ? '/' : ''}`);
}

/** Candidates for the last word of a command line (Tab completion). */
export function completions(world: World, line: string): string[] {
  const words = line.split(/\s+/);
  const last = words.at(-1) ?? '';
  const pick = (all: Iterable<string>) => [...new Set(all)].filter((c) => c.startsWith(last)).sort();
  if (words.length === 1) return pick(SHELL_COMMANDS);
  if (words[0] !== 'git') return pick(pathCandidates(world, last));
  if (words.length === 2) return pick(GIT_COMMANDS);

  const repo = world.repoAt(world.cwd);
  const sub = words[1];
  if (last.startsWith('-') || !repo) return pick(pathCandidates(world, last));
  if (sub === 'add' || sub === 'restore' || sub === 'rm') {
    const s = computeStatus(repo);
    const rel = (p: string) => (world.cwd === repo.root ? p : relativePath(world.cwd, `${repo.root}/${p}`));
    const changed = [...s.unstaged.map((c) => c.path), ...s.untracked, ...s.conflicts, ...s.staged.map((c) => c.path)].map(rel);
    const fromStatus = pick(changed);
    return fromStatus.length ? fromStatus : pick(pathCandidates(world, last));
  }
  if (REF_COMMANDS.has(sub)) {
    const refs = [...repo.branches.keys(), ...repo.tags.keys(), ...repo.remoteBranches.keys(), ...repo.remotes.keys(), 'HEAD'];
    return pick(refs.length ? refs : pathCandidates(world, last));
  }
  return pick(pathCandidates(world, last));
}

/** Longest common prefix of the candidates; what Tab inserts when there are several. */
export function commonPrefix(items: string[]): string {
  if (!items.length) return '';
  let prefix = items[0];
  for (const item of items) while (!item.startsWith(prefix)) prefix = prefix.slice(0, -1);
  return prefix;
}
