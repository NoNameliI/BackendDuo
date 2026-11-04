import type { GitTask } from '@/content/loadCourse';
import { GitSandboxEngine } from '@/engine/git/GitSandboxEngine';
import { hostingOf, type Hosting, type Project } from '@/engine/git/hosting/model';
import { computeStatus } from '@/engine/git/status';
import { splitCommands } from '@/engine/git/shell';
import { conflictKind, resolvePath, type Repo, type World } from '@/engine/git/world';
import { SolutionError, type CheckResult } from './index';

/** A command typed in the terminal and how it ended. */
export interface CommandRecord {
  line: string;
  exit: number;
}

interface Reference {
  world: World;
  /** Directory where the setup ends: the default repository of the task. */
  start: string;
  commands: CommandRecord[];
}

const verdict = (problems: string[]): CheckResult => ({ passed: problems.length === 0, problems });
const quote = (s: string) => `«${s}»`;
const subject = (repo: Repo, id: string) => repo.commits.get(id)!.message.split('\n')[0];

/** Runs setup and the reference solution in a fresh sandbox; a failing line is a content bug. */
export function runReference(task: GitTask): Reference {
  const engine = new GitSandboxEngine();
  engine.reset(task.shellSetup);
  const start = engine.world.cwd;
  const commands: CommandRecord[] = [];
  for (const command of splitCommands(task.shellSolution)) {
    const result = command.includes('\n') ? engine.runScript(command) : engine.run(command);
    const exit = 'exit' in result ? result.exit : result.failed ? result.failed.exit : 0;
    commands.push({ line: command.split('\n')[0], exit });
    if (exit !== 0) {
      const output = result.lines.map((l) => l.text).join('\n');
      throw new SolutionError(`${task.id}: эталонное решение упало на «${command.split('\n')[0]}»:\n${output}`);
    }
  }
  return { world: engine.world, start, commands };
}

// ---------------------------------------------------------------- history

/**
 * A commit's identity for comparison: its files, (optionally) message and the same of its parents.
 * Ids differ between runs (time moves with every command), this signature does not.
 */
function signer(repo: Repo, messages: boolean) {
  const memo = new Map<string, string>();
  const sign = (id: string): string => {
    const known = memo.get(id);
    if (known) return known;
    const c = repo.commits.get(id)!;
    const sig = `${c.tree}|${messages ? c.message.trim() : ''}|${c.parents.map(sign).join(',')}`;
    memo.set(id, sig);
    return sig;
  };
  return sign;
}

function firstParentLog(repo: Repo, id: string | undefined): string[] {
  const out: string[] = [];
  for (let c = id; c; c = repo.commits.get(c)!.parents[0]) out.push(subject(repo, c));
  return out;
}

const describeLog = (log: string[]) => (log.length ? `${log.length} ${log.length === 1 ? 'коммит' : log.length < 5 ? 'коммита' : 'коммитов'}: ${log.slice(0, 5).map(quote).join(' ← ')}${log.length > 5 ? ' ← …' : ''}` : 'нет коммитов');

function compareRef(problems: string[], label: string, want: Repo, wantId: string | undefined, got: Repo, gotId: string | undefined, messages: boolean): void {
  if (!wantId) {
    if (gotId) problems.push(`${label} не должно быть`);
    return;
  }
  if (!gotId) {
    problems.push(`${label} нет — её нужно создать`);
    return;
  }
  if (signer(want, messages)(wantId) === signer(got, messages)(gotId)) return;
  const wantLog = firstParentLog(want, wantId);
  const gotLog = firstParentLog(got, gotId);
  const wantMerge = want.commits.get(wantId)!.parents.length > 1;
  const gotMerge = got.commits.get(gotId)!.parents.length > 1;
  if (wantMerge && !gotMerge) problems.push(`${label}: последним ожидается коммит слияния (у него два родителя), а у вас обычный коммит`);
  else if (!wantMerge && gotMerge) problems.push(`${label}: коммит слияния здесь не нужен — история должна остаться линейной`);
  else if (messages && wantLog.join('\n') !== gotLog.join('\n')) problems.push(`${label}: ожидается ${describeLog(wantLog)}; у вас ${describeLog(gotLog)}`);
  else if (wantLog.length !== gotLog.length) problems.push(`${label}: ожидается ${describeLog(wantLog)}; у вас ${describeLog(gotLog)}`);
  else {
    const wantFiles = want.commits.get(wantId)!.files;
    const gotFiles = got.commits.get(gotId)!.files;
    const differ = [...new Set([...Object.keys(wantFiles), ...Object.keys(gotFiles)])].filter((f) => wantFiles[f] !== gotFiles[f]).sort();
    problems.push(
      differ.length
        ? `${label}: в последнем коммите не то содержимое файлов: ${differ.join(', ')}`
        : `${label}: коммиты совпадают по сообщениям, но отличаются содержимым или порядком — сравните историю с условием`,
    );
  }
}

