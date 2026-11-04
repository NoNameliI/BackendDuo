import { structuredPatch } from 'diff';
import { blobId, type Files } from './objects';

export interface FileChange {
  kind: 'added' | 'deleted' | 'modified' | 'renamed';
  path: string;
  /** Source path of a rename. */
  from?: string;
  oldContent: string | null;
  newContent: string | null;
}

/** Changes between two snapshots; exact-content add/delete pairs are reported as renames, like git -M. */
export function compareFiles(before: Files, after: Files): FileChange[] {
  const changes: FileChange[] = [];
  const added: string[] = [];
  const deleted: string[] = [];
  for (const path of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[path];
    const b = after[path];
    if (a === b) continue;
    if (a === undefined) added.push(path);
    else if (b === undefined) deleted.push(path);
    else changes.push({ kind: 'modified', path, oldContent: a, newContent: b });
  }
  for (const path of added) {
    const source = deleted.find((d) => before[d] === after[path]);
    if (source !== undefined) {
      deleted.splice(deleted.indexOf(source), 1);
      changes.push({ kind: 'renamed', path, from: source, oldContent: before[source], newContent: after[path] });
    } else changes.push({ kind: 'added', path, oldContent: null, newContent: after[path] });
  }
  for (const path of deleted) changes.push({ kind: 'deleted', path, oldContent: before[path], newContent: null });
  return changes.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
}

function hunks(oldText: string, newText: string) {
  return structuredPatch('a', 'b', oldText, newText, '', '', { context: 3 }).hunks;
}

export function lineStats(oldText: string | null, newText: string | null): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const hunk of hunks(oldText ?? '', newText ?? '')) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) added++;
      else if (line.startsWith('-')) removed++;
    }
  }
  return { added, removed };
}

const range = (start: number, count: number) => (count === 1 ? `${start}` : `${count === 0 ? start - 1 : start},${count}`);

/** git's default hunk header context: the nearest line above the hunk that starts with a letter, _ or $. */
function funcname(lines: string[], before: number): string {
  for (let i = Math.min(before, lines.length) - 1; i >= 0; i--) {
    if (/^[A-Za-z_$]/.test(lines[i])) return lines[i].trimEnd().slice(0, 80);
  }
  return '';
}

/** Unified diff of one file in git's format. */
export function formatPatch(change: FileChange): string[] {
  const oldPath = change.from ?? change.path;
  const out = [`diff --git a/${oldPath} b/${change.path}`];
  const oldId = change.oldContent === null ? '0000000' : blobId(change.oldContent).slice(0, 7);
  const newId = change.newContent === null ? '0000000' : blobId(change.newContent).slice(0, 7);
  if (change.kind === 'added') out.push('new file mode 100644', `index ${oldId}..${newId}`);
  else if (change.kind === 'deleted') out.push('deleted file mode 100644', `index ${oldId}..${newId}`);
  else if (change.kind === 'renamed') {
    out.push('similarity index 100%', `rename from ${oldPath}`, `rename to ${change.path}`);
    return out;
  } else out.push(`index ${oldId}..${newId} 100644`);

  const fileHunks = hunks(change.oldContent ?? '', change.newContent ?? '');
  if (fileHunks.length === 0) return out;
  out.push(change.oldContent === null ? '--- /dev/null' : `--- a/${oldPath}`);
  out.push(change.newContent === null ? '+++ /dev/null' : `+++ b/${change.path}`);
  const oldLines = (change.oldContent ?? '').split('\n');
  for (const h of fileHunks) {
    const context = funcname(oldLines, h.oldStart - 1);
    out.push(`@@ -${range(h.oldStart, h.oldLines)} +${range(h.newStart, h.newLines)} @@${context ? ` ${context}` : ''}`);
    out.push(...h.lines);
  }
  return out;
}

