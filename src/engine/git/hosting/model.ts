import { mergeTrees } from '../merge';
import type { Signature } from '../objects';
import { Repo, type RefUpdate, type World } from '../world';
import { runPipelines, type Run } from './ci';

/**
 * Training hosting inside the sandbox: projects, forks, pull/merge requests, reviews, issues, releases,
 * protected branches and CI. It imitates GitHub and GitLab workflows; nothing leaves the app.
 */
export type Flavor = 'github' | 'gitlab';

export const HOSTS: Record<Flavor, string> = { github: 'github.com', gitlab: 'gitlab.com' };
export const STUDENT = 'student';

export interface Protection {
  requirePr: boolean;
  approvals: number;
  requireChecks: boolean;
}

export interface Comment {
  author: string;
  body: string;
  time: number;
}

export interface Review extends Comment {
  state: 'approved' | 'changes_requested' | 'commented';
}

export interface PullRequest {
  number: number;
  title: string;
  body: string;
  author: string;
  head: { project: string; branch: string };
  base: { project: string; branch: string };
  state: 'open' | 'merged' | 'closed';
  reviews: Review[];
  comments: Comment[];
  created: number;
  mergedCommit?: string;
  mergedBy?: string;
}

export interface Issue {
  number: number;
  title: string;
  body: string;
  author: string;
  state: 'open' | 'closed';
  labels: string[];
  comments: Comment[];
  created: number;
  closedBy?: string;
}

export interface Release {
  tag: string;
  title: string;
  notes: string;
  target: string;
  author: string;
  time: number;
}

export interface Project {
  owner: string;
  name: string;
  repo: Repo;
  parent?: string;
  description: string;
  protections: Map<string, Protection>;
  pulls: PullRequest[];
  issues: Issue[];
  releases: Release[];
  runs: Run[];
  /** GitHub numbers issues and pull requests together; GitLab counts each separately. */
  counters: { shared: number; issues: number; merges: number };
}

export const fullName = (p: Project) => `${p.owner}/${p.name}`;

export class HostingError extends Error {}

const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;

export class Hosting {
  flavor: Flavor = 'github';
  /** Who acts on the hosting right now (changed by the `as` builtin of task setups). */
  user = STUDENT;
  readonly projects = new Map<string, Project>();

  constructor(readonly world: World) {}

  get host(): string {
    return HOSTS[this.flavor];
  }

  /** Web address of a project or one of its pages. */
  web(p: Project, path = ''): string {
    return `https://${this.host}/${fullName(p)}${path}`;
  }

  cloneUrl(p: Project): string {
    return `https://${this.host}/${fullName(p)}.git`;
  }

  /** Every spelling of a project's address (both hostings, https and ssh) leads to the same repository. */
  private register(p: Project): void {
    for (const host of Object.values(HOSTS)) {
      for (const url of [`https://${host}/${fullName(p)}`, `git@${host}:${fullName(p)}`]) {
        this.world.hosts.set(url, p.repo.root);
        this.world.hosts.set(`${url}.git`, p.repo.root);
      }
    }
  }

  /** Finds a project by "owner/name", by a hosting URL or by a remote URL of a local repository. */
  find(ref: string): Project | undefined {
    const name = ref
      .replace(/^(https:\/\/|git@)[^/:]+[/:]/, '')
      .replace(/\.git$/, '')
      .replace(/\/$/, '');
    return this.projects.get(name);
  }

  signature(user = this.user): Signature {
    const time = this.world.now();
    if (user === STUDENT) {
      return { name: this.world.globalConfig.get('user.name') ?? STUDENT, email: this.world.globalConfig.get('user.email') ?? '', time, tz: this.world.tz };
    }
    return { name: user, email: `${user}@example.com`, time, tz: this.world.tz };
  }

  /** The web interface commits merges as the hosting itself on GitHub and as the user on GitLab. */
  private webCommitter(user: string): Signature {
    return this.flavor === 'github' ? { name: 'GitHub', email: 'noreply@github.com', time: this.world.now(), tz: this.world.tz } : this.signature(user);
  }

