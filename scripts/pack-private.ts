// Builds sealed course packs from plaintext sources kept outside git: private/<name>/course/.
// Run with `npm run pack:private` (scripts/pack-private.mjs loads this module through Vite so `@/` imports work).
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { loadCourse } from '@/content/loadCourse';
import { sealFiles } from '@/platform/sealed';

export const MIN_CODE_LENGTH = 12;
const TEXT_EXT = /\.(json|md|sql|graphql|proto|txt)$/i;

export class PackError extends Error {}

export function checkCode(code: string): void {
  if (code.length < MIN_CODE_LENGTH) {
    throw new PackError(`Код доступа слишком короткий: рекомендуется не менее ${MIN_CODE_LENGTH} символов.`);
  }
}

/** Reads every text file of a course folder as `/sealed/<id>/<relative path>`. */
export function collectCourse(courseDir: string): { id: string; files: Record<string, string> } {
  const manifestPath = join(courseDir, 'manifest.json');
  let id: unknown;
  try {
    id = (JSON.parse(readFileSync(manifestPath, 'utf8')) as { id?: unknown }).id;
  } catch {
    throw new PackError('manifest.json не читается или не является JSON.');
  }
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(id)) throw new PackError('manifest.json: нет корректного id курса.');
  const files: Record<string, string> = {};
  for (const entry of readdirSync(courseDir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !TEXT_EXT.test(entry.name)) continue;
    const rel = relative(courseDir, join(entry.parentPath, entry.name)).replaceAll('\\', '/');
    files[`/sealed/${id}/${rel}`] = readFileSync(join(entry.parentPath, entry.name), 'utf8');
  }
  return { id, files };
}

/** Validates the course with the app's loader, then seals it. */
export async function packCourse(courseDir: string, code: string, options: { iterations?: number } = {}) {
  checkCode(code);
  const { id, files } = collectCourse(courseDir);
  loadCourse(files, `/sealed/${id}`); // throws CourseError on problems
  const text = await sealFiles(files, code, options);
  return { id, text, count: Object.keys(files).length };
}

export function codeFromEnvFile(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*PRIVATE_PACK_CODE\s*=\s*(.*?)\s*$/.exec(line);
    if (m) return m[1].replace(/^(["'])(.*)\1$/, '$2') || undefined;
  }
  return undefined;
}

function promptHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) return Promise.reject(new PackError('Нет терминала для ввода кода: задайте PRIVATE_PACK_CODE.'));
  return new Promise((resolve) => {
    stdout.write(question);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function readCode(root: string): Promise<string> {
  return process.env.PRIVATE_PACK_CODE || codeFromEnvFile(join(root, '.env.local')) || (await promptHidden('Код доступа (ввод скрыт): '));
}

export async function main(root = process.cwd()): Promise<void> {
  const privateDir = join(root, 'private');
  const courseDirs = existsSync(privateDir)
    ? readdirSync(privateDir)
        .map((name) => join(privateDir, name, 'course'))
        .filter((dir) => existsSync(join(dir, 'manifest.json')) && statSync(dir).isDirectory())
    : [];
  if (courseDirs.length === 0) throw new PackError('Не найдено ни одной папки private/<name>/course/ с manifest.json.');
  const code = await readCode(root);
  checkCode(code);
  const outDir = join(root, 'sealed');
  mkdirSync(outDir, { recursive: true });
  for (const dir of courseDirs) {
    const { id, text, count } = await packCourse(dir, code);
    writeFileSync(join(outDir, `${id}.bin`), text);
    console.log(`sealed/${id}.bin  ${(text.length / 1024).toFixed(1)} KiB  ${count} files`);
  }
}
