import { useMemo } from 'react';
import { computeStatus, type Status } from '@/engine/git/status';
import { displayPath, type World } from '@/engine/git/world';
import { useSandbox } from './gitSandbox';

type Mark = { code: string; title: string; tone: string };

const MARKS: Record<string, Mark> = {
  staged: { code: 'И', title: 'изменение в индексе — войдёт в следующий коммит', tone: 'text-ok' },
  modified: { code: 'М', title: 'изменён, но не добавлен в индекс', tone: 'text-amber' },
  both: { code: 'ИМ', title: 'часть изменений в индексе, часть — нет', tone: 'text-amber' },
  deleted: { code: 'У', title: 'удалён в рабочей папке', tone: 'text-err' },
  untracked: { code: 'Н', title: 'новый, Git за ним не следит', tone: 'text-nav' },
  ignored: { code: '—', title: 'игнорируется (.gitignore)', tone: 'text-faint' },
  conflict: { code: 'К', title: 'конфликт слияния', tone: 'text-err' },
};

function marksFor(status: Status | null): Map<string, Mark> {
  const marks = new Map<string, Mark>();
  if (!status) return marks;
  for (const c of status.staged) marks.set(c.path, MARKS.staged);
  for (const u of status.unstaged) marks.set(u.path, u.kind === 'deleted' ? MARKS.deleted : marks.has(u.path) ? MARKS.both : MARKS.modified);
  for (const u of status.untracked) marks.set(u, MARKS.untracked);
  for (const c of status.conflicts) marks.set(c, MARKS.conflict);
  return marks;
}

interface Row {
  path: string;
  name: string;
  depth: number;
  dir: boolean;
}

function tree(world: World, root: string): Row[] {
  const prefix = root === '/' ? '/' : `${root}/`;
  const entries = new Set<string>();
  for (const path of world.files.keys()) if (path.startsWith(prefix)) entries.add(path);
  for (const path of world.dirs) if (path.startsWith(prefix)) entries.add(`${path}/`);
  const rows: Row[] = [];
  for (const entry of [...entries].sort()) {
    const dir = entry.endsWith('/');
    const path = dir ? entry.slice(0, -1) : entry;
    const rel = path.slice(prefix.length);
    if (rel.split('/').includes('.git')) continue;
    rows.push({ path, name: rel.split('/').pop()!, depth: rel.split('/').length - 1, dir });
  }
  return rows;
}

/** Files of the current project with their Git state; a click opens a file in the editor. */
export function GitFiles() {
  const useGitSandbox = useSandbox();
  const engine = useGitSandbox((s) => s.engine);
  const version = useGitSandbox((s) => s.version);
  const openFile = useGitSandbox((s) => s.openFile);
  const setOpenFile = useGitSandbox((s) => s.setOpenFile);
  const world = engine.world;
  const repo = world.repoAt(world.cwd);
  const root = repo?.root ?? world.cwd;

  const { rows, marks, status } = useMemo(() => {
    const status = repo && !repo.bare ? computeStatus(repo) : null;
    return { rows: tree(world, root), marks: marksFor(status), status };
  }, [world, root, repo, version]);

  const markOf = (row: Row): Mark | undefined => {
    if (!repo) return undefined;
    const rel = row.path.slice(root.length + 1);
    if (row.dir) return marks.get(`${rel}/`);
    return marks.get(rel) ?? (repo.isIgnored(rel) ? MARKS.ignored : undefined);
  };
  const deleted = status?.unstaged.filter((u) => u.kind === 'deleted').map((u) => u.path) ?? [];

  return (
    <div className="flex h-full flex-col overflow-auto">
      <p className="border-b border-line px-3 py-2 font-mono text-[12px] text-faint">
        {displayPath(root)}
        {repo ? ` · ветка ${repo.currentBranch() ?? 'не выбрана (detached HEAD)'}` : ' · не репозиторий'}
      </p>
      <ul aria-label="Файлы проекта" className="py-1 font-mono text-[12.5px]">
        {rows.map((row) => {
          const mark = markOf(row);
          const selected = row.path === openFile;
          return (
            <li key={row.path}>
              <button
                type="button"
                disabled={row.dir}
                onClick={() => setOpenFile(row.path)}
                title={mark?.title}
                className={`flex w-full items-center gap-2 py-0.5 pr-3 text-left ${selected ? 'bg-raised text-fg' : 'text-dim'} ${row.dir ? 'cursor-default' : 'hover:bg-raised'}`}
                style={{ paddingLeft: 12 + row.depth * 14 }}
              >
                <span className={`truncate ${row.dir ? 'text-faint' : ''}`}>
                  {row.name}
                  {row.dir ? '/' : ''}
                </span>
                {mark && <span className={`ml-auto shrink-0 text-[11px] ${mark.tone}`}>{mark.code}</span>}
              </button>
            </li>
          );
        })}
        {deleted.map((rel) => (
          <li key={rel} className="flex items-center gap-2 py-0.5 pl-3 pr-3 text-faint line-through" title={MARKS.deleted.title}>
            {rel}
            <span className="ml-auto text-[11px] text-err no-underline">{MARKS.deleted.code}</span>
          </li>
        ))}
      </ul>
      {repo && (
        <details className="mt-auto border-t border-line px-3 py-2 text-[12px] text-faint">
          <summary className="cursor-pointer select-none">Что означают буквы</summary>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2">
            {Object.values(MARKS).map((m) => (
              <div key={m.code} className="contents">
                <dt className={`font-mono ${m.tone}`}>{m.code}</dt>
                <dd>{m.title}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}