  createProject(owner: string, name: string, description = ''): Project {
    const key = `${owner}/${name}`;
    if (this.projects.has(key)) throw new HostingError(`Name already exists on this account: ${key}`);
    const root = `/srv/hosting/${owner}/${name}.git`;
    this.world.mkdirp(root);
    const repo = new Repo(this.world, root, true);
    this.world.repos.set(root, repo);
    const project: Project = {
      owner,
      name,
      repo,
      description,
      protections: new Map(),
      pulls: [],
      issues: [],
      releases: [],
      runs: [],
      counters: { shared: 0, issues: 0, merges: 0 },
    };
    repo.receive = { check: (u) => this.check(project, u), after: (u) => this.afterPush(project, u) };
    this.projects.set(key, project);
    this.register(project);
    return project;
  }

  fork(source: Project, owner = this.user): Project {
    if (source.owner === owner) throw new HostingError('A repository cannot be forked into its own account.');
    const existing = this.projects.get(`${owner}/${source.name}`);
    if (existing?.parent === fullName(source)) return existing;
    const fork = this.createProject(owner, source.name, source.description);
    fork.parent = fullName(source);
    for (const [id, c] of source.repo.commits) fork.repo.commits.set(id, c);
    for (const [b, id] of source.repo.branches) fork.repo.branches.set(b, id);
    for (const [t, tag] of source.repo.tags) fork.repo.tags.set(t, tag);
    fork.repo.head = { ...source.repo.head };
    return fork;
  }

  defaultBranch(p: Project): string {
    return p.repo.head.kind === 'branch' ? p.repo.head.name : 'main';
  }

  protect(p: Project, branch: string, rule: Partial<Protection>): void {
    p.protections.set(branch, { requirePr: true, approvals: 0, requireChecks: false, ...rule });
  }

  private check(p: Project, u: RefUpdate): { reason: string; messages: string[] } | null {
    const rule = p.protections.get(u.branch);
    if (!rule) return null;
    const what = u.id === undefined ? 'delete' : u.force ? 'force' : rule.requirePr ? 'pr' : null;
    if (!what) return null;
    if (this.flavor === 'gitlab') {
      const text = {
        delete: 'GitLab: You can only delete protected branches using the web interface.',
        force: 'GitLab: You are not allowed to force push code to a protected branch on this project.',
        pr: 'GitLab: You are not allowed to push code to protected branches on this project.',
      }[what];
      return { reason: 'pre-receive hook declined', messages: [text] };
    }
    const why = { delete: 'Cannot delete this protected branch', force: 'Cannot force-push to this branch', pr: 'Changes must be made through a pull request.' }[what];
    return { reason: 'protected branch hook declined', messages: [`error: GH006: Protected branch update failed for refs/heads/${u.branch}.`, '', `- ${why}`] };
  }

  private afterPush(p: Project, updates: RefUpdate[]): string[] {
    const lines: string[] = [];
    for (const u of updates) {
      if (u.id === undefined) continue;
      this.runCi(p, { kind: 'push', branch: u.branch, sha: u.id });
      for (const pr of this.openPullsFrom(p, u.branch)) this.runCi(this.projects.get(pr.base.project)!, { kind: 'pull_request', branch: u.branch, sha: u.id, base: pr.base.branch, pr: pr.number });
      if (u.old !== undefined || u.branch === this.defaultBranch(p)) continue;
      const open = this.openPullsFrom(p, u.branch)[0];
      if (this.flavor === 'github') {
        if (!open) lines.push('', `Create a pull request for '${u.branch}' on GitHub by visiting:`, `     ${this.web(p, `/pull/new/${u.branch}`)}`, '');
      } else if (open) {
        lines.push('', `View merge request for ${u.branch}:`, `  ${this.web(this.projects.get(open.base.project)!, `/-/merge_requests/${open.number}`)}`, '');
      } else {
        lines.push('', `To create a merge request for ${u.branch}, visit:`, `  ${this.web(p, `/-/merge_requests/new?merge_request%5Bsource_branch%5D=${u.branch}`)}`, '');
      }
    }
    return lines;
  }

  runCi(p: Project, event: Parameters<typeof runPipelines>[2]): Run[] {
    const runs = runPipelines(this, p, event);
    p.runs.push(...runs);
    return runs;
  }

  /** Open pull requests whose head is `branch` of project `p` (in `p` itself or in its parent). */
  openPullsFrom(p: Project, branch: string): PullRequest[] {
    const targets = [p, ...(p.parent ? [this.projects.get(p.parent)!] : [])];
    return targets.flatMap((t) => t.pulls.filter((pr) => pr.state === 'open' && pr.head.project === fullName(p) && pr.head.branch === branch));
  }

