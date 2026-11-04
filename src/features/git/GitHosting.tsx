import { useState, type ReactNode } from 'react';
import type { Run } from '@/engine/git/hosting/ci';
import { fullName, hostingOf, type Hosting, type Project, type PullRequest } from '@/engine/git/hosting/model';
import { Button } from '@/ui/Button';
import { Markdown } from '@/ui/Markdown';
import { EmptyState } from '@/ui/Panel';
import { useGitSandbox } from './gitSandbox';

type Page = 'code' | 'pulls' | 'issues' | 'ci' | 'releases' | 'settings';

const STATUS: Record<string, { text: string; tone: string }> = {
  success: { text: '✓', tone: 'text-ok' },
  failure: { text: '✗', tone: 'text-err' },
  skipped: { text: '–', tone: 'text-faint' },
  manual: { text: '▶', tone: 'text-amber' },
};

function Badge({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.skipped;
  return <span className={`font-mono ${s.tone}`}>{s.text}</span>;
}

/** The project a local repository in the current directory is connected to (origin first). */
function currentProject(hosting: Hosting, world: Hosting['world']): Project | undefined {
  const repo = world.repoAt(world.cwd);
  if (!repo) return undefined;
  for (const name of ['origin', ...repo.remotes.keys()]) {
    const url = repo.remotes.get(name);
    const found = url ? hosting.find(url) : undefined;
    if (found) return found;
  }
  return undefined;
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="mb-4">
      <header className="mb-1.5 flex items-center gap-2">
        <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-dim">{title}</h3>
        <div className="ml-auto">{action}</div>
      </header>
      {children}
    </section>
  );
}

