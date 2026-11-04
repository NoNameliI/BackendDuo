import { useMemo } from 'react';
import { computeStatus } from '@/engine/git/status';
import { EmptyState } from '@/ui/Panel';
import { useSandbox } from './gitSandbox';

const KIND: Record<string, string> = { added: 'новый', modified: 'изменён', deleted: 'удалён', renamed: 'переименован' };

function Zone({ title, hint, items, tone }: { title: string; hint: string; items: string[]; tone: string }) {
  return (
    <section className="flex min-w-0 flex-col rounded-md border border-line bg-well p-3">
      <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-dim">{title}</h3>
      <p className="mt-1 text-[12px] leading-snug text-faint">{hint}</p>
      <ul className="mt-2 space-y-0.5 font-mono text-[12.5px]">
        {items.length === 0 && <li className="text-faint">—</li>}
        {items.map((item) => (
          <li key={item} className={`truncate ${tone}`}>
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The three areas of Git — working tree, index and commits — for the repository in the current directory. */
export function GitStatusView() {
  const useGitSandbox = useSandbox();
  const engine = useGitSandbox((s) => s.engine);
  const version = useGitSandbox((s) => s.version);
  const repo = engine.world.repoAt(engine.world.cwd);
  const status = useMemo(() => (repo && !repo.bare ? computeStatus(repo) : null), [repo, version]);

  if (!repo || !status) return <EmptyState>Здесь нет репозитория с рабочей папкой.</EmptyState>;
  const head = repo.headCommit();
  const branch = repo.currentBranch();
  const worktree = [
    ...status.unstaged.map((u) => `${u.path} · ${KIND[u.kind]}`),
    ...status.untracked.map((u) => `${u} · не отслеживается`),
    ...status.conflicts.map((c) => `${c} · конфликт`),
  ];
  const recent: string[] = [];
  for (let c = head; c && recent.length < 5; c = c.parents[0] ? repo.commits.get(c.parents[0]) : undefined) {
    recent.push(`${repo.short(c.id)} ${c.message.split('\n')[0]}`);
  }
  const staged = status.staged.map((c) => `${c.from ? `${c.from} → ` : ''}${c.path} · ${KIND[c.kind]}`);

  return (
    <div className="h-full overflow-auto p-3">
      <p className="mb-3 text-[13px] text-dim">
        {branch ? (
          <>
            Ветка <span className="font-mono text-fg">{branch}</span>
          </>
        ) : (
          <>Отсоединённый HEAD (не на ветке)</>
        )}
        {head ? (
          <>
            , последний коммит <span className="font-mono text-fg">{repo.short(head.id)}</span> «{head.message.split('\n')[0]}»
          </>
        ) : (
          ', коммитов пока нет'
        )}
        {repo.merging && <span className="text-amber"> · идёт {repo.merging.kind === 'merge' ? 'слияние' : 'операция'}: разрешите конфликты</span>}
      </p>
      <div className="grid gap-2 @lg:grid-cols-3">
        <Zone title="Рабочая папка" hint="Изменения, которые ещё не добавлены в индекс (git add)." items={worktree} tone="text-amber" />
        <Zone title="Индекс" hint="Подготовлено и войдёт в следующий коммит (git commit)." items={staged} tone="text-ok" />
        <Zone
          title="Репозиторий"
          hint="Сохранённые коммиты текущей ветки."
          items={head ? [...repo.ancestors(head.id)].slice(0, 0).concat(`${repo.short(head.id)} ${head.message.split('\n')[0]}`) : []}
          tone="text-fg"
        />
      </div>
    </div>
  );
}