  private next(p: Project, kind: 'issue' | 'merge'): number {
    if (this.flavor === 'github') return ++p.counters.shared;
    return kind === 'issue' ? ++p.counters.issues : ++p.counters.merges;
  }

  pullRef(n: number): string {
    return this.flavor === 'github' ? `#${n}` : `!${n}`;
  }

  pullUrl(p: Project, n: number): string {
    return this.web(p, this.flavor === 'github' ? `/pull/${n}` : `/-/merge_requests/${n}`);
  }

  issueUrl(p: Project, n: number): string {
    return this.web(p, this.flavor === 'github' ? `/issues/${n}` : `/-/issues/${n}`);
  }

  openPull(base: Project, opts: { head: Project; branch: string; target?: string; title: string; body?: string }): PullRequest {
    const target = opts.target ?? this.defaultBranch(base);
    const headId = opts.head.repo.branches.get(opts.branch);
    if (!headId) throw new HostingError(`branch '${opts.branch}' does not exist on ${fullName(opts.head)}; push it first`);
    const baseId = base.repo.branches.get(target);
    if (!baseId) throw new HostingError(`base branch '${target}' does not exist`);
    for (const [id, c] of opts.head.repo.commits) if (!base.repo.commits.has(id)) base.repo.commits.set(id, c);
    if (base.repo.isAncestor(headId, baseId)) throw new HostingError(`No commits between ${target} and ${opts.branch}`);
    const existing = base.pulls.find((pr) => pr.state === 'open' && pr.head.project === fullName(opts.head) && pr.head.branch === opts.branch && pr.base.branch === target);
    if (existing) {
      throw new HostingError(`a ${this.flavor === 'github' ? 'pull' : 'merge'} request for branch "${opts.branch}" into branch "${target}" already exists:\n${this.pullUrl(base, existing.number)}`);
    }
    if (!opts.title.trim()) throw new HostingError('title can not be blank');
    const pr: PullRequest = {
      number: this.next(base, 'merge'),
      title: opts.title,
      body: opts.body ?? '',
      author: this.user,
      head: { project: fullName(opts.head), branch: opts.branch },
      base: { project: fullName(base), branch: target },
      state: 'open',
      reviews: [],
      comments: [],
      created: this.world.now(),
    };
    base.pulls.push(pr);
    this.runCi(base, { kind: 'pull_request', branch: opts.branch, sha: headId, base: target, pr: pr.number });
    return pr;
  }

  pull(p: Project, n: number): PullRequest {
    const pr = p.pulls.find((x) => x.number === n);
    if (!pr) throw new HostingError(`could not find ${this.flavor === 'github' ? 'pull' : 'merge'} request ${this.pullRef(n)} in ${fullName(p)}`);
    return pr;
  }

  headSha(pr: PullRequest): string | undefined {
    return this.projects.get(pr.head.project)?.repo.branches.get(pr.head.branch);
  }

  /** Latest state of each reviewer other than the author. */
  approvals(pr: PullRequest): { approved: string[]; changesRequested: string[] } {
    const last = new Map<string, Review['state']>();
    for (const r of pr.reviews) if (r.author !== pr.author && r.state !== 'commented') last.set(r.author, r.state);
    const approved = [...last].filter(([, s]) => s === 'approved').map(([u]) => u);
    const changesRequested = [...last].filter(([, s]) => s === 'changes_requested').map(([u]) => u);
    return { approved, changesRequested };
  }

  /** Runs on the head commit of a pull request (all workflows of the latest push). */
  checks(base: Project, pr: PullRequest): Run[] {
    const sha = this.headSha(pr);
    // GitLab shows the branch pipeline of the head commit on a merge request when there is no MR pipeline.
    const own = base.runs.filter((r) => r.sha === sha && r.pr === pr.number);
    if (own.length || this.flavor === 'github') return own;
    const head = this.projects.get(pr.head.project);
    return (head?.runs ?? []).filter((r) => r.sha === sha && r.event === 'push').slice(-1);
  }

