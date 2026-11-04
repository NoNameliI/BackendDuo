import { flag, parseArgs } from '../args';
import { Repo, resolvePath, type RefUpdate } from '../world';
import { fatal, quiet, requireRepo, type Command, type Ctx } from './common';
import { mergeInto, refuseWhileMerging } from './merge';
import { rebase } from './sequencer';

/** Copies the commits reachable from `tips` (objects are immutable, so they are shared). */
function copyObjects(from: Repo, to: Repo, tips: string[]): void {
  for (const tip of tips) {
    for (const id of from.ancestors(tip)) if (!to.commits.has(id)) to.commits.set(id, from.commits.get(id)!);
  }
}

/** "/srv/origin.git" is shown as "/srv/origin" in fetch and pull messages, like git does. */
const shortUrl = (url: string) => url.replace(/\/$/, '').replace(/\.git$/, '');

function cannotRead(ctx: Ctx, name: string): number {
  ctx.err(`fatal: '${name}' does not appear to be a git repository`);
  ctx.err('fatal: Could not read from remote repository.');
  ctx.err('');
  ctx.err('Please make sure you have the correct access rights');
  ctx.err('and the repository exists.');
  return 128;
}

function remoteRepo(ctx: Ctx, repo: Repo, name: string): { url: string; remote: Repo } | null {
  const url = repo.remotes.get(name) ?? name;
  const remote = ctx.world.findRemote(url, repo.root);
  if (!remote) {
    cannotRead(ctx, name);
    return null;
  }
  return { url, remote };
}

const summary = (text: string) => text.padEnd(17);

