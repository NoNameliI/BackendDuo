import { readStore, writeStore } from '@/platform';
import { deriveKey, fromBase64, openPack, packSalt, SealedError, toBase64 } from '@/platform/sealed';
import { registerSealed, unregisterSealed } from './courses';
import { loadCourse, type Course } from './loadCourse';

const ACCESS_KEY = 'access';

interface AccessDoc {
  packs: Record<string, { salt: string; key: string }>;
}

export interface SealedDeps {
  /** Pack file name → URL. */
  packs: () => Record<string, string>;
  fetchText: (url: string) => Promise<string>;
  read: () => Promise<AccessDoc | undefined>;
  write: (doc: AccessDoc) => Promise<void>;
  register: (course: Course) => void;
  unregister: (ids?: string[]) => void;
}

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** Course ids found in decrypted files: `/sealed/<id>/manifest.json`. */
function courseIds(files: Record<string, string>): string[] {
  const ids: string[] = [];
  for (const path of Object.keys(files)) {
    const m = /^\/sealed\/([^/]+)\/manifest\.json$/.exec(path);
    if (m) ids.push(m[1]);
  }
  return ids;
}

export function createSealedRegistry(deps: SealedDeps) {
  const registered = new Set<string>();
  const texts = new Map<string, Promise<string>>();

  const textOf = (name: string, url: string) => {
    let t = texts.get(name);
    if (!t) texts.set(name, (t = deps.fetchText(url)));
    return t;
  };

  async function open(name: string, key: Uint8Array): Promise<boolean> {
    const url = deps.packs()[name];
    if (!url) return false;
    try {
      const files = await openPack(await textOf(name, url), key);
      const loaded = courseIds(files).map((id) => ({ ...loadCourse(files, `/sealed/${id}`), sealed: true }));
      for (const course of loaded) {
        deps.register(course);
        registered.add(course.id);
      }
      return loaded.length > 0;
    } catch {
      texts.delete(name);
      return false;
    }
  }

  async function unlock(code: string): Promise<boolean> {
    const doc: AccessDoc = { packs: { ...((await deps.read())?.packs ?? {}) } };
    let opened = false;
    for (const [name, url] of Object.entries(deps.packs())) {
      try {
        const { salt, iterations } = packSalt(await textOf(name, url));
        const key = await deriveKey(code, salt, iterations);
        if (await open(name, key)) {
          doc.packs[name] = { salt, key: toBase64(key) };
          opened = true;
        }
      } catch {
        texts.delete(name);
      }
    }
    if (opened) await deps.write(doc);
    return opened;
  }

  async function restoreAccess(): Promise<void> {
    const stored = (await deps.read())?.packs;
    if (!stored) return;
    const kept: AccessDoc = { packs: {} };
    for (const [name, entry] of Object.entries(stored)) {
      const url = deps.packs()[name];
      if (!url || typeof entry?.key !== 'string') continue;
      try {
        if (packSalt(await textOf(name, url)).salt !== entry.salt) continue;
        if (await open(name, fromBase64(entry.key))) kept.packs[name] = entry;
      } catch {
        texts.delete(name);
      }
    }
    if (Object.keys(kept.packs).length !== Object.keys(stored).length) await deps.write(kept);
  }

  async function lockAccess(): Promise<void> {
    await deps.write({ packs: {} });
    deps.unregister([...registered]);
    registered.clear();
  }

  return { unlock, restoreAccess, lockAccess, hasAccess: () => registered.size > 0 };
}

const registry = createSealedRegistry({
  packs: () => {
    const urls = import.meta.glob<string>('/sealed/*.bin', { query: '?url', import: 'default', eager: true });
    return Object.fromEntries(Object.entries(urls).map(([path, url]) => [fileName(path), url]));
  },
  fetchText: async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new SealedError('pack unavailable');
    return res.text();
  },
  read: () => readStore<AccessDoc>(ACCESS_KEY),
  write: (doc) => writeStore(ACCESS_KEY, doc),
  register: registerSealed,
  unregister: unregisterSealed,
});

export const { unlock, restoreAccess, lockAccess, hasAccess } = registry;