  /** Why a pull request cannot be merged now, or null. */
  blockers(base: Project, pr: PullRequest): string[] {
    const out: string[] = [];
    if (pr.state !== 'open') return [`${this.flavor === 'github' ? 'Pull' : 'Merge'} request ${this.pullRef(pr.number)} is ${pr.state === 'merged' ? 'already merged' : 'closed'}`];
    const rule = base.protections.get(pr.base.branch);
    const { approved, changesRequested } = this.approvals(pr);
    if (changesRequested.length) out.push(`изменения запрошены ревьюером: ${changesRequested.join(', ')}`);
    if (rule && approved.length < rule.approvals) out.push(`нужно одобрений: ${rule.approvals}, есть: ${approved.length}`);
    if (rule?.requireChecks) {
      const runs = this.checks(base, pr);
      if (!runs.length) out.push('проверки CI ещё не запускались');
      else if (runs.some((r) => r.status !== 'success')) out.push('проверки CI не прошли');
    }
    if (this.conflicts(base, pr).length) out.push(`конфликт с веткой ${pr.base.branch}: ${this.conflicts(base, pr).join(', ')}`);
    return out;
  }

  private conflicts(base: Project, pr: PullRequest): string[] {
    const head = this.headSha(pr);
    const target = base.repo.branches.get(pr.base.branch);
    if (!head || !target) return [];
    const b = mergeBaseOf(base.repo, head, target);
    const merged = mergeTrees(b ? base.repo.commits.get(b)!.files : {}, base.repo.commits.get(target)!.files, base.repo.commits.get(head)!.files, { ours: pr.base.branch, theirs: pr.head.branch });
    return [...merged.conflicts.keys()];
  }

  merge(base: Project, pr: PullRequest, method: 'merge' | 'squash' | 'rebase' = 'merge', deleteBranch = false): string {
    const blockers = this.blockers(base, pr);
    if (blockers.length) throw new HostingError(`${this.flavor === 'github' ? 'Pull' : 'Merge'} request ${this.pullRef(pr.number)} is not mergeable: ${blockers.join('; ')}`);
    const repo = base.repo;
    const headProject = this.projects.get(pr.head.project)!;
    const head = this.headSha(pr)!;
    for (const [id, c] of headProject.repo.commits) if (!repo.commits.has(id)) repo.commits.set(id, c);
    const target = repo.branches.get(pr.base.branch)!;
    const mb = mergeBaseOf(repo, head, target);
    const merged = mergeTrees(mb ? repo.commits.get(mb)!.files : {}, repo.commits.get(target)!.files, repo.commits.get(head)!.files, { ours: '', theirs: '' }).index;
    const author = this.signature();
    const committer = this.webCommitter(this.user);
    const own = (files: Record<string, string>, parents: string[], message: string, a = author) => storeCommit(repo, files, parents, message, a, committer);
    let tip: string;
    if (method === 'squash') {
      const picked = [...repo.ancestors(head)].filter((id) => !repo.isAncestor(id, target)).map((id) => repo.commits.get(id)!);
      picked.sort((a, b) => a.committer.time - b.committer.time);
      const message =
        this.flavor === 'github'
          ? `${pr.title} (#${pr.number})\n\n${picked.map((c) => `* ${c.message.trim().split('\n').join('\n  ')}`).join('\n\n')}\n`
          : `${pr.title}\n`;
      // The squashed commit keeps the pull request's author, like on GitHub and GitLab.
      tip = own(merged, [target], message, this.signature(pr.author));
    } else if (method === 'rebase') {
      const picked = [...repo.ancestors(head)].filter((id) => !repo.isAncestor(id, target)).map((id) => repo.commits.get(id)!);
      picked.sort((a, b) => a.committer.time - b.committer.time);
      tip = target;
      for (const c of picked) {
        const parent = c.parents[0] ? repo.commits.get(c.parents[0])!.files : {};
        const files = mergeTrees(parent, repo.commits.get(tip)!.files, c.files, { ours: '', theirs: '' }).index;
        tip = own(files, [tip], c.message, c.author);
      }
    } else {
      const message =
        this.flavor === 'github'
          ? `Merge pull request #${pr.number} from ${headProject.owner}/${pr.head.branch}\n\n${pr.title}\n`
          : `Merge branch '${pr.head.branch}' into '${pr.base.branch}'\n\n${pr.title}\n\nSee merge request ${fullName(base)}!${pr.number}\n`;
      tip = own(merged, [target, head], message);
    }
    repo.branches.set(pr.base.branch, tip);
    pr.state = 'merged';
    pr.mergedCommit = tip;
    pr.mergedBy = this.user;
    for (const m of `${pr.title}\n${pr.body}`.matchAll(CLOSING)) {
      const issue = base.issues.find((i) => i.number === Number(m[1]) && i.state === 'open');
      if (issue) {
        issue.state = 'closed';
        issue.closedBy = `${this.pullRef(pr.number)}`;
      }
    }
    if (deleteBranch) headProject.repo.branches.delete(pr.head.branch);
    this.runCi(base, { kind: 'push', branch: pr.base.branch, sha: tip });
    return tip;
  }

