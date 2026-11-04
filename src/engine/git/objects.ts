import { sha1 } from './sha1';

/** Repository-relative path → file content. */
export type Files = Readonly<Record<string, string>>;

export interface Signature {
  name: string;
  email: string;
  /** Unix seconds. */
  time: number;
  /** Offset such as +0300. */
  tz: string;
}

export interface Commit {
  id: string;
  tree: string;
  files: Files;
  parents: string[];
  author: Signature;
  committer: Signature;
  /** Always ends with a newline, like git stores it. */
  message: string;
}

const encoder = new TextEncoder();

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function hashObject(type: string, body: Uint8Array): string {
  return sha1(concat([encoder.encode(`${type} ${body.length}\0`), body]));
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export const blobId = (content: string): string => hashObject('blob', encoder.encode(content));

/** Tree id of a snapshot, built from nested tree objects exactly as git does (files are mode 100644). */
export function treeId(files: Files): string {
  const entries = new Map<string, { kind: 'file'; content: string } | { kind: 'dir'; files: Record<string, string> }>();
  for (const [path, content] of Object.entries(files)) {
    const slash = path.indexOf('/');
    if (slash === -1) {
      entries.set(path, { kind: 'file', content });
      continue;
    }
    const dir = path.slice(0, slash);
    const entry = entries.get(dir);
    const sub = entry?.kind === 'dir' ? entry.files : {};
    sub[path.slice(slash + 1)] = content;
    entries.set(dir, { kind: 'dir', files: sub });
  }
  // git orders entries by name, comparing directories as if their name ended with "/".
  const sortKey = (name: string) => (entries.get(name)!.kind === 'dir' ? `${name}/` : name);
  const names = [...entries.keys()].sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));
  const body = concat(
    names.flatMap((name) => {
      const entry = entries.get(name)!;
      const [mode, id] = entry.kind === 'file' ? ['100644', blobId(entry.content)] : ['40000', treeId(entry.files)];
      return [encoder.encode(`${mode} ${name}\0`), hexToBytes(id)];
    }),
  );
  return hashObject('tree', body);
}

export const formatSignature = (s: Signature) => `${s.name} <${s.email}> ${s.time} ${s.tz}`;

export function commitId(c: Omit<Commit, 'id' | 'files'>): string {
  const header = [
    `tree ${c.tree}`,
    ...c.parents.map((p) => `parent ${p}`),
    `author ${formatSignature(c.author)}`,
    `committer ${formatSignature(c.committer)}`,
  ].join('\n');
  return hashObject('commit', encoder.encode(`${header}\n\n${c.message}`));
}

export function tagId(tag: { object: string; name: string; tagger: Signature; message: string }): string {
  const body = `object ${tag.object}\ntype commit\ntag ${tag.name}\ntagger ${formatSignature(tag.tagger)}\n\n${tag.message}`;
  return hashObject('tag', encoder.encode(body));
}

/** git's cleanup of commit messages: trailing spaces and blank lines go, one final newline stays. */
export function cleanMessage(text: string): string {
  const lines = text.split('\n').map((l) => l.replace(/\s+$/, ''));
  while (lines.length && lines[0] === '') lines.shift();
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  const collapsed = lines.filter((l, i) => !(l === '' && lines[i - 1] === ''));
  return collapsed.length ? `${collapsed.join('\n')}\n` : '';
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Default git date format: "Fri Jan 9 10:00:00 2026 +0300". */
export function formatDate(s: Pick<Signature, 'time' | 'tz'>): string {
  const sign = s.tz.startsWith('-') ? -1 : 1;
  const offset = sign * (Number(s.tz.slice(1, 3)) * 60 + Number(s.tz.slice(3, 5)));
  const d = new Date((s.time + offset * 60) * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ${d.getUTCFullYear()} ${s.tz}`;
}