export const clone: Command = (ctx, argv) => {
  const p = parseArgs(argv, { flags: { '-q': 'quiet', '--quiet': 'quiet', '-b': 'branch', '--branch': 'branch' }, values: ['branch'] });
  if (p.error) return fatal(ctx, p.error);
  const [url, dirArg] = p.args;
  if (!url) return fatal(ctx, 'You must specify a repository to clone.');
  const world = ctx.world;
  const source = world.findRemote(url, world.cwd);
  if (!source) return fatal(ctx, `repository '${url}' does not exist`);
  const dir = dirArg ?? url.replace(/\/$/, '').split('/').pop()!.replace(/\.git$/, '');
  const dest = resolvePath(world.cwd, dir);
  if (world.files.has(dest) || (world.isDir(dest) && !world.isEmptyDir(dest))) {
    return fatal(ctx, `destination path '${dir}' already exists and is not an empty directory.`);
  }
  if (!flag(p, 'quiet')) ctx.err(`Cloning into '${dir}'...`);

  world.mkdirp(`${dest}/.git`);
  const repo = new Repo(world, dest);
  world.repos.set(dest, repo);
  const stored = /^[a-z]+:\/\//.test(url) ? url : resolvePath(world.cwd, url);
  repo.remotes.set('origin', stored);
  copyObjects(source, repo, [...source.branches.values(), ...[...source.tags.values()].map((t) => t.target)]);
  for (const [name, t] of source.tags) repo.tags.set(name, t);
  const headBranch = source.head.kind === 'branch' ? source.head.name : 'main';
  if (source.branches.has(headBranch)) repo.remoteHeads.set('origin', headBranch);
  for (const [name, id] of source.branches) repo.setRemoteBranch('origin', name, id);

  const branch = p.opts.branch ? String((p.opts.branch as string[]).at(-1)) : headBranch;
  repo.head = { kind: 'branch', name: branch };
  repo.upstreams.set(branch, { remote: 'origin', branch });
  const tip = source.branches.get(branch);
  if (tip) {
    repo.branches.set(branch, tip);
    for (const [path, content] of Object.entries(repo.commits.get(tip)!.files)) {
      repo.index.set(path, content);
      repo.writeWorktree(path, content);
    }
    repo.reflog.unshift({ id: tip, message: `clone: from ${stored}` });
  } else if (source.branches.size === 0) {
    ctx.err('warning: You appear to have cloned an empty repository.');
  } else {
    return fatal(ctx, `Remote branch ${branch} not found in upstream origin`);
  }
  if (!flag(p, 'quiet') && !/^[a-z]+:\/\//.test(url)) ctx.err('done.');
  return 0;
};

/** Updates remote-tracking branches of `name` from the remote repository; prints git's ref table. */
export function fetchFrom(ctx: Ctx, repo: Repo, name: string, opts: { prune?: boolean } = {}): boolean {
  const found = remoteRepo(ctx, repo, name);
  if (!found) return false;
  const { url, remote } = found;
  const rows: [string, string, string][] = [];
  copyObjects(remote, repo, [...remote.branches.values(), ...[...remote.tags.values()].map((t) => t.target)]);
  for (const branch of [...remote.branches.keys()].sort()) {
    const id = remote.branches.get(branch)!;
    const old = repo.remoteBranches.get(`${name}/${branch}`);
    if (old === id) continue;
    const key = `${name}/${branch}`;
    if (!old) rows.push([' * ', summary('[new branch]'), `${branch}\u0000${key}`]);
    else if (repo.isAncestor(old, id)) rows.push(['   ', summary(`${repo.short(old)}..${repo.short(id)}`), `${branch}\u0000${key}`]);
    else rows.push([' + ', summary(`${repo.short(old)}...${repo.short(id)}`), `${branch}\u0000${key}\u0000(forced update)`]);
    repo.setRemoteBranch(name, branch, id);
  }
  if (!repo.remoteHeads.has(name)) {
    const head = remote.head.kind === 'branch' ? remote.head.name : undefined;
    if (head && remote.branches.has(head)) {
      repo.remoteHeads.set(name, head);
      repo.setRemoteBranch(name, head, remote.branches.get(head));
    }
  }
  for (const [tagName, t] of [...remote.tags].sort()) {
    if (repo.tags.has(tagName)) continue;
    repo.tags.set(tagName, t);
    rows.push([' * ', summary('[new tag]'), `${tagName}\u0000${tagName}`]);
  }
  if (opts.prune) {
    for (const key of [...repo.remoteBranches.keys()].sort()) {
      const [r, ...rest] = key.split('/');
      const branch = rest.join('/');
      if (r !== name || branch === 'HEAD' || remote.branches.has(branch)) continue;
      repo.setRemoteBranch(name, branch, undefined);
      rows.push([' - ', summary('[deleted]'), `(none)\u0000${key}`]);
    }
  }
  if (rows.length) {
    const width = Math.max(10, ...rows.map((r) => r[2].split('\u0000')[0].length));
    ctx.err(`From ${shortUrl(url)}`);
    for (const [mark, what, refs] of rows) {
      const [from, to, note] = refs.split('\u0000');
      ctx.err(`${mark}${what} ${from.padEnd(width)} -> ${to}${note ? `  ${note}` : ''}`);
    }
  }
  return true;
}

export const fetch: Command = (outer, argv) => {
  const p = parseArgs(argv, { flags: { '-q': 'quiet', '--quiet': 'quiet', '-p': 'prune', '--prune': 'prune', '--all': 'all' } });
  if (p.error) return fatal(outer, p.error);
  const ctx = flag(p, 'quiet') ? quiet(outer) : outer;
  const repo = requireRepo(ctx);
  if (!repo) return 128;
  const names = flag(p, 'all') ? [...repo.remotes.keys()] : [p.args[0] ?? defaultRemote(repo)];
  if (!names[0]) {
    ctx.err('fatal: No remote repository specified.  Please, specify either a URL or a');
    ctx.err('remote name from which new revisions should be fetched.');
    return 128;
  }
  for (const name of names) if (!fetchFrom(ctx, repo, name, { prune: flag(p, 'prune') })) return 128;
  return 0;
};

function defaultRemote(repo: Repo): string | undefined {
  const branch = repo.currentBranch();
  return (branch && repo.upstreams.get(branch)?.remote) ?? (repo.remotes.has('origin') ? 'origin' : [...repo.remotes.keys()][0]);
}

export const pull: Command = (outer, argv) => {
  const p = parseArgs(argv, {
    flags: { '-q': 'quiet', '--quiet': 'quiet', '--rebase': 'rebase', '-r': 'rebase', '--no-rebase': 'noRebase', '--ff-only': 'ffOnly', '--no-edit': 'noEdit', '--ff': 'ff', '--no-ff': 'noFf' },
  });
  if (p.error) return fatal(outer, p.error);
  const ctx = flag(p, 'quiet') ? quiet(outer) : outer;
  const repo = requireRepo(ctx);
  if (!repo) return 128;
  if (refuseWhileMerging(ctx, repo, 'Pulling')) return 128;
  const branch = repo.currentBranch();
  const up = branch ? repo.upstreams.get(branch) : undefined;
  const remoteName = p.args[0] ?? up?.remote;
  const remoteBranch = p.args[1] ?? (p.args[0] ? undefined : up?.branch);
  if (!remoteName || !remoteBranch) {
    if (remoteName && !fetchFrom(ctx, repo, remoteName)) return 128;
    ctx.err('There is no tracking information for the current branch.');
    ctx.err('Please specify which branch you want to merge with.');
    ctx.err('See git-pull(1) for details.');
    ctx.err('');
    ctx.err('    git pull <remote> <branch>');
    ctx.err('');
    ctx.err('If you wish to set tracking information for this branch you can do so with:');
    ctx.err('');
    ctx.err(`    git branch --set-upstream-to=${remoteName ?? 'origin'}/<branch> ${branch ?? '<branch>'}`);
    ctx.err('');
    return 1;
  }
  if (!fetchFrom(ctx, repo, remoteName)) return 128;
  const tracking = `${remoteName}/${remoteBranch}`;
  const theirs = repo.remoteBranches.get(tracking);
  if (!theirs) return fatal(ctx, `couldn't find remote ref ${remoteBranch}`);
  const useRebase = flag(p, 'rebase') || (!flag(p, 'noRebase') && repo.getConfig('pull.rebase') === 'true');
  if (useRebase) return rebase(ctx, [tracking]);
  const url = repo.remotes.get(remoteName) ?? remoteName;
  return mergeInto(ctx, repo, theirs, {
    label: tracking,
    message: `Merge branch '${remoteBranch}' of ${shortUrl(url)}`,
    ffOnly: flag(p, 'ffOnly'),
    noFf: flag(p, 'noFf'),
    reflogPrefix: 'pull',
  });
};

function noUpstream(ctx: Ctx, branch: string, remote: string): number {
  ctx.err(`fatal: The current branch ${branch} has no upstream branch.`);
  ctx.err('To push the current branch and set the remote as upstream, use');
  ctx.err('');
  ctx.err(`    git push --set-upstream ${remote} ${branch}`);
  ctx.err('');
  ctx.err('To have this happen automatically for branches without a tracking');
  ctx.err("upstream, see 'push.autoSetupRemote' in 'git help config'.");
  ctx.err('');
  return 128;
}

export const push: Command = (outer, argv) => {
  const p = parseArgs(argv, {
    flags: {
      '-u': 'upstream', '--set-upstream': 'upstream', '-f': 'force', '--force': 'force', '--force-with-lease': 'force',
      '-d': 'delete', '--delete': 'delete', '--tags': 'tags', '-q': 'quiet', '--quiet': 'quiet', '--all': 'all',
    },
  });
  if (p.error) return fatal(outer, p.error);
  const ctx = flag(p, 'quiet') ? quiet(outer) : outer;
  const repo = requireRepo(ctx);
  if (!repo) return 128;
  const current = repo.currentBranch();
  const remoteName = p.args[0] ?? defaultRemote(repo);
  if (!remoteName) {
    ctx.err('fatal: No configured push destination.');
    ctx.err('Either specify the URL from the command-line or configure a remote repository using');
    ctx.err('');
    ctx.err('    git remote add <name> <url>');
    ctx.err('');
    ctx.err('and then push using the remote name');
    ctx.err('');
    ctx.err('    git push <name>');
    ctx.err('');
    return 128;
  }
  const found = remoteRepo(ctx, repo, remoteName);
  if (!found) return 128;
  const { url, remote } = found;

  // Refspecs: "branch", "src:dst", tags; none means the current branch to its upstream.
  type Spec = { src: string | null; dst: string; tag: boolean };
  const specs: Spec[] = [];
  for (const arg of p.args.slice(1)) {
    const [src, dst] = arg.includes(':') ? arg.split(':') : [arg, arg];
    const name = src === 'HEAD' ? current ?? 'HEAD' : src;
    const dstName = dst === 'HEAD' ? current ?? 'HEAD' : dst;
    specs.push({ src: flag(p, 'delete') || src === '' ? null : name, dst: dstName.replace(/^refs\/(heads|tags)\//, ''), tag: repo.tags.has(name) && !repo.branches.has(name) });
  }
  if (flag(p, 'all')) for (const name of [...repo.branches.keys()].sort()) specs.push({ src: name, dst: name, tag: false });
  if (flag(p, 'tags')) for (const name of [...repo.tags.keys()].sort()) specs.push({ src: name, dst: name, tag: true });
  if (!specs.length) {
    if (!current) return fatal(ctx, 'You are not currently on a branch.');
    const up = repo.upstreams.get(current);
    if (!up && !flag(p, 'upstream')) return noUpstream(ctx, current, remoteName);
    specs.push({ src: current, dst: up && up.remote === remoteName ? up.branch : current, tag: false });
  }

  const rows: string[] = [];
  let rejected: 'fetch first' | 'non-fast-forward' | null = null;
  let deleteFailed = false;
  let remoteRejected = false;
  const remoteLines: string[] = [];
  const updates: RefUpdate[] = [];
  const pushed: Spec[] = [];
  for (const spec of specs) {
    if (spec.src === null) {
      if (!remote.branches.has(spec.dst)) {
        ctx.err(`error: unable to delete '${spec.dst}': remote ref does not exist`);
        deleteFailed = true;
        continue;
      }
      const refused = remote.receive?.check({ branch: spec.dst, old: remote.branches.get(spec.dst), id: undefined, force: true });
      if (refused) {
        remoteLines.push(...refused.messages);
        rows.push(` ! ${summary('[remote rejected]')} ${spec.dst} (${refused.reason})`);
        remoteRejected = true;
        continue;
      }
      updates.push({ branch: spec.dst, old: remote.branches.get(spec.dst), id: undefined, force: true });
      remote.branches.delete(spec.dst);
      repo.setRemoteBranch(remoteName, spec.dst, undefined);
      rows.push(` - ${summary('[deleted]')} ${spec.dst}`);
      continue;
    }
    const id = repo.resolve(spec.src);
    if (!id) {
      ctx.err(`error: src refspec ${spec.src} does not match any`);
      deleteFailed = true;
      continue;
    }
    if (spec.tag) {
      if (remote.tags.has(spec.dst)) continue;
      copyObjects(repo, remote, [id]);
      remote.tags.set(spec.dst, repo.tags.get(spec.src)!);
      rows.push(` * ${summary('[new tag]')} ${spec.src} -> ${spec.dst}`);
      continue;
    }
    const old = remote.branches.get(spec.dst);
    const arrow = `${spec.src} -> ${spec.dst}`;
    if (old === id) {
      pushed.push(spec);
      continue;
    }
    if (old && !flag(p, 'force')) {
      if (!repo.commits.has(old)) {
        rows.push(` ! ${summary('[rejected]')} ${arrow} (fetch first)`);
        rejected = 'fetch first';
        continue;
      }
      if (!repo.isAncestor(old, id)) {
        rows.push(` ! ${summary('[rejected]')} ${arrow} (non-fast-forward)`);
        rejected = 'non-fast-forward';
        continue;
      }
    }
    copyObjects(repo, remote, [id]);
    const update = { branch: spec.dst, old, id, force: Boolean(old && !repo.isAncestor(old, id)) };
    const refused = remote.receive?.check(update);
    if (refused) {
      remoteLines.push(...refused.messages);
      rows.push(` ! ${summary('[remote rejected]')} ${arrow} (${refused.reason})`);
      remoteRejected = true;
      continue;
    }
    updates.push(update);
    remote.branches.set(spec.dst, id);
    repo.setRemoteBranch(remoteName, spec.dst, id);
    if (!old) rows.push(` * ${summary('[new branch]')} ${arrow}`);
    else if (repo.isAncestor(old, id)) rows.push(`   ${summary(`${repo.short(old)}..${repo.short(id)}`)} ${arrow}`);
    else rows.push(` + ${summary(`${repo.short(old)}...${repo.short(id)}`)} ${arrow} (forced update)`);
    pushed.push(spec);
  }

  if (updates.length && remote.receive) remoteLines.push(...remote.receive.after(updates));
  for (const line of remoteLines) ctx.err(`remote: ${line}`);
  if (rows.length) {
    ctx.err(`To ${url}`);
    for (const row of rows) ctx.err(row);
  } else if (!rejected && !deleteFailed) ctx.err('Everything up-to-date');
  if (rejected || deleteFailed || remoteRejected) {
    ctx.err(`error: failed to push some refs to '${url}'`);
    const hints =
      rejected === 'fetch first'
        ? [
            'Updates were rejected because the remote contains work that you do not',
            'have locally. This is usually caused by another repository pushing to',
            'the same ref. If you want to integrate the remote changes, use',
            "'git pull' before pushing again.",
          ]
        : rejected === 'non-fast-forward'
          ? [
              'Updates were rejected because the tip of your current branch is behind',
              'its remote counterpart. If you want to integrate the remote changes,',
              "use 'git pull' before pushing again.",
            ]
          : [];
    if (hints.length) for (const line of [...hints, "See the 'Note about fast-forwards' in 'git push --help' for details."]) ctx.err(`hint: ${line}`);
  }
  if (flag(p, 'upstream')) {
    for (const spec of pushed) {
      if (spec.tag || !spec.src || !repo.branches.has(spec.src)) continue;
      repo.upstreams.set(spec.src, { remote: remoteName, branch: spec.dst });
      ctx.out(`branch '${spec.src}' set up to track '${remoteName}/${spec.dst}'.`);
    }
  }
  return rejected || deleteFailed || remoteRejected ? 1 : 0;
};

export const remote: Command = (ctx, argv) => {
  const repo = requireRepo(ctx);
  if (!repo) return 128;
  const [sub, ...rest] = argv;
  const names = [...repo.remotes.keys()].sort();
  if (!sub || sub === '-v' || sub === '--verbose') {
    for (const name of names) {
      if (!sub) {
        ctx.out(name);
        continue;
      }
      ctx.out(`${name}\t${repo.remotes.get(name)} (fetch)`);
      ctx.out(`${name}\t${repo.remotes.get(name)} (push)`);
    }
    return 0;
  }
  const [name, url] = rest;
  switch (sub) {
    case 'add':
      if (!name || !url) return fatal(ctx, 'usage: git remote add <name> <url>');
      if (repo.remotes.has(name)) {
        ctx.err(`error: remote ${name} already exists.`);
        return 3;
      }
      repo.remotes.set(name, url);
      return 0;
    case 'remove':
    case 'rm':
      if (!repo.remotes.has(name)) {
        ctx.err(`error: No such remote: '${name}'`);
        return 2;
      }
      repo.remotes.delete(name);
      repo.remoteHeads.delete(name);
      for (const key of [...repo.remoteBranches.keys()]) if (key.startsWith(`${name}/`)) repo.remoteBranches.delete(key);
      for (const [branch, up] of [...repo.upstreams]) if (up.remote === name) repo.upstreams.delete(branch);
      return 0;
    case 'rename': {
      const to = url;
      if (!repo.remotes.has(name)) {
        ctx.err(`error: No such remote: '${name}'`);
        return 2;
      }
      if (!to || repo.remotes.has(to)) {
        ctx.err(`error: remote ${to} already exists.`);
        return 3;
      }
      repo.remotes.set(to, repo.remotes.get(name)!);
      repo.remotes.delete(name);
      const head = repo.remoteHeads.get(name);
      repo.remoteHeads.delete(name);
      if (head) repo.remoteHeads.set(to, head);
      for (const [key, id] of [...repo.remoteBranches]) {
        if (!key.startsWith(`${name}/`)) continue;
        repo.remoteBranches.delete(key);
        repo.remoteBranches.set(`${to}/${key.slice(name.length + 1)}`, id);
      }
      for (const up of repo.upstreams.values()) if (up.remote === name) up.remote = to;
      return 0;
    }
    case 'get-url':
      if (!repo.remotes.has(name)) {
        ctx.err(`error: No such remote '${name}'`);
        return 2;
      }
      ctx.out(repo.remotes.get(name)!);
      return 0;
    case 'set-url':
      if (!repo.remotes.has(name)) {
        ctx.err(`error: No such remote '${name}'`);
        return 2;
      }
      repo.remotes.set(name, url);
      return 0;
    default:
      ctx.err(`error: unknown subcommand: \`${sub}'`);
      return 129;
  }
};
