import { flag, parseArgs, value, valuesOf, type ParsedArgs } from '../args';
import type { Ctx } from '../commands/common';
import { compareFiles, formatPatch } from '../patch';
import type { Tool } from '../tools';
import type { Run } from './ci';
import { fullName, hostingOf, HostingError, mergeBaseOf, STUDENT, type Hosting, type Project, type PullRequest } from './model';

/**
 * Training versions of the GitHub CLI (`gh`) and GitLab CLI (`glab`) for the sandbox hosting. They know
 * the everyday subcommands; there is no login, no token and no network.
 */
type Cli = 'gh' | 'glab';

const NO_AUTH = 'Вход не нужен: в учебной песочнице вы уже вошли как student. Настоящие токены и пароли здесь не вводятся.';

function projectOf(ctx: Ctx, hosting: Hosting, p: ParsedArgs): Project {
  const explicit = value(p, 'repo');
  if (explicit) {
    const found = hosting.find(explicit);
    if (!found) throw new HostingError(`Could not resolve to a Repository with the name '${explicit}'.`);
    return found;
  }
  const repo = ctx.world.repoAt(ctx.world.cwd);
  if (!repo) throw new HostingError('not a git repository; use --repo OWNER/NAME (или -R)');
  for (const name of ['origin', ...repo.remotes.keys()]) {
    const url = repo.remotes.get(name);
    const found = url ? hosting.find(url) : undefined;
    if (found) return found;
  }
  throw new HostingError('none of the git remotes configured for this repository point to a known host');
}

/** Where pull requests of a project go: the parent for a fork, the project itself otherwise. */
const baseOf = (hosting: Hosting, p: Project) => (p.parent ? hosting.projects.get(p.parent) ?? p : p);

function pullFor(ctx: Ctx, hosting: Hosting, base: Project, head: Project, arg: string | undefined): PullRequest {
  if (arg) return hosting.pull(base, Number(arg.replace(/^[#!]/, '')));
  const branch = ctx.world.repoAt(ctx.world.cwd)?.currentBranch();
  const found = base.pulls.find((pr) => pr.head.project === fullName(head) && pr.head.branch === branch && pr.state === 'open');
  if (!found) throw new HostingError(`no ${hosting.flavor === 'github' ? 'pull' : 'merge'} requests found for branch "${branch}"`);
  return found;
}

const mark = (status: Run['status'] | string) => (status === 'success' ? '✓' : status === 'failure' ? 'X' : status === 'manual' ? '▶' : '-');

function table(ctx: Ctx, rows: string[][]): void {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length)));
  for (const r of rows) ctx.out(r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]))).join('  ').trimEnd());
}

function showRuns(ctx: Ctx, hosting: Hosting, p: Project): void {
  if (!p.runs.length) {
    ctx.out(hosting.flavor === 'github' ? 'no runs found' : 'No pipelines available on ' + fullName(p));
    return;
  }
  const rows = [hosting.flavor === 'github' ? ['STATUS', 'TITLE', 'WORKFLOW', 'BRANCH', 'EVENT', 'ID'] : ['STATE', 'IID', 'REF', 'SOURCE', 'TITLE']];
  for (const r of [...p.runs].reverse()) {
    rows.push(hosting.flavor === 'github' ? [mark(r.status), r.title, r.workflow, r.branch, r.event, String(r.id)] : [r.status === 'success' ? 'passed' : 'failed', `#${r.id}`, r.branch, r.event === 'push' ? 'push' : 'merge_request_event', r.title]);
  }
  table(ctx, rows);
}

function showRun(ctx: Ctx, run: Run, withLog: boolean, failedOnly: boolean): void {
  ctx.out(`${mark(run.status)} ${run.branch} ${run.workflow} · ${run.id}`);
  ctx.out(`${run.event === 'push' ? 'Triggered via push' : 'Triggered via pull request'} · commit ${run.sha.slice(0, 7)}`);
  ctx.out('');
  if (run.error) ctx.out(run.error);
  ctx.out('JOBS');
  for (const job of run.jobs) {
    ctx.out(`${mark(job.status)} ${job.name}${job.stage ? ` (${job.stage})` : ''}`);
    for (const step of job.steps) {
      if (!withLog) {
        if (run.workflow !== 'pipeline') ctx.out(`  ${mark(step.status)} ${step.name}`);
        continue;
      }
      if (failedOnly && step.status !== 'failure') continue;
      for (const line of step.log) ctx.out(`${job.name}\t${step.name}\t${line}`);
    }
  }
}