  review(p: Project, pr: PullRequest, state: Review['state'], body = ''): void {
    if (pr.state !== 'open') throw new HostingError(`${this.flavor === 'github' ? 'Pull' : 'Merge'} request ${this.pullRef(pr.number)} is ${pr.state}`);
    if (pr.author === this.user && state !== 'commented') {
      if (this.flavor === 'gitlab') throw new HostingError('You cannot approve your own merge request.');
      throw new HostingError(state === 'approved' ? 'Can not approve your own pull request' : 'Can not request changes on your own pull request');
    }
    if (state === 'commented' && !body.trim()) throw new HostingError('body cannot be blank');
    pr.reviews.push({ author: this.user, state, body, time: this.world.now() });
    void p;
  }

  /** A simulated teammate reviews: approves when checks pass and the branch merges cleanly, otherwise asks for changes. */
  requestReview(base: Project, pr: PullRequest, reviewer = 'mentor'): Review {
    const failing = this.checks(base, pr).filter((r) => r.status !== 'success');
    const conflicts = this.conflicts(base, pr);
    const saved = this.user;
    this.user = reviewer;
    try {
      const state = failing.length || conflicts.length ? 'changes_requested' : 'approved';
      const body = conflicts.length
        ? `Ветка конфликтует с ${pr.base.branch} в файлах: ${conflicts.join(', ')}. Подтяните ${pr.base.branch} и разрешите конфликт.`
        : failing.length
          ? `Проверки CI не прошли (${failing.map((r) => r.workflow).join(', ')}). Посмотрите лог и исправьте.`
          : 'Выглядит хорошо, одобряю.';
      this.review(base, pr, state, body);
      return pr.reviews.at(-1)!;
    } finally {
      this.user = saved;
    }
  }

  createIssue(p: Project, title: string, body = '', labels: string[] = []): Issue {
    if (!title.trim()) throw new HostingError('title can not be blank');
    const issue: Issue = { number: this.next(p, 'issue'), title, body, author: this.user, state: 'open', labels, comments: [], created: this.world.now() };
    p.issues.push(issue);
    return issue;
  }

  issue(p: Project, n: number): Issue {
    const issue = p.issues.find((i) => i.number === n);
    if (!issue) throw new HostingError(`could not find issue #${n} in ${fullName(p)}`);
    return issue;
  }

  createRelease(p: Project, tag: string, opts: { title?: string; notes?: string; target?: string }): Release {
    if (p.releases.some((r) => r.tag === tag)) throw new HostingError(`a release with tag ${tag} already exists`);
    let target = p.repo.tags.get(tag)?.target;
    if (!target) {
      const branch = opts.target ?? this.defaultBranch(p);
      target = p.repo.branches.get(branch) ?? (p.repo.commits.has(branch) ? branch : undefined);
      if (!target) throw new HostingError(`target '${branch}' does not exist`);
      p.repo.tags.set(tag, { target });
    }
    const release: Release = { tag, title: opts.title ?? tag, notes: opts.notes ?? '', target, author: this.user, time: this.world.now() };
    p.releases.unshift(release);
    return release;
  }
}

export function mergeBaseOf(repo: Repo, a: string, b: string): string | undefined {
  const fromB = repo.ancestors(b);
  const common = [...repo.ancestors(a)].filter((id) => fromB.has(id));
  const best = common.filter((c) => !common.some((o) => o !== c && repo.isAncestor(c, o)));
  return best.sort((x, y) => repo.commits.get(y)!.committer.time - repo.commits.get(x)!.committer.time)[0];
}

/** Stores a commit with an explicit committer (the hosting's web interface). */
function storeCommit(repo: Repo, files: Record<string, string>, parents: string[], message: string, author: Signature, committer: Signature): string {
  return repo.createCommit(files, parents, message, author, false, committer).id;
}

const hostings = new WeakMap<World, Hosting>();

/** The hosting of a world, created on first use. */
export function hostingOf(world: World): Hosting {
  let hosting = hostings.get(world);
  if (!hosting) {
    hosting = new Hosting(world);
    hostings.set(world, hosting);
  }
  return hosting;
}