function RunView({ run }: { run: Run }) {
  const [open, setOpen] = useState(run.status === 'failure');
  return (
    <li className="rounded border border-line bg-well">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px]" aria-expanded={open}>
        <Badge status={run.status} />
        <span className="truncate text-fg">{run.title}</span>
        <span className="ml-auto shrink-0 font-mono text-[11px] text-faint">
          {run.workflow} · {run.branch} · {run.event === 'push' ? 'push' : 'PR'} · #{run.id}
        </span>
      </button>
      {open && (
        <div className="border-t border-line px-2.5 py-2">
          {run.jobs.map((job) => (
            <div key={job.name} className="mb-2">
              <p className="text-[13px]">
                <Badge status={job.status} /> {job.name}
                {job.stage && <span className="text-faint"> · {job.stage}</span>}
              </p>
              {job.steps.map((step, i) => (
                <details key={i} open={step.status === 'failure'} className="ml-4 text-[12.5px]">
                  <summary className="cursor-pointer text-dim">
                    <Badge status={step.status} /> {step.name}
                  </summary>
                  {step.log.length > 0 && <pre className="mt-1 overflow-auto whitespace-pre-wrap rounded bg-bg p-2 font-mono text-[12px] text-dim">{step.log.join('\n')}</pre>}
                </details>
              ))}
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

function PullView({ hosting, base, pr, cli }: { hosting: Hosting; base: Project; pr: PullRequest; cli: 'gh' | 'glab' }) {
  const run = useGitSandbox((s) => s.run);
  const touch = useGitSandbox((s) => s.touch);
  const blockers = pr.state === 'open' ? hosting.blockers(base, pr) : [];
  const checks = hosting.checks(base, pr);
  const repoFlag = `-R ${fullName(base)}`;
  const merge = cli === 'gh' ? `gh pr merge ${pr.number} ${repoFlag}` : `glab mr merge ${pr.number} ${repoFlag} --yes`;
  return (
    <div className="rounded border border-line bg-well p-3 text-[13px]">
      <p className="text-[12px] text-faint">
        {pr.author} · {pr.head.project === fullName(base) ? '' : `${pr.head.project.split('/')[0]}:`}
        {pr.head.branch} → {pr.base.branch}
      </p>
      {pr.body ? <Markdown source={pr.body} className="mt-2" /> : <p className="mt-2 text-faint">Без описания</p>}
      <div className="mt-3 space-y-1">
        <p>
          <span className="text-faint">Проверки: </span>
          {checks.length ? checks.map((r) => (
            <span key={r.id} className="mr-2">
              <Badge status={r.status} /> {r.workflow}
            </span>
          )) : 'не запускались'}
        </p>
        {pr.reviews.map((r, i) => (
          <p key={i}>
            <span className={r.state === 'approved' ? 'text-ok' : r.state === 'changes_requested' ? 'text-err' : 'text-dim'}>
              {r.author}: {r.state === 'approved' ? 'одобрил' : r.state === 'changes_requested' ? 'просит изменений' : 'прокомментировал'}
            </span>
            {r.body && <span className="text-dim"> — {r.body}</span>}
          </p>
        ))}
        {pr.comments.map((c, i) => (
          <p key={`c${i}`} className="text-dim">
            {c.author}: {c.body}
          </p>
        ))}
      </div>
      {pr.state === 'open' ? (
        <>
          <p className={`mt-3 ${blockers.length ? 'text-amber' : 'text-ok'}`}>{blockers.length ? `Слить пока нельзя: ${blockers.join('; ')}.` : 'Все условия выполнены — можно сливать.'}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="check" disabled={blockers.length > 0} onClick={() => run(merge)}>
              Слить
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                hosting.requestReview(base, pr);
                touch();
              }}
            >
              Попросить ревью у наставника
            </Button>
            <Button variant="ghost" onClick={() => run(`${cli} ${cli === 'gh' ? 'pr' : 'mr'} close ${pr.number} ${repoFlag}`)}>
              Закрыть
            </Button>
          </div>
          <p className="mt-2 font-mono text-[11px] text-faint">Кнопка «Слить» выполняет в терминале: {merge}</p>
        </>
      ) : (
        <p className="mt-3 text-dim">{pr.state === 'merged' ? `Слит${pr.mergedCommit ? ` в коммите ${pr.mergedCommit.slice(0, 7)}` : ''}.` : 'Закрыт без слияния.'}</p>
      )}
    </div>
  );
}

/** Pages of the training hosting: code, pull/merge requests, issues, CI, releases and branch protection. */
export function GitHosting() {
  const engine = useGitSandbox((s) => s.engine);
  useGitSandbox((s) => s.version);
  const run = useGitSandbox((s) => s.run);
  const touch = useGitSandbox((s) => s.touch);
  const hosting = hostingOf(engine.world);
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState<Page>('code');
  const [openPr, setOpenPr] = useState<number | null>(null);
  const [issueTitle, setIssueTitle] = useState('');

  const github = hosting.flavor === 'github';
  const cli = github ? 'gh' : 'glab';
  const project = (selected ? hosting.projects.get(selected) : undefined) ?? currentProject(hosting, engine.world) ?? [...hosting.projects.values()][0];
  const repo = engine.world.repoAt(engine.world.cwd);

  const flavorToggle = (
    <div role="radiogroup" aria-label="Вид хостинга" className="flex overflow-hidden rounded border border-line text-[12px]">
      {(['github', 'gitlab'] as const).map((f) => (
        <button
          key={f}
          type="button"
          role="radio"
          aria-checked={hosting.flavor === f}
          onClick={() => {
            hosting.flavor = f;
            touch();
          }}
          className={`px-2 py-0.5 ${hosting.flavor === f ? 'bg-raised text-fg' : 'text-faint hover:text-dim'}`}
        >
          {f === 'github' ? 'GitHub' : 'GitLab'}
        </button>
      ))}
    </div>
  );

  const header = (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
      {flavorToggle}
      {hosting.projects.size > 0 && (
        <select
          aria-label="Проект"
          value={project ? fullName(project) : ''}
          onChange={(e) => setSelected(e.target.value)}
          className="rounded border border-line bg-well px-1.5 py-0.5 font-mono text-[12px] text-fg"
        >
          {[...hosting.projects.values()].map((p) => (
            <option key={fullName(p)} value={fullName(p)}>
              {fullName(p)}
            </option>
          ))}
        </select>
      )}
      <span className="ml-auto text-[11px] text-faint">учебный хостинг: без сети, аккаунтов и токенов</span>
    </div>
  );

  if (!project) {
    const name = repo?.root.split('/').pop() ?? 'site';
    return (
      <div className="flex h-full flex-col">
        {header}
        <EmptyState>
          <div className="space-y-3">
            <p>На учебном {github ? 'GitHub' : 'GitLab'} пока нет репозиториев.</p>
            <p className="font-mono text-[12px] text-dim">{cli} repo create {name} --source=. --push</p>
            {repo && (
              <Button variant="check" onClick={() => run(github ? `gh repo create ${name} --source=. --push` : `glab repo create ${name} && git remote add origin https://gitlab.com/student/${name}.git && git push -u origin ${repo.currentBranch() ?? 'main'}`)}>
                Создать репозиторий и отправить код
              </Button>
            )}
          </div>
        </EmptyState>
      </div>
    );
  }

  const branch = hosting.defaultBranch(project);
  const tip = project.repo.branches.get(branch);
  const files = tip ? project.repo.commits.get(tip)!.files : {};
  const openPulls = project.pulls.filter((p) => p.state === 'open').length;
  const openIssues = project.issues.filter((i) => i.state === 'open').length;
  const pages: { id: Page; title: string }[] = [
    { id: 'code', title: 'Код' },
    { id: 'pulls', title: `${github ? 'Pull requests' : 'Merge requests'}${openPulls ? ` ${openPulls}` : ''}` },
    { id: 'issues', title: `Issues${openIssues ? ` ${openIssues}` : ''}` },
    { id: 'ci', title: github ? 'Actions' : 'CI/CD' },
    { id: 'releases', title: 'Релизы' },
    { id: 'settings', title: 'Настройки' },
  ];
  const protection = project.protections.get(branch);
  const R = `-R ${fullName(project)}`;

  return (
    <div className="flex h-full flex-col">
      {header}
      <nav aria-label="Страницы проекта" className="flex flex-wrap gap-x-4 gap-y-1 border-b border-line px-3 py-1.5 text-[12.5px]">
        {pages.map((p) => (
          <button key={p.id} type="button" aria-current={page === p.id ? 'page' : undefined} onClick={() => setPage(p.id)} className={page === p.id ? 'text-fg' : 'text-faint hover:text-dim'}>
            {p.title}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-auto p-3 text-[13px]">
        <p className="mb-3 font-mono text-[12px] text-faint">
          {hosting.web(project)}
          {project.parent && <span> · форк {project.parent}</span>}
        </p>

        {page === 'code' && (
          <>
            <Section title="Ветки">
              <ul className="space-y-0.5 font-mono text-[12.5px]">
                {[...project.repo.branches].sort().map(([name, id]) => (
                  <li key={name} className="flex gap-2">
                    <span className={name === branch ? 'text-ok' : 'text-fg'}>{name}</span>
                    <span className="text-faint">{id.slice(0, 7)}</span>
                    <span className="truncate text-dim">{project.repo.commits.get(id)!.message.split('\n')[0]}</span>
                    {project.protections.has(name) && <span className="text-amber">защищена</span>}
                  </li>
                ))}
                {!project.repo.branches.size && <li className="text-faint">Репозиторий пуст: отправьте код командой git push.</li>}
              </ul>
            </Section>
            <Section title={`Файлы ${branch}`}>
              <ul className="font-mono text-[12.5px] text-dim">
                {Object.keys(files).sort().map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </Section>
            {files['README.md'] && (
              <Section title="README.md">
                <Markdown source={files['README.md']} />
              </Section>
            )}
          </>
        )}

        {page === 'pulls' && (
          <Section title={github ? 'Pull requests' : 'Merge requests'}>
            {!project.pulls.length && <p className="text-faint">Пока нет. Отправьте ветку (git push -u origin имя) и выполните: {cli} {github ? 'pr' : 'mr'} create --fill</p>}
            <ul className="space-y-2">
              {[...project.pulls].reverse().map((pr) => (
                <li key={pr.number}>
                  <button type="button" onClick={() => setOpenPr(openPr === pr.number ? null : pr.number)} className="flex w-full items-center gap-2 text-left" aria-expanded={openPr === pr.number}>
                    <span className={pr.state === 'open' ? 'text-ok' : pr.state === 'merged' ? 'text-nav' : 'text-faint'}>{{ open: 'открыт', merged: 'слит', closed: 'закрыт' }[pr.state]}</span>
                    <span className="text-fg">{pr.title}</span>
                    <span className="font-mono text-[12px] text-faint">{hosting.pullRef(pr.number)}</span>
                  </button>
                  {openPr === pr.number && <div className="mt-2"><PullView hosting={hosting} base={project} pr={pr} cli={cli} /></div>}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {page === 'issues' && (
          <Section title="Issues">
            <form
              className="mb-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!issueTitle.trim()) return;
                run(`${cli} issue create ${R} ${github ? '--title' : '-t'} '${issueTitle.replace(/'/g, '')}'`);
                setIssueTitle('');
              }}
            >
              <input
                value={issueTitle}
                onChange={(e) => setIssueTitle(e.target.value)}
                placeholder="Заголовок новой задачи"
                aria-label="Заголовок новой задачи"
                className="min-w-0 flex-1 rounded border border-line bg-well px-2 py-1 text-[13px] text-fg outline-none focus:border-nav"
              />
              <Button type="submit" variant="outline" disabled={!issueTitle.trim()}>
                Создать
              </Button>
            </form>
            <ul className="space-y-1.5">
              {[...project.issues].reverse().map((issue) => (
                <li key={issue.number} className="flex items-start gap-2">
                  <span className={issue.state === 'open' ? 'text-ok' : 'text-faint'}>{issue.state === 'open' ? 'открыта' : 'закрыта'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="text-fg">{issue.title}</span> <span className="font-mono text-[12px] text-faint">#{issue.number}</span>
                    {issue.labels.length > 0 && <span className="ml-1 text-[12px] text-amber">{issue.labels.join(', ')}</span>}
                    {issue.closedBy && <span className="block text-[12px] text-faint">закрыта: {issue.closedBy}</span>}
                  </span>
                  {issue.state === 'open' && (
                    <Button variant="ghost" onClick={() => run(`${cli} issue close ${issue.number} ${R}`)}>
                      Закрыть
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {page === 'ci' && (
          <Section title={github ? 'Запуски workflow' : 'Пайплайны'}>
            {!project.runs.length && (
              <p className="text-faint">
                Запусков нет. {github ? 'Добавьте workflow в .github/workflows/ci.yml' : 'Добавьте .gitlab-ci.yml'} и отправьте коммит.
              </p>
            )}
            <ul className="space-y-1.5">
              {[...project.runs].reverse().map((r) => (
                <RunView key={r.id} run={r} />
              ))}
            </ul>
          </Section>
        )}

        {page === 'releases' && (
          <Section title="Релизы" action={<span className="font-mono text-[11px] text-faint">{cli} release create v1.0 --notes "…"</span>}>
            {!project.releases.length && <p className="text-faint">Релизов пока нет.</p>}
            <ul className="space-y-2">
              {project.releases.map((r, i) => (
                <li key={r.tag} className="rounded border border-line bg-well p-2.5">
                  <p>
                    <span className="text-fg">{r.title}</span> <span className="font-mono text-[12px] text-amber">{r.tag}</span>
                    {i === 0 && <span className="ml-2 text-[12px] text-ok">последний</span>}
                  </p>
                  {r.notes && <Markdown source={r.notes} className="mt-1" />}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {page === 'settings' && (
          <Section title={`Защита ветки ${branch}`}>
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(protection)}
                  onChange={(e) => {
                    if (e.target.checked) hosting.protect(project, branch, {});
                    else project.protections.delete(branch);
                    touch();
                  }}
                />
                Только через {github ? 'pull request' : 'merge request'} (прямой push запрещён)
              </label>
              <label className={`flex items-center gap-2 ${protection ? '' : 'opacity-50'}`}>
                <input
                  type="checkbox"
                  disabled={!protection}
                  checked={Boolean(protection?.requireChecks)}
                  onChange={(e) => {
                    if (protection) protection.requireChecks = e.target.checked;
                    touch();
                  }}
                />
                Требовать успешные проверки CI
              </label>
              <label className={`flex items-center gap-2 ${protection ? '' : 'opacity-50'}`}>
                Нужно одобрений:
                <input
                  type="number"
                  min={0}
                  max={3}
                  disabled={!protection}
                  value={protection?.approvals ?? 0}
                  onChange={(e) => {
                    if (protection) protection.approvals = Math.max(0, Math.min(3, Number(e.target.value)));
                    touch();
                  }}
                  className="w-14 rounded border border-line bg-well px-1.5 py-0.5 text-fg"
                />
              </label>
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