function prSummary(ctx: Ctx, hosting: Hosting, base: Project, pr: PullRequest): void {
  const head = hosting.projects.get(pr.head.project);
  const commits = head ? [...base.repo.ancestors(hosting.headSha(pr) ?? '')].filter((id) => !base.repo.isAncestor(id, base.repo.branches.get(pr.base.branch) ?? '')) : [];
  const state = { open: 'Open', merged: 'Merged', closed: 'Closed' }[pr.state];
  ctx.out(`${pr.title} ${hosting.pullRef(pr.number)}`);
  ctx.out(`${state} • ${pr.author} wants to merge ${commits.length} commit${commits.length === 1 ? '' : 's'} into ${pr.base.branch} from ${pr.head.project === fullName(base) ? '' : `${pr.head.project.split('/')[0]}:`}${pr.head.branch}`);
  const { approved, changesRequested } = hosting.approvals(pr);
  if (approved.length) ctx.out(`Approved by: ${approved.join(', ')}`);
  if (changesRequested.length) ctx.out(`Changes requested by: ${changesRequested.join(', ')}`);
  const runs = hosting.checks(base, pr);
  if (runs.length) ctx.out(`Checks: ${runs.map((r) => `${mark(r.status)} ${r.workflow}`).join(', ')}`);
  ctx.out('');
  ctx.out(pr.body ? pr.body.split('\n').map((l) => `  ${l}`).join('\n') : '  No description provided');
  for (const c of [...pr.comments, ...pr.reviews.filter((r) => r.body)]) {
    ctx.out('');
    ctx.out(`${c.author}: ${c.body}`);
  }
  if (pr.state === 'open') {
    const blockers = hosting.blockers(base, pr);
    ctx.out('');
    ctx.out(blockers.length ? `Слить пока нельзя: ${blockers.join('; ')}.` : 'Можно сливать.');
  }
  ctx.out('');
  ctx.out(`View this ${hosting.flavor === 'github' ? 'pull' : 'merge'} request: ${hosting.pullUrl(base, pr.number)}`);
}

function pushCurrent(ctx: Ctx, exec: (line: string) => number): number {
  const branch = ctx.world.repoAt(ctx.world.cwd)?.currentBranch();
  return branch ? exec(`git push -q -u origin ${branch}`) : 1;
}

const FLAGS = {
  '-R': 'repo', '--repo': 'repo', '-t': 'title', '--title': 'title', '-b': 'body', '--body': 'body', '-d': 'description',
  '--description': 'description', '-B': 'base', '--base': 'base', '-H': 'head', '--head': 'head', '--fill': 'fill', '-f': 'fill',
  '--source-branch': 'head', '-s': 'head', '--target-branch': 'base', '--merge': 'merge', '-m': 'message', '--message': 'message',
  '--squash': 'squash', '--rebase': 'rebase', '--delete-branch': 'deleteBranch', '--remove-source-branch': 'deleteBranch',
  '--approve': 'approve', '-a': 'approve', '--request-changes': 'requestChanges', '-r': 'requestChanges', '--comment': 'comment', '-c': 'comment',
  '--label': 'label', '-l': 'label', '--notes': 'notes', '-n': 'notes', '--name': 'title', '--target': 'target', '--state': 'state',
  '--log': 'log', '--log-failed': 'logFailed', '--clone': 'clone', '--remote': 'remote', '--public': 'public', '--private': 'private', '--internal': 'internal',
  '--source': 'source', '--push': 'push', '-y': 'yes', '--yes': 'yes', '--web': 'web', '-w': 'web', '--draft': 'draft', '--json': 'json',
} as const;
const VALUES = ['repo', 'title', 'body', 'description', 'base', 'head', 'message', 'label', 'notes', 'target', 'state', 'source'];