function checkGraph(task: Extract<GitTask, { type: 'graph' }>, want: Repo, got: Repo): string[] {
  const problems: string[] = [];
  const messages = task.check.messages === 'exact';
  const refs = task.check.refs ?? [...want.branches.keys()].sort();
  for (const ref of refs) compareRef(problems, `Ветка ${ref}`, want, want.branches.get(ref), got, got.branches.get(ref), messages);
  if (task.check.tags) {
    for (const [name, tag] of want.tags) {
      const mine = got.tags.get(name);
      if (!mine) problems.push(`Тега ${name} нет`);
      else if (Boolean(tag.annotation) !== Boolean(mine.annotation)) problems.push(`Тег ${name} должен быть ${tag.annotation ? 'аннотированным (-a -m)' : 'лёгким (без -a)'}`);
      else compareRef(problems, `Тег ${name}`, want, tag.target, got, mine.target, messages);
    }
  }
  if (task.check.remotes) {
    for (const [name, id] of want.remoteBranches) compareRef(problems, `Ветка ${name}`, want, id, got, got.remoteBranches.get(name), messages);
  }
  if (task.check.head) {
    const wantHead = want.currentBranch();
    const gotHead = got.currentBranch();
    if (wantHead && gotHead !== wantHead) problems.push(gotHead ? `Сейчас вы на ветке ${gotHead}, а в конце нужно оказаться на ${wantHead}` : `HEAD отсоединён; в конце нужно оказаться на ветке ${wantHead}`);
    if (!wantHead && gotHead) problems.push(`В конце HEAD должен быть отсоединён (detached), а вы на ветке ${gotHead}`);
  }
  if (!want.merging && got.merging) problems.push('Операция не завершена: разрешите конфликты и закончите её (commit или --continue)');
  if (!want.rebase && got.rebase) problems.push('Перебазирование не завершено: git rebase --continue или --abort');
  return problems;
}

// ---------------------------------------------------------------- working tree

function checkWorktree(task: Extract<GitTask, { type: 'worktree' }>, want: Repo, got: Repo): string[] {
  const problems: string[] = [];
  const wantTree = want.worktree();
  const gotTree = got.worktree();
  const files = task.check.files ?? [...new Set([...Object.keys(wantTree), ...Object.keys(gotTree)])].filter((f) => !got.isIgnored(f) || f in wantTree).sort();
  for (const f of files) {
    if (wantTree[f] === gotTree[f]) continue;
    if (wantTree[f] === undefined) problems.push(`Файла ${f} в рабочей папке быть не должно`);
    else if (gotTree[f] === undefined) problems.push(`В рабочей папке нет файла ${f}`);
    else problems.push(`Содержимое файла ${f} отличается от ожидаемого`);
  }
  const wantStatus = computeStatus(want);
  const gotStatus = computeStatus(got);
  for (const path of gotStatus.conflicts) if (!wantStatus.conflicts.includes(path)) problems.push(`Конфликт в ${path} ещё не разрешён (${conflictKind(got.conflicts.get(path)!)}): исправьте файл и выполните git add`);
  if (task.check.index) {
    const scope = (p: string) => !task.check.files || task.check.files.includes(p);
    const w = new Set(wantStatus.staged.map((c) => c.path).filter(scope));
    const g = new Set(gotStatus.staged.map((c) => c.path).filter(scope));
    for (const path of w) {
      if (!g.has(path)) problems.push(`Изменение в ${path} должно быть в индексе (git add)`);
      else if (want.index.get(path) !== got.index.get(path)) problems.push(`В индексе другая версия ${path}: добавьте файл заново после правки (git add)`);
    }
    for (const path of g) if (!w.has(path)) problems.push(`Изменение в ${path} не должно быть в индексе`);
  }
  if (task.check.untracked) {
    const w = new Set(wantStatus.untracked);
    const g = new Set(gotStatus.untracked);
    for (const p of g) if (!w.has(p)) problems.push(`${p} не должен оставаться неотслеживаемым`);
    for (const p of w) if (!g.has(p)) problems.push(`${p} должен остаться неотслеживаемым (не добавляйте его в Git)`);
  }
  return problems;
}