/** "rename src/{a.js => b.js} (100%)" — git's compact form for renames that share a directory. */
export function formatRename(from: string, to: string): string {
  let prefix = 0;
  for (let i = 0; i < Math.min(from.length, to.length) && from[i] === to[i]; i++) if (from[i] === '/') prefix = i + 1;
  let suffix = 0;
  for (let i = 1; i <= Math.min(from.length, to.length) - prefix && from.at(-i) === to.at(-i); i++) if (from.at(-i) === '/') suffix = i;
  if (prefix === 0 && suffix === 0) return `${from} => ${to}`;
  const head = from.slice(0, prefix);
  const tail = suffix ? from.slice(from.length - suffix) : '';
  return `${head}{${from.slice(prefix, from.length - suffix)} => ${to.slice(prefix, to.length - suffix)}}${tail}`;
}

/** Summary printed after commit/merge: " 2 files changed, 3 insertions(+), 1 deletion(-)" and mode lines. */
export function formatSummary(changes: FileChange[], modes = true): string[] {
  let added = 0;
  let removed = 0;
  for (const c of changes) {
    const s = lineStats(c.oldContent, c.newContent);
    added += s.added;
    removed += s.removed;
  }
  const n = changes.length;
  const parts = [` ${n} file${n === 1 ? '' : 's'} changed`];
  if (added > 0 || removed === 0) parts.push(`${added} insertion${added === 1 ? '' : 's'}(+)`);
  if (removed > 0 || added === 0) parts.push(`${removed} deletion${removed === 1 ? '' : 's'}(-)`);
  const lines = [parts.join(', ')];
  if (!modes) return lines;
  for (const c of changes) {
    if (c.kind === 'added') lines.push(` create mode 100644 ${c.path}`);
    if (c.kind === 'deleted') lines.push(` delete mode 100644 ${c.path}`);
    if (c.kind === 'renamed') lines.push(` rename ${formatRename(c.from!, c.path)} (100%)`);
  }
  return lines;
}

const scale = (it: number, width: number, max: number) => (it ? 1 + Math.floor((it * (width - 1)) / max) : 0);

/** `--stat` lines: " file | 4 ++--" with git's 80-column layout, then the summary line. */
export function formatStat(changes: FileChange[], modes = false): string[] {
  const rows = changes.map((c) => ({ name: c.from !== undefined ? formatRename(c.from, c.path) : c.path, ...lineStats(c.oldContent, c.newContent) }));
  const maxChange = Math.max(0, ...rows.map((r) => r.added + r.removed));
  const numberWidth = String(maxChange).length;
  let nameWidth = Math.max(0, ...rows.map((r) => r.name.length));
  const width = 80;
  let graphWidth = maxChange;
  if (nameWidth + numberWidth + 6 + graphWidth > width) {
    if (graphWidth > Math.floor((width * 3) / 8) - numberWidth - 6) graphWidth = Math.max(6, Math.floor((width * 3) / 8) - numberWidth - 6);
    if (nameWidth > width - numberWidth - 6 - graphWidth) nameWidth = width - numberWidth - 6 - graphWidth;
    else graphWidth = width - numberWidth - 6 - nameWidth;
  }
  const out = rows.map((r) => {
    let { added, removed } = r;
    if (graphWidth <= maxChange && maxChange > 0) {
      let total = scale(added + removed, graphWidth, maxChange);
      if (total < 2 && added && removed) total = 2;
      if (added < removed) {
        added = scale(added, graphWidth, maxChange);
        removed = total - added;
      } else {
        removed = scale(removed, graphWidth, maxChange);
        added = total - removed;
      }
    }
    const name = r.name.length > nameWidth ? `...${r.name.slice(r.name.length - nameWidth + 3)}` : r.name.padEnd(nameWidth);
    const graph = '+'.repeat(added) + '-'.repeat(removed);
    return ` ${name} | ${String(r.added + r.removed).padStart(numberWidth)}${graph ? ` ${graph}` : ''}`;
  });
  return [...out, ...formatSummary(changes, modes)];
}