function run(cli: Cli, ctx: Ctx, argv: string[], exec: (line: string) => number): number {
  const hosting = hostingOf(ctx.world);
  const product = cli === 'gh' ? 'GitHub' : 'GitLab';
  const flavor = cli === 'gh' ? 'github' : 'gitlab';
  const [group, sub, ...rest] = argv;
  if (!group || group === '--help' || group === 'help') {
    ctx.out(`${cli} — учебный клиент ${product} в песочнице.`);
    ctx.out(`Команды: auth, repo, ${cli === 'gh' ? 'pr' : 'mr'}, issue, release, ${cli === 'gh' ? 'run' : 'ci'}.`);
    return 0;
  }
  if (group === '--version' || group === 'version') {
    ctx.out(`${cli} version 2.0.0 (учебная песочница)`);
    return 0;
  }
  if (hosting.flavor !== flavor) {
    ctx.err(`Учебный хостинг сейчас в режиме ${hosting.flavor === 'github' ? 'GitHub' : 'GitLab'}: используйте ${cli === 'gh' ? 'glab' : 'gh'}.`);
    return 1;
  }
  const p = parseArgs(rest, { flags: FLAGS as unknown as Record<string, string>, values: VALUES });
  if (p.error) {
    ctx.err(p.error);
    return 1;
  }
  const arg = p.args[0];
  const prWord = cli === 'gh' ? 'pull request' : 'merge request';

  switch (`${group} ${sub ?? ''}`.trim()) {
    case 'auth login':
    case 'auth logout':
    case 'auth token':
      ctx.out(NO_AUTH);
      return 0;
    case 'auth status':
      ctx.out(HOSTS_LINE(hosting, hosting.user));
      return 0;

    case 'repo create': {
      const name = (arg ?? '').split('/').pop() ?? '';
      if (!name) throw new HostingError('укажите имя репозитория: ' + `${cli} repo create NAME`);
      if (cli === 'gh' && !flag(p, 'public') && !flag(p, 'private') && !flag(p, 'internal')) {
        throw new HostingError('--public, --private, or --internal required when not running interactively');
      }
      const owner = arg?.includes('/') ? arg.split('/')[0] : hosting.user;
      const project = hosting.createProject(owner, name, value(p, 'description') ?? '');
      ctx.out(`✓ Created repository ${fullName(project)} on ${product}`);
      ctx.out(`  ${hosting.web(project)}`);
      if (flag(p, 'source') || flag(p, 'push')) {
        const repo = ctx.world.repoAt(ctx.world.cwd);
        if (!repo) throw new HostingError('--source: current directory is not a git repository');
        const remoteName = 'origin';
        if (repo.remotes.has(remoteName)) throw new HostingError(`Unable to add remote "${remoteName}": already exists`);
        repo.remotes.set(remoteName, hosting.cloneUrl(project));
        ctx.out(`✓ Added remote ${hosting.cloneUrl(project)}`);
        if (flag(p, 'push')) {
          if (pushCurrent(ctx, exec) !== 0) return 1;
          ctx.out(`✓ Pushed commits to ${hosting.cloneUrl(project)}`);
        }
      }
      return 0;
    }
    case 'repo clone': {
      const project = hosting.find(arg ?? '');
      if (!project) throw new HostingError(`Could not resolve to a Repository with the name '${arg}'.`);
      return exec(`git clone ${hosting.cloneUrl(project)}${p.args[1] ? ` ${p.args[1]}` : ''}`);
    }
    case 'repo fork': {
      const source = arg ? hosting.find(arg) : projectOf(ctx, hosting, p);
      if (!source) throw new HostingError(`Could not resolve to a Repository with the name '${arg}'.`);
      const fork = hosting.fork(source);
      ctx.out(`✓ Created fork ${fullName(fork)}`);
      if (flag(p, 'clone')) {
        const code = exec(`git clone -q ${hosting.cloneUrl(fork)} ${fork.name}`);
        if (code !== 0) return code;
        ctx.world.repoAt(`${ctx.world.cwd}/${fork.name}`)?.remotes.set('upstream', hosting.cloneUrl(source));
        ctx.out(`✓ Cloned fork`);
        ctx.out(`✓ Added remote upstream ${hosting.cloneUrl(source)}`);
      } else if (flag(p, 'remote')) {
        const repo = ctx.world.repoAt(ctx.world.cwd);
        if (repo?.remotes.has('origin')) {
          exec('git remote rename origin upstream');
          ctx.out(`✓ Renamed remote origin to upstream`);
        }
        repo?.remotes.set('origin', hosting.cloneUrl(fork));
        ctx.out(`✓ Added remote origin ${hosting.cloneUrl(fork)}`);
      }
      return 0;
    }
    case 'repo view': {
      const project = arg ? hosting.find(arg) : projectOf(ctx, hosting, p);
      if (!project) throw new HostingError(`Could not resolve to a Repository with the name '${arg}'.`);
      ctx.out(fullName(project));
      ctx.out(project.description || 'No description provided');
      if (project.parent) ctx.out(`forked from ${project.parent}`);
      const tip = project.repo.branches.get(hosting.defaultBranch(project));
      const readme = tip ? project.repo.commits.get(tip)!.files['README.md'] : undefined;
      ctx.out('');
      ctx.out(readme?.replace(/\n$/, '') ?? 'This repository does not have a README');
      ctx.out('');
      ctx.out(`View this repository on ${product}: ${hosting.web(project)}`);
      return 0;
    }

    case 'pr create':
    case 'mr create': {
      const project = projectOf(ctx, hosting, p);
      const base = baseOf(hosting, project);
      const repo = ctx.world.repoAt(ctx.world.cwd);
      const branch = value(p, 'head') ?? repo?.currentBranch() ?? '';
      const tip = repo?.branches.get(branch);
      const subject = tip ? repo!.commits.get(tip)!.message.split('\n')[0] : '';
      const title = value(p, 'title') ?? (flag(p, 'fill') ? subject : undefined);
      if (title === undefined) throw new HostingError(`--title required when not running interactively (или --fill: взять заголовок из последнего коммита)`);
      if (!project.repo.branches.has(branch)) {
        throw new HostingError(cli === 'gh' ? `aborted: you must first push the current branch to a remote, or use the --head flag` : `the source branch "${branch}" does not exist on ${fullName(project)}; push it first`);
      }
      const target = value(p, 'base') ?? hosting.defaultBranch(base);
      ctx.err('');
      ctx.err(`Creating ${prWord} for ${project === base ? '' : `${project.owner}:`}${branch} into ${target} in ${fullName(base)}`);
      ctx.err('');
      const pr = hosting.openPull(base, { head: project, branch, target, title, body: value(p, 'body') ?? value(p, 'description') ?? '' });
      if (cli === 'glab') ctx.out(`!${pr.number} ${pr.title} (${branch})`);
      ctx.out(cli === 'glab' ? ` ${hosting.pullUrl(base, pr.number)}` : hosting.pullUrl(base, pr.number));
      return 0;
    }
    case 'pr list':
    case 'mr list': {
      const project = baseOf(hosting, projectOf(ctx, hosting, p));
      const state = value(p, 'state') ?? 'open';
      const pulls = project.pulls.filter((pr) => state === 'all' || pr.state === state).reverse();
      if (!pulls.length) {
        ctx.out(`no ${state === 'all' ? '' : `${state} `}${prWord}s in ${fullName(project)}`);
        return 0;
      }
      ctx.out('');
      ctx.out(`Showing ${pulls.length} of ${pulls.length} ${state === 'all' ? '' : `${state} `}${prWord}${pulls.length === 1 ? '' : 's'} in ${fullName(project)}`);
      ctx.out('');
      table(ctx, pulls.map((pr) => [hosting.pullRef(pr.number), pr.title, cli === 'gh' ? pr.head.branch : `(${pr.base.branch}) ← (${pr.head.branch})`]));
      return 0;
    }
    case 'pr view':
    case 'mr view': {
      const project = projectOf(ctx, hosting, p);
      const base = baseOf(hosting, project);
      prSummary(ctx, hosting, base, pullFor(ctx, hosting, base, project, arg));
      return 0;
    }
    case 'pr diff':
    case 'mr diff': {
      const project = projectOf(ctx, hosting, p);
      const base = baseOf(hosting, project);
      const pr = pullFor(ctx, hosting, base, project, arg);
      const head = hosting.headSha(pr);
      const target = base.repo.branches.get(pr.base.branch);
      if (!head || !target) return 0;
      const mb = mergeBaseOf(base.repo, head, target);
      const before = mb ? base.repo.commits.get(mb)!.files : {};
      for (const change of compareFiles(before, base.repo.commits.get(head)!.files)) for (const line of formatPatch(change)) ctx.out(line);
      return 0;
    }
    case 'pr checks': {
      const project = projectOf(ctx, hosting, p);
      const base = baseOf(hosting, project);
      const pr = pullFor(ctx, hosting, base, project, arg);
      const runs = hosting.checks(base, pr);
      if (!runs.length) {
        ctx.out(`no checks reported on the '${pr.head.branch}' branch`);
        return 0;
      }
      for (const r of runs) for (const j of r.jobs) ctx.out(`${mark(j.status)}  ${r.workflow}/${j.name} (${r.event})`);
      return runs.every((r) => r.status === 'success') ? 0 : 1;
    }
    case 'pr merge':
    case 'mr merge': {
      const project = projectOf(ctx, hosting, p);
      const base = baseOf(hosting, project);
      const pr = pullFor(ctx, hosting, base, project, arg);
      const method = flag(p, 'squash') ? 'squash' : flag(p, 'rebase') ? 'rebase' : 'merge';
      hosting.merge(base, pr, method, flag(p, 'deleteBranch'));
      if (cli === 'gh') {
        const verb = { merge: 'Merged', squash: 'Squashed and merged', rebase: 'Rebased and merged' }[method];
        ctx.out(`✓ ${verb} pull request ${fullName(base)}#${pr.number} (${pr.title})`);
        if (flag(p, 'deleteBranch')) {
          // Like gh: the local branch goes too, and the terminal moves to the base branch first.
          const repo = ctx.world.repoAt(ctx.world.cwd);
          const linked = repo && [...repo.remotes.values()].some((url) => hosting.find(url) && fullName(hosting.find(url)!) === pr.head.project);
          if (repo && linked && repo.branches.has(pr.head.branch)) {
            if (repo.currentBranch() === pr.head.branch && exec(`git switch -q ${pr.base.branch}`) !== 0) return 1;
            repo.branches.delete(pr.head.branch);
            repo.upstreams.delete(pr.head.branch);
            ctx.out(`✓ Deleted local branch ${pr.head.branch} and switched to branch ${repo.currentBranch()}`);
          }
          ctx.out(`✓ Deleted remote branch ${pr.head.branch}`);
        }
      } else {
        ctx.out(`✓ Merged!`);
        ctx.out(hosting.pullUrl(base, pr.number));
      }
      return 0;
    }
    case 'pr review':
    case 'mr approve':
    case 'mr revoke': {
      const project = projectOf(ctx, hosting, p);
      const base = baseOf(hosting, project);
      const pr = pullFor(ctx, hosting, base, project, arg);
      const state = sub === 'approve' || flag(p, 'approve') ? 'approved' : flag(p, 'requestChanges') ? 'changes_requested' : 'commented';
      if (sub === 'revoke') {
        pr.reviews = pr.reviews.filter((r) => r.author !== hosting.user);
        ctx.out(`✓ Revoked approval for !${pr.number}`);
        return 0;
      }
      hosting.review(base, pr, state, value(p, 'body') ?? '');
      if (cli === 'glab') ctx.out(`✓ Approved merge request !${pr.number}`);
      else ctx.out(state === 'approved' ? `✓ Approved pull request #${pr.number}` : state === 'changes_requested' ? `- Requested changes to pull request #${pr.number}` : `- Reviewed pull request #${pr.number}`);
      return 0;
    }
    case 'pr comment':
    case 'mr note': {
      const project = projectOf(ctx, hosting, p);
      const base = baseOf(hosting, project);
      const pr = pullFor(ctx, hosting, base, project, arg);
      const body = value(p, 'body') ?? value(p, 'message');
      if (!body) throw new HostingError('body cannot be blank');
      pr.comments.push({ author: hosting.user, body, time: ctx.world.now() });
      ctx.out(`${hosting.pullUrl(base, pr.number)}#note-${pr.comments.length}`);
      return 0;
    }
    case 'pr close':
    case 'mr close':
    case 'pr reopen':
    case 'mr reopen': {
      const project = projectOf(ctx, hosting, p);
      const base = baseOf(hosting, project);
      const pr = pullFor(ctx, hosting, base, project, arg);
      if (pr.state === 'merged') throw new HostingError(`${prWord} ${hosting.pullRef(pr.number)} can't be ${sub === 'close' ? 'closed' : 'reopened'} because it was already merged`);
      pr.state = sub === 'close' ? 'closed' : 'open';
      ctx.out(`✓ ${sub === 'close' ? 'Closed' : 'Reopened'} ${prWord} ${hosting.pullRef(pr.number)} (${pr.title})`);
      return 0;
    }
    case 'pr checkout':
    case 'mr checkout': {
      const project = projectOf(ctx, hosting, p);
      const base = baseOf(hosting, project);
      const pr = pullFor(ctx, hosting, base, project, arg);
      const repo = ctx.world.repoAt(ctx.world.cwd)!;
      const remote = [...repo.remotes].find(([, url]) => hosting.find(url) && fullName(hosting.find(url)!) === pr.head.project)?.[0];
      if (!remote) throw new HostingError(`ветка ${pr.head.branch} лежит в ${pr.head.project}; добавьте этот репозиторий как remote`);
      const code = exec(`git fetch -q ${remote}`);
      if (code !== 0) return code;
      return repo.branches.has(pr.head.branch) ? exec(`git switch ${pr.head.branch}`) : exec(`git switch -c ${pr.head.branch} ${remote}/${pr.head.branch}`);
    }

    case 'issue create': {
      const project = baseOf(hosting, projectOf(ctx, hosting, p));
      const title = value(p, 'title');
      if (!title) throw new HostingError('--title required when not running interactively');
      const issue = hosting.createIssue(project, title, value(p, 'body') ?? value(p, 'description') ?? '', valuesOf(p, 'label'));
      if (cli === 'glab') ctx.out(`#${issue.number} ${issue.title}`);
      ctx.out(hosting.issueUrl(project, issue.number));
      return 0;
    }
    case 'issue list': {
      const project = baseOf(hosting, projectOf(ctx, hosting, p));
      const state = value(p, 'state') ?? 'open';
      const issues = project.issues.filter((i) => state === 'all' || i.state === state).reverse();
      if (!issues.length) {
        ctx.out(`no ${state === 'all' ? '' : `${state} `}issues in ${fullName(project)}`);
        return 0;
      }
      ctx.out('');
      ctx.out(`Showing ${issues.length} of ${issues.length} ${state === 'all' ? '' : `${state} `}issue${issues.length === 1 ? '' : 's'} in ${fullName(project)}`);
      ctx.out('');
      table(ctx, issues.map((i) => [`#${i.number}`, i.title, i.labels.join(', ')]));
      return 0;
    }
    case 'issue view': {
      const project = baseOf(hosting, projectOf(ctx, hosting, p));
      const issue = hosting.issue(project, Number((arg ?? '').replace('#', '')));
      ctx.out(`${issue.title} #${issue.number}`);
      ctx.out(`${issue.state === 'open' ? 'Open' : 'Closed'} • ${issue.author} opened${issue.labels.length ? ` • ${issue.labels.join(', ')}` : ''}${issue.closedBy ? ` • closed by ${issue.closedBy}` : ''}`);
      ctx.out('');
      ctx.out(issue.body ? issue.body.split('\n').map((l) => `  ${l}`).join('\n') : '  No description provided');
      for (const c of issue.comments) {
        ctx.out('');
        ctx.out(`${c.author}: ${c.body}`);
      }
      ctx.out('');
      ctx.out(`View this issue on ${product}: ${hosting.issueUrl(project, issue.number)}`);
      return 0;
    }
    case 'issue close':
    case 'issue reopen': {
      const project = baseOf(hosting, projectOf(ctx, hosting, p));
      const issue = hosting.issue(project, Number((arg ?? '').replace('#', '')));
      issue.state = sub === 'close' ? 'closed' : 'open';
      if (sub === 'close') issue.closedBy = hosting.user;
      ctx.out(`✓ ${sub === 'close' ? 'Closed' : 'Reopened'} issue #${issue.number} (${issue.title})`);
      return 0;
    }
    case 'issue comment':
    case 'issue note': {
      const project = baseOf(hosting, projectOf(ctx, hosting, p));
      const issue = hosting.issue(project, Number((arg ?? '').replace('#', '')));
      const body = value(p, 'body') ?? value(p, 'message');
      if (!body) throw new HostingError('body cannot be blank');
      issue.comments.push({ author: hosting.user, body, time: ctx.world.now() });
      ctx.out(`${hosting.issueUrl(project, issue.number)}#note-${issue.comments.length}`);
      return 0;
    }

    case 'release create': {
      const project = projectOf(ctx, hosting, p);
      if (!arg) throw new HostingError('could not create: no tag name provided');
      const release = hosting.createRelease(project, arg, { title: value(p, 'title'), notes: value(p, 'notes'), target: value(p, 'target') });
      ctx.out(hosting.web(project, cli === 'gh' ? `/releases/tag/${release.tag}` : `/-/releases/${release.tag}`));
      return 0;
    }
    case 'release list': {
      const project = projectOf(ctx, hosting, p);
      if (!project.releases.length) {
        ctx.out('no releases found');
        return 0;
      }
      table(ctx, [['TITLE', 'TAG NAME'], ...project.releases.map((r, i) => [`${r.title}${i === 0 ? '  Latest' : ''}`, r.tag])]);
      return 0;
    }
    case 'release view': {
      const project = projectOf(ctx, hosting, p);
      const release = project.releases.find((r) => r.tag === (arg ?? project.releases[0]?.tag));
      if (!release) throw new HostingError('release not found');
      ctx.out(release.title);
      ctx.out(`${release.author} released this · tag ${release.tag} · commit ${release.target.slice(0, 7)}`);
      ctx.out('');
      ctx.out(release.notes || 'No release notes');
      return 0;
    }

    case 'run list':
    case 'ci list':
    case 'ci status': {
      showRuns(ctx, hosting, projectOf(ctx, hosting, p));
      return 0;
    }
    case 'run view':
    case 'ci view':
    case 'ci trace': {
      const project = projectOf(ctx, hosting, p);
      const runId = arg ? Number(arg.replace('#', '')) : project.runs.at(-1)?.id;
      const found = project.runs.find((r) => r.id === runId);
      if (!found) throw new HostingError(runId ? `run ${runId} not found` : 'no runs found');
      showRun(ctx, found, flag(p, 'log') || flag(p, 'logFailed') || sub === 'trace', flag(p, 'logFailed'));
      return 0;
    }

    case 'browse':
      ctx.out('Откройте вкладку «Хостинг» справа: там страницы проекта учебного хостинга.');
      return 0;
    default:
      ctx.err(`unknown command "${[group, sub].filter(Boolean).join(' ')}" for "${cli}"`);
      return 1;
  }
}