// ---------------------------------------------------------------- commands

function checkCommands(task: Extract<GitTask, { type: 'commands' }>, commands: CommandRecord[]): string[] {
  const problems: string[] = [];
  for (const rule of task.check.require) {
    const re = new RegExp(rule.pattern);
    if (!commands.some((c) => c.exit === 0 && re.test(c.line))) problems.push(rule.message);
  }
  for (const rule of task.check.forbid) {
    const re = new RegExp(rule.pattern);
    if (commands.some((c) => re.test(c.line))) problems.push(rule.message);
  }
  return problems;
}

// ---------------------------------------------------------------- hosting and CI

function projectsOf(hosting: Hosting, only?: string): Project[] {
  return only ? [hosting.projects.get(only)].filter((p): p is Project => Boolean(p)) : [...hosting.projects.values()];
}

function checkHosting(task: Extract<GitTask, { type: 'hosting' }>, want: Hosting, got: Hosting): string[] {
  const problems: string[] = [];
  for (const wp of projectsOf(want, task.check.project)) {
    const name = `${wp.owner}/${wp.name}`;
    const gp = got.projects.get(name);
    if (!gp) {
      problems.push(`На хостинге нет репозитория ${name}${wp.parent ? ` (форк ${wp.parent})` : ''}`);
      continue;
    }
    if (wp.parent && gp.parent !== wp.parent) problems.push(`${name} должен быть форком ${wp.parent}`);
    if (task.check.branches) {
      for (const [branch, id] of wp.repo.branches) compareRef(problems, `${name}: ветка ${branch}`, wp.repo, id, gp.repo, gp.repo.branches.get(branch), false);
      for (const branch of gp.repo.branches.keys()) if (!wp.repo.branches.has(branch)) problems.push(`${name}: ветки ${branch} на хостинге быть не должно`);
    }
    const word = want.flavor === 'github' ? 'Pull request' : 'Merge request';
    if (task.check.pulls) {
      for (const pr of wp.pulls) {
        const match = gp.pulls.find((x) => x.head.branch === pr.head.branch && x.base.branch === pr.base.branch && x.head.project === pr.head.project);
        const what = `${word} из ${pr.head.project === name ? '' : `${pr.head.project.split('/')[0]}:`}${pr.head.branch} в ${pr.base.branch}`;
        if (!match) problems.push(`${what} не найден`);
        else if (match.state !== pr.state) problems.push(`${what} должен быть ${{ open: 'открыт', merged: 'слит', closed: 'закрыт без слияния' }[pr.state]}, а он ${{ open: 'открыт', merged: 'слит', closed: 'закрыт' }[match.state]}`);
        else if (pr.reviews.some((r) => r.state === 'approved') && !match.reviews.some((r) => r.state === 'approved')) problems.push(`${what} должен получить одобрение ревьюера`);
      }
      const extra = gp.pulls.length - wp.pulls.length;
      if (extra > 0) problems.push(`Лишних ${word.toLowerCase()}: ${extra}`);
    }
    if (task.check.issues) {
      if (gp.issues.length < wp.issues.length) problems.push(`Ожидается задач (issues): ${wp.issues.length}, у вас: ${gp.issues.length}`);
      for (const issue of wp.issues) {
        const mine = gp.issues.find((i) => i.number === issue.number);
        if (!mine) continue;
        if (mine.state !== issue.state) problems.push(`Задача #${issue.number} должна быть ${issue.state === 'open' ? 'открыта' : 'закрыта'}`);
        for (const label of issue.labels) if (!mine.labels.includes(label)) problems.push(`У задачи #${issue.number} нет метки ${label}`);
      }
    }
    if (task.check.releases) {
      for (const r of wp.releases) if (!gp.releases.some((x) => x.tag === r.tag)) problems.push(`Нет релиза ${r.tag}`);
    }
    if (task.check.protections) {
      for (const [branch, rule] of wp.protections) {
        const mine = gp.protections.get(branch);
        if (!mine) problems.push(`Ветка ${branch} должна быть защищена`);
        else {
          if (mine.approvals < rule.approvals) problems.push(`Для ${branch} нужно требовать одобрений: ${rule.approvals}`);
          if (rule.requireChecks && !mine.requireChecks) problems.push(`Для ${branch} нужно требовать успешные проверки CI`);
        }
      }
    }
  }
  return problems;
}

