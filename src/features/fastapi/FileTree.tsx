import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/ui/Button';
import { buildTree, pathError, visibleNodes } from './project';

interface Props {
  paths: string[];
  entry: string;
  /** Files the task does not let change: marked with text in the tree. */
  readonly?: readonly string[];
  active: string;
  onOpen: (path: string) => void;
  /** Each returns an error message in Russian, or null when the change was made. */
  onCreate: (path: string) => string | null;
  onRename: (from: string, to: string) => string | null;
  onDelete: (path: string) => string | null;
}

const input = 'min-w-0 flex-1 rounded border border-line bg-well px-1.5 py-0.5 font-mono text-[12px] text-fg outline-none focus:border-nav';

/** The files of the project as a tree: arrows move, Enter opens, F2 renames, Delete deletes (after a confirmation). */
export function FileTree({ paths, entry, readonly = [], active, onOpen, onCreate, onRename, onDelete }: Props) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [focused, setFocused] = useState(active);
  const [renaming, setRenaming] = useState<{ path: string; text: string } | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => visibleNodes(buildTree(paths), collapsed), [paths, collapsed]);
  const current = rows.some((r) => r.node.path === focused) ? focused : (rows[0]?.node.path ?? '');

  // A file opened elsewhere (a tab, the docs) becomes the focused one.
  useEffect(() => setFocused(active), [active]);

  const focusRow = (path: string) => {
    setFocused(path);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)?.focus());
  };

  const toggle = (path: string, open: boolean) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (open) next.delete(path);
      else next.add(path);
      return next;
    });

  const onKeyDown = (e: KeyboardEvent<HTMLElement>, node: { path: string; kind: 'file' | 'dir' }) => {
    const index = rows.findIndex((r) => r.node.path === node.path);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = rows[Math.max(0, Math.min(rows.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) focusRow(next.node.path);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      focusRow(rows[e.key === 'Home' ? 0 : rows.length - 1].node.path);
    } else if (e.key === 'ArrowRight' && node.kind === 'dir') {
      e.preventDefault();
      if (collapsed.has(node.path)) toggle(node.path, true);
      else if (rows[index + 1]?.depth > rows[index].depth) focusRow(rows[index + 1].node.path);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (node.kind === 'dir' && !collapsed.has(node.path)) toggle(node.path, false);
      else {
        const parent = rows.slice(0, index).reverse().find((r) => r.depth < rows[index].depth);
        if (parent) focusRow(parent.node.path);
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (node.kind === 'dir') toggle(node.path, collapsed.has(node.path));
      else onOpen(node.path);
    } else if (e.key === 'F2' && node.kind === 'file') {
      e.preventDefault();
      setError(null);
      setRenaming({ path: node.path, text: node.path });
    } else if (e.key === 'Delete' && node.kind === 'file') {
      e.preventDefault();
      setError(null);
      setConfirm(node.path);
    }
  };

  const submitRename = () => {
    if (!renaming) return;
    const message = onRename(renaming.path, renaming.text);
    if (message) setError(message);
    else {
      setError(null);
      setRenaming(null);
      focusRow(renaming.text);
    }
  };

  const submitCreate = () => {
    if (creating === null) return;
    const message = onCreate(creating);
    if (message) setError(message);
    else {
      setError(null);
      setCreating(null);
    }
  };

  return (
    <div ref={root} className="flex h-full min-h-0 flex-col">
      <div role="tree" aria-label="Файлы проекта" className="min-h-0 flex-1 overflow-auto py-1">
        {rows.map(({ node, depth }) => {
          const isDir = node.kind === 'dir';
          const open = isDir && !collapsed.has(node.path);
          const editing = renaming?.path === node.path;
          return (
            <div key={node.path} role="none" style={{ paddingLeft: `${depth * 12 + 8}px` }} className="pr-1">
              {editing ? (
                <div className="flex items-center gap-1 py-0.5">
                  <input
                    autoFocus
                    aria-label={`Новое имя для ${node.path}`}
                    aria-invalid={Boolean(error)}
                    className={input}
                    value={renaming.text}
                    spellCheck={false}
                    onChange={(e) => {
                      setRenaming({ path: renaming.path, text: e.target.value });
                      setError(e.target.value && e.target.value !== renaming.path ? pathError(e.target.value) : null);
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') submitRename();
                      if (e.key === 'Escape') {
                        setRenaming(null);
                        setError(null);
                        focusRow(node.path);
                      }
                    }}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  role="treeitem"
                  data-path={node.path}
                  aria-level={depth + 1}
                  aria-selected={!isDir && node.path === active}
                  aria-expanded={isDir ? open : undefined}
                  tabIndex={node.path === current ? 0 : -1}
                  onFocus={() => setFocused(node.path)}
                  onClick={() => (isDir ? toggle(node.path, !open) : onOpen(node.path))}
                  onKeyDown={(e) => onKeyDown(e, node)}
                  className={`flex w-full items-start gap-1.5 rounded px-1.5 py-1 text-left font-mono text-[12.5px] transition ${
                    !isDir && node.path === active ? 'bg-raised text-fg' : 'text-dim hover:bg-raised hover:text-fg'
                  }`}
                >
                  <span aria-hidden className="w-3 shrink-0 text-[11px] text-faint">
                    {isDir ? (open ? '▾' : '▸') : ''}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate" title={node.name}>
                      {node.name}
                    </span>
                    {!isDir && readonly.includes(node.path) && <span className="block text-[11px] leading-tight text-dim">только чтение</span>}
                  </span>
                  {node.path === entry && <span className="shrink-0 text-[11px] uppercase tracking-wider text-dim">вход</span>}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="shrink-0 space-y-1 border-t border-line p-2">
        {confirm && (
          <div role="alertdialog" aria-label="Удаление файла" className="space-y-1 text-[12.5px]">
            <p className="break-all text-fg">Удалить «{confirm}»?</p>
            <div className="flex gap-1.5">
              <Button
                variant="outline"
                autoFocus
                onClick={() => {
                  const message = onDelete(confirm);
                  setError(message);
                  setConfirm(null);
                  focusRow(entry);
                }}
              >
                Удалить
              </Button>
              <Button
                onClick={() => {
                  setConfirm(null);
                  focusRow(confirm);
                }}
              >
                Отмена
              </Button>
            </div>
          </div>
        )}
        {creating !== null ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              aria-label="Имя нового файла"
              aria-invalid={Boolean(error)}
              placeholder="routers/items.py"
              className={input}
              value={creating}
              spellCheck={false}
              onChange={(e) => {
                setCreating(e.target.value);
                setError(e.target.value ? pathError(e.target.value) : null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitCreate();
                if (e.key === 'Escape') {
                  setCreating(null);
                  setError(null);
                }
              }}
            />
          </div>
        ) : (
          <Button
            variant="outline"
            className="w-full justify-center"
            onClick={() => {
              setError(null);
              setConfirm(null);
              setCreating('');
            }}
          >
            Новый файл
          </Button>
        )}
        <p role="alert" className="min-h-0 break-words text-[12px] text-err">
          {error}
        </p>
        <p className="text-[11px] text-faint">F2 — переименовать, Delete — удалить</p>
      </div>
    </div>
  );
}
