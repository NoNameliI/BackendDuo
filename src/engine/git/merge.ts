import { diff3Merge } from 'node-diff3';
import type { Files } from './objects';
import type { Conflict } from './world';

export interface TreeMerge {
  /** Working tree result; conflicted text files carry conflict markers. */
  files: Files;
  /** Index result for clean paths (conflicted paths are left out). */
  index: Files;
  conflicts: Map<string, Conflict>;
  /** "Auto-merging x" and "CONFLICT (...)" lines in git's order. */
  messages: string[];
}

const lines = (text: string) => (text === '' ? [] : text.replace(/\n$/, '').split('\n'));
const text = (rows: string[]) => (rows.length ? `${rows.join('\n')}\n` : '');

/** Line-based 3-way merge with git's conflict markers; identical edges of both sides stay outside the markers. */
export function mergeText(base: string, ours: string, theirs: string, labels: { ours: string; theirs: string }): { text: string; conflict: boolean } {
  const out: string[] = [];
  let conflict = false;
  for (const region of diff3Merge(lines(ours), lines(base), lines(theirs), { excludeFalseConflicts: true })) {
    if (region.ok) {
      out.push(...region.ok);
      continue;
    }
    let a = region.conflict!.a;
    let b = region.conflict!.b;
    let head = 0;
    while (head < a.length && head < b.length && a[head] === b[head]) head++;
    let tail = 0;
    while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
    out.push(...a.slice(0, head));
    const suffix = a.slice(a.length - tail);
    a = a.slice(head, a.length - tail);
    b = b.slice(head, b.length - tail);
    if (a.length || b.length) {
      conflict = true;
      out.push(`<<<<<<< ${labels.ours}`, ...a, '=======', ...b, `>>>>>>> ${labels.theirs}`);
    }
    out.push(...suffix);
  }
  return { text: text(out), conflict };
}

/**
 * Merges snapshots like git's "ort" strategy for the cases the sandbox supports: content, add/add and
 * modify/delete conflicts (exact renames are treated as delete + add).
 */
export function mergeTrees(base: Files, ours: Files, theirs: Files, labels: { ours: string; theirs: string }): TreeMerge {
  const files: Record<string, string> = {};
  const index: Record<string, string> = {};
  const conflicts = new Map<string, Conflict>();
  const messages: string[] = [];
  const paths = [...new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)])].sort();
  for (const path of paths) {
    const b = base[path];
    const o = ours[path];
    const t = theirs[path];
    let result: string | undefined;
    if (o === t) result = o;
    else if (o === b) result = t;
    else if (t === b) result = o;
    else if (o !== undefined && t !== undefined) {
      messages.push(`Auto-merging ${path}`);
      const merged = mergeText(b ?? '', o, t, labels);
      if (merged.conflict) {
        messages.push(`CONFLICT (${b === undefined ? 'add/add' : 'content'}): Merge conflict in ${path}`);
        conflicts.set(path, { base: b ?? null, ours: o, theirs: t });
        files[path] = merged.text;
        continue;
      }
      result = merged.text;
    } else {
      const deletedIn = o === undefined ? labels.ours : labels.theirs;
      const keptIn = o === undefined ? labels.theirs : labels.ours;
      messages.push(`CONFLICT (modify/delete): ${path} deleted in ${deletedIn} and modified in ${keptIn}.  Version ${keptIn} of ${path} left in tree.`);
      conflicts.set(path, { base: b ?? null, ours: o ?? null, theirs: t ?? null });
      files[path] = (o ?? t)!;
      continue;
    }
    if (result !== undefined) {
      files[path] = result;
      index[path] = result;
    }
  }
  return { files, index, conflicts, messages };
}