const HOSTS_LINE = (hosting: Hosting, user: string) => `${hosting.host}\n  ✓ Logged in to ${hosting.host} account ${user} (учебная песочница, без токена)`;

function guarded(cli: Cli): Tool {
  return (ctx, args, env) => {
    try {
      return run(cli, ctx, args, env.exec);
    } catch (e) {
      if (!(e instanceof HostingError)) throw e;
      ctx.err(e.message);
      return 1;
    }
  };
}

/**
 * Setup commands for task authors (not part of real git): create projects, protect branches, switch the
 * hosting between GitHub and GitLab.
 */
const admin: Tool = (ctx, args, env) => {
  const hosting = hostingOf(ctx.world);
  const [sub, target, ...rest] = args;
  const p = parseArgs(rest, {
    flags: { '--from': 'from', '--description': 'description', '--approvals': 'approvals', '--checks': 'checks', '--no-pr': 'noPr' },
    values: ['from', 'description', 'approvals'],
  });
  try {
    switch (sub) {
      case 'flavor':
        if (target !== 'github' && target !== 'gitlab') throw new HostingError('hosting flavor github|gitlab');
        hosting.flavor = target;
        return 0;
      case 'create': {
        const [owner, name] = (target ?? '').split('/');
        if (!owner || !name) throw new HostingError('hosting create OWNER/NAME [--from DIR]');
        const project = hosting.createProject(owner, name, value(p, 'description') ?? '');
        const from = value(p, 'from');
        if (from) {
          const repo = ctx.world.repoAt(ctx.world.cwd === '/' ? from : `${ctx.world.cwd}/${from}`.replace(/\/\.$/, '')) ?? ctx.world.repos.get(from);
          if (!repo) throw new HostingError(`--from: ${from} is not a repository`);
          for (const [id, c] of repo.commits) project.repo.commits.set(id, c);
          for (const [b, id] of repo.branches) project.repo.branches.set(b, id);
          for (const [t, tag] of repo.tags) project.repo.tags.set(t, tag);
          if (repo.currentBranch()) project.repo.head = { kind: 'branch', name: repo.currentBranch()! };
        }
        return 0;
      }
      case 'protect': {
        const project = hosting.find(target ?? '');
        if (!project) throw new HostingError(`unknown project ${target}`);
        hosting.protect(project, p.args[0] ?? hosting.defaultBranch(project), {
          requirePr: !flag(p, 'noPr'),
          approvals: Number(value(p, 'approvals') ?? 0),
          requireChecks: flag(p, 'checks'),
        });
        return 0;
      }
      default:
        throw new HostingError('hosting flavor|create|protect');
    }
  } catch (e) {
    if (!(e instanceof HostingError)) throw e;
    ctx.err(e.message);
    void env;
    return 1;
  }
};

