import type { ProjectFiles } from '@/engine/python/runtime';

/** The limits and the name rules of the runtime (studio_runtime.py): the UI refuses what the runtime would refuse. */
export const MAX_FILES = 40;
export const MAX_BYTES = 400 * 1024;
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

/** The project as the editor holds it: files, the entry module and the files open in tabs. */
export interface ProjectState {
  files: ProjectFiles;
  entry: string;
  active: string;
  open: string[];
}

export type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** A Russian message for a path the runtime would refuse, or null for a good one. */
export function pathError(path: string): string | null {
  if (!path.trim()) return 'Введите имя файла';
  if (path !== path.trim()) return 'В начале и в конце имени не должно быть пробелов';
  for (const part of path.split('/')) {
    if (!part) return 'Имя не может быть пустым и не может начинаться или заканчиваться на «/»';
    if (part.includes('..')) return 'В имени не должно быть «..»';
    if (!SEGMENT.test(part)) return 'Допустимы латинские буквы, цифры, _ . - и «/» между папками; имя не начинается с точки или дефиса';
  }
  return null;
}

export const byteSize = (files: ProjectFiles): number => Object.values(files).reduce((sum, text) => sum + new TextEncoder().encode(text).length, 0);

/** Whether the project still fits the runtime's limits (checked when the learner types too). */
export function sizeError(files: ProjectFiles): string | null {
  const count = Object.keys(files).length;
  if (count > MAX_FILES) return `В проекте ${count} файлов, а можно не больше ${MAX_FILES}`;
  const bytes = byteSize(files);
  if (bytes > MAX_BYTES) return `Проект занимает ${Math.ceil(bytes / 1024)} КБ, а можно не больше ${MAX_BYTES / 1024} КБ`;
  return null;
}

/** A file cannot share its name with a folder (a.py and a.py/b.py) nor sit inside a file. */
function clash(files: ProjectFiles, path: string, ignore?: string): string | null {
  for (const other of Object.keys(files)) {
    if (other === ignore) continue;
    if (other === path) return `Файл «${path}» уже есть`;
    if (other.startsWith(`${path}/`)) return `«${path}» — это папка, файлом её не сделать`;
    if (path.startsWith(`${other}/`)) return `«${other}» — файл, внутри него нельзя создать «${path}»`;
  }
  return null;
}

export function createFile(state: ProjectState, path: string, text = ''): Outcome<ProjectState> {
  const bad = pathError(path) ?? clash(state.files, path);
  if (bad) return fail(bad);
  const files = { ...state.files, [path]: text };
  const tooBig = sizeError(files);
  if (tooBig) return fail(tooBig);
  return { ok: true, value: { ...state, files, active: path, open: [...state.open, path] } };
}

export function renameFile(state: ProjectState, from: string, to: string): Outcome<ProjectState> {
  if (!(from in state.files)) return fail(`Файла «${from}» нет`);
  if (from === to) return { ok: true, value: state };
  const bad = pathError(to) ?? clash(state.files, to, from);
  if (bad) return fail(bad);
  const files: ProjectFiles = {};
  for (const [path, text] of Object.entries(state.files)) files[path === from ? to : path] = text;
  const move = (path: string) => (path === from ? to : path);
  return { ok: true, value: { files, entry: move(state.entry), active: move(state.active), open: state.open.map(move) } };
}

export function deleteFile(state: ProjectState, path: string): Outcome<ProjectState> {
  if (!(path in state.files)) return fail(`Файла «${path}» нет`);
  if (path === state.entry) return fail(`«${path}» — точка входа приложения, её нельзя удалить`);
  const files = { ...state.files };
  delete files[path];
  const open = state.open.filter((p) => p !== path);
  const active = state.active === path ? (open.at(-1) ?? state.entry) : state.active;
  return { ok: true, value: { ...state, files, open: open.includes(active) ? open : [...open, active], active } };
}

/** Closing a tab keeps at least the entry open; the file itself stays in the project. */
export function closeTab(state: ProjectState, path: string): ProjectState {
  const index = state.open.indexOf(path);
  if (index < 0 || state.open.length <= 1) return state;
  const open = state.open.filter((p) => p !== path);
  const active = state.active === path ? open[Math.min(index, open.length - 1)] : state.active;
  return { ...state, open, active };
}

export function openFile(state: ProjectState, path: string): ProjectState {
  if (!(path in state.files)) return state;
  return { ...state, active: path, open: state.open.includes(path) ? state.open : [...state.open, path] };
}

export interface TreeNode {
  name: string;
  /** Full project path ('routers/items.py', or 'routers' for a folder). */
  path: string;
  kind: 'file' | 'dir';
  children: TreeNode[];
}

const compare = (a: TreeNode, b: TreeNode) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'en') : a.kind === 'dir' ? -1 : 1);

/** Folders first, then files, each group alphabetical. */
export function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', kind: 'dir', children: [] };
  for (const path of paths) {
    const parts = path.split('/');
    let node = root;
    parts.forEach((name, i) => {
      const full = parts.slice(0, i + 1).join('/');
      const kind = i === parts.length - 1 ? 'file' : 'dir';
      let child = node.children.find((c) => c.path === full);
      if (!child) {
        child = { name, path: full, kind, children: [] };
        node.children.push(child);
      }
      node = child;
    });
  }
  const sort = (n: TreeNode) => {
    n.children.sort(compare);
    n.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

/** The nodes in the order they are drawn (collapsed folders hide their children). */
export function visibleNodes(tree: TreeNode[], collapsed: ReadonlySet<string>, depth = 0): { node: TreeNode; depth: number }[] {
  return tree.flatMap((node) => [{ node, depth }, ...(node.kind === 'dir' && !collapsed.has(node.path) ? visibleNodes(node.children, collapsed, depth + 1) : [])]);
}

/** Whether the project has pytest tests (the «Тесты» tab appears). */
export const hasTests = (files: ProjectFiles): boolean => Object.keys(files).some((p) => p.startsWith('tests/'));