function checkCi(task: Extract<GitTask, { type: 'ci' }>, want: Hosting, got: Hosting): string[] {
  const problems: string[] = [];
  for (const wp of projectsOf(want, task.check.project)) {
    const name = `${wp.owner}/${wp.name}`;
    const gp = got.projects.get(name);
    if (!gp) {
      problems.push(`На хостинге нет репозитория ${name}`);
      continue;
    }
    const branch = task.check.branch ?? want.defaultBranch(wp);
    const latest = (p: Project) => {
      const byFile = new Map<string, (typeof p.runs)[number]>();
      for (const r of p.runs) if (r.branch === branch && r.event === 'push') byFile.set(r.file, r);
      return byFile;
    };
    const w = latest(wp);
    const g = latest(gp);
    if (!g.size && w.size) {
      problems.push(`На ветке ${branch} не было ни одного запуска CI: отправьте коммит с файлом ${[...w.keys()][0]} (git push) и проверьте раздел on:/rules`);
      continue;
    }
    for (const [file, run] of w) {
      const mine = g.get(file) ?? [...g.values()].find((r) => r.workflow === run.workflow);
      if (!mine) {
        problems.push(`Не запускался ${run.workflow === 'pipeline' ? 'пайплайн' : `workflow ${run.workflow}`} (${file})`);
        continue;
      }
      if (mine.status !== run.status) {
        const failed = mine.jobs.find((j) => j.status === 'failure');
        const step = failed?.steps.find((s) => s.status === 'failure');
        problems.push(
          run.status === 'success'
            ? `Последний запуск на ${branch} упал${failed ? ` в задании ${quote(failed.name)}${step && step.name !== failed.name ? `, шаг ${quote(step.name)}` : ''}` : ''}: посмотрите журнал во вкладке «Хостинг»`
            : `Последний запуск на ${branch} должен падать, а он прошёл`,
        );
        continue;
      }
      for (const job of run.jobs) {
        const j = mine.jobs.find((x) => x.name === job.name);
        if (!j) problems.push(`В запуске нет задания ${quote(job.name)}`);
        else if (j.status !== job.status) problems.push(`Задание ${quote(job.name)}: ожидается «${job.status}», у вас «${j.status}»`);
      }
    }
  }
  return problems;
}

/**
 * Checks a Git task: the learner's sandbox (and the commands typed there) against the reference result
 * of setup + solution. References are cached per task.
 */
export function createGitChecker() {
  const cache = new Map<string, Reference>();
  const reference = (task: GitTask) => {
    let ref = cache.get(task.id);
    if (!ref) {
      ref = runReference(task);
      cache.set(task.id, ref);
    }
    return ref;
  };

  return {
    reference,
    check(task: GitTask, learner: World, commands: CommandRecord[]): CheckResult {
      const ref = reference(task);
      if (task.type === 'commands') return verdict(checkCommands(task, commands));
      if (task.type === 'hosting') return verdict(checkHosting(task, hostingOf(ref.world), hostingOf(learner)));
      if (task.type === 'ci') return verdict(checkCi(task, hostingOf(ref.world), hostingOf(learner)));
      const path = task.check.repo ? resolvePath(ref.start, task.check.repo) : ref.start;
      const want = ref.world.repoAt(path);
      if (!want) throw new SolutionError(`${task.id}: после эталонного решения в ${path} нет репозитория`);
      const got = learner.repoAt(path);
      if (!got || got.root !== want.root) return verdict([`В папке ${path.replace('/home/student', '~')} нет репозитория Git — проверьте, что вы в нужной папке и выполнили git init`]);
      return verdict(task.type === 'graph' ? checkGraph(task, want, got) : checkWorktree(task, want, got));
    },
  };
}

export type GitChecker = ReturnType<typeof createGitChecker>;