/** `as mentor gh pr review 1 --approve`: runs one command as another user of the hosting. */
const as: Tool = (ctx, args, env) => {
  const [user, ...command] = args;
  if (!user || !command.length) {
    ctx.err('as USER COMMAND...');
    return 1;
  }
  const hosting = hostingOf(ctx.world);
  const config = ctx.world.globalConfig;
  const saved = { user: hosting.user, name: config.get('user.name'), email: config.get('user.email') };
  hosting.user = user;
  if (user !== STUDENT) {
    config.set('user.name', user);
    config.set('user.email', `${user}@example.com`);
  }
  try {
    return env.exec(command.map((w) => (/[\s"'$&;|<>]/.test(w) ? `'${w.replace(/'/g, `'\\''`)}'` : w)).join(' '));
  } finally {
    hosting.user = saved.user;
    if (saved.name !== undefined) config.set('user.name', saved.name);
    if (saved.email !== undefined) config.set('user.email', saved.email);
  }
};

/** Service commands exist only for task setup and reference solutions; in the learner's terminal they are unknown. */
const serviceOnly = (tool: Tool, name: string): Tool => (ctx, args, env) => {
  if (ctx.world.privileged) return tool(ctx, args, env);
  ctx.err(`bash: ${name}: command not found`);
  return 127;
};

export const HOSTING_TOOLS: Record<string, Tool> = { gh: guarded('gh'), glab: guarded('glab'), hosting: serviceOnly(admin, 'hosting'), as: serviceOnly(as, 'as') };
